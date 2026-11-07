// Payment reminders: the unpaid invoices that are overdue or about to be, and
// a polite email to each customer. Every attempt is logged, and an invoice
// that was reminded in the last 24 hours is skipped so nobody is nagged twice.
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
dayjs.extend(customParseFormat);
const ST_CODES = require("../helpers/statusCodeHelpers");
const mailer = require("../helpers/mailer");
const ReminderLog = require("../model/reminderLogSchema");

const COOLDOWN_MS = 24 * 3600 * 1000;
const MAX_SEND = 100;
const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const Invoice = () => mongoose.model("Invoice");
const money = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const orgOf = (req) => {
  const raw = String(req.query.org_id || req.body?.org_id || "");
  return /^\d+$/.test(raw) ? Number(raw) : null;
};
const parse = (v) => {
  if (!v) return null;
  const d = dayjs(v, ["YYYY-MM-DD", "DD-MM-YYYY", "YYYY-MM-DDTHH:mm:ss.SSSZ"], false);
  return d.isValid() ? d : dayjs(v).isValid() ? dayjs(v) : null;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Unpaid, issued invoices with how late each is and when it was last reminded.
const openInvoices = async (org, adminId) => {
  const invoices = await Invoice()
    .find({ organization_id: org, admin_id: adminId, status: { $nin: ["draft", "Draft", "void", "Void"] }, balance: { $gt: 0 } })
    .select("invoice_number customer_id customer_name email date due_date total balance")
    .lean();
  const logs = await ReminderLog.aggregate([
    { $match: { organization_id: org, ok: true, invoice_ref: { $in: invoices.map((i) => i._id) } } },
    { $group: { _id: "$invoice_ref", last: { $max: "$sent_at" }, count: { $sum: 1 } } },
  ]);
  const byInvoice = new Map(logs.map((l) => [String(l._id), l]));
  const today = dayjs().startOf("day");
  return invoices
    .map((i) => {
      const due = parse(i.due_date || i.date);
      const days = due ? today.diff(due.startOf("day"), "day") : 0;
      const log = byInvoice.get(String(i._id));
      return {
        _id: i._id, invoice_number: i.invoice_number, customer_name: i.customer_name || "", email: EMAIL.test(String(i.email || "").trim()) ? String(i.email).trim() : "",
        due_date: due ? due.format("YYYY-MM-DD") : "", days_past_due: days, total: i.total || 0, balance: i.balance || 0,
        last_reminded: log?.last || null, reminders_sent: log?.count || 0,
      };
    })
    .sort((a, b) => b.days_past_due - a.days_past_due);
};

const message = (inv, orgName) => {
  const late = inv.days_past_due > 0;
  const when = late ? `was due on ${dayjs(inv.due_date).format("DD-MM-YYYY")} (${inv.days_past_due} day${inv.days_past_due === 1 ? "" : "s"} ago)` : `is due on ${dayjs(inv.due_date).format("DD-MM-YYYY")}`;
  const subject = late ? `Payment reminder: invoice ${inv.invoice_number} is overdue` : `Reminder: invoice ${inv.invoice_number} is due soon`;
  const text = `Hi ${inv.customer_name || "there"},\n\nThis is a friendly reminder that invoice ${inv.invoice_number} for ${money(inv.balance)} ${when}.\n\nIf you have already paid, please ignore this message. Otherwise we would appreciate your payment at your earliest convenience.\n\nThank you,\n${orgName}`;
  const e = mailer.escapeHtml;
  const html = mailer.layout(
    subject,
    `<p>Hi ${e(inv.customer_name || "there")},</p><p>This is a friendly reminder that invoice <b>${e(inv.invoice_number)}</b> for <b>${e(money(inv.balance))}</b> ${e(when)}.</p><p>If you have already paid, please ignore this message. Otherwise we would appreciate your payment at your earliest convenience.</p><p>Thank you,<br>${e(orgName)}</p>`
  );
  return { subject, text, html };
};

class PaymentReminderController {
  // GET /reminders?org_id=&filter=overdue|due_soon|all
  async list(req, res) {
    try {
      const org = orgOf(req);
      if (org === null) return bad(res, "Organization ID is required");
      const filter = req.query.filter || "overdue";
      let rows = await openInvoices(org, res.locals.user_id);
      if (filter === "overdue") rows = rows.filter((r) => r.days_past_due > 0);
      else if (filter === "due_soon") rows = rows.filter((r) => r.days_past_due <= 0 && r.days_past_due >= -7);
      const now = Date.now();
      rows = rows.map((r) => ({ ...r, can_send: Boolean(r.email) && !(r.last_reminded && now - new Date(r.last_reminded).getTime() < COOLDOWN_MS) }));
      res.status(ST_CODES.OK).json({
        status: true,
        data: rows,
        totals: { invoices: rows.length, balance: Math.round(rows.reduce((t, r) => t + Math.round(r.balance * 100), 0)) / 100 },
        email_ready: mailer.canSendMail(),
      });
    } catch (error) {
      console.error("reminder list error", error);
      return bad(res, "Couldn't load reminders", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /reminders/send  { org_id, invoice_ids: [] }
  async send(req, res) {
    try {
      const org = orgOf(req);
      if (org === null) return bad(res, "Organization ID is required");
      const ids = Array.isArray(req.body?.invoice_ids) ? [...new Set(req.body.invoice_ids.map(String))] : [];
      if (!ids.length) return bad(res, "Choose at least one invoice");
      if (ids.length > MAX_SEND) return bad(res, `Send up to ${MAX_SEND} reminders at a time`);
      if (ids.some((i) => !mongoose.isValidObjectId(i))) return bad(res, "Invalid invoice");
      if (!mailer.canSendMail()) return bad(res, "Email isn't set up, so reminders can't be sent.");
      const adminId = res.locals.user_id;
      const org_doc = await mongoose.model("Organization").findOne({ organization_id: org }, { org_name: 1 }).lean();
      const orgName = org_doc?.org_name || "Your supplier";
      const open = new Map((await openInvoices(org, adminId)).map((r) => [String(r._id), r]));
      const results = [];
      const now = Date.now();
      for (const id of ids) {
        const inv = open.get(id);
        if (!inv) { results.push({ invoice_id: id, status: "skipped", reason: "Not an unpaid invoice" }); continue; }
        if (!inv.email) { results.push({ invoice_id: id, invoice_number: inv.invoice_number, status: "skipped", reason: "No email address for this customer" }); continue; }
        if (inv.last_reminded && now - new Date(inv.last_reminded).getTime() < COOLDOWN_MS) {
          results.push({ invoice_id: id, invoice_number: inv.invoice_number, status: "skipped", reason: "Reminded in the last 24 hours" });
          continue;
        }
        const m = message(inv, orgName);
        const r = await mailer.sendMail({ to: inv.email, fromName: orgName, ...m });
        await ReminderLog.create({
          organization_id: org, admin_id: adminId, invoice_ref: inv._id, invoice_number: inv.invoice_number, customer_name: inv.customer_name,
          to: inv.email, days_past_due: inv.days_past_due, balance: inv.balance, ok: Boolean(r.ok), error: r.ok ? "" : String(r.error || ""),
        });
        results.push({ invoice_id: id, invoice_number: inv.invoice_number, status: r.ok ? "sent" : "failed", reason: r.ok ? "" : String(r.error || "Couldn't send") });
      }
      const sent = results.filter((r) => r.status === "sent").length;
      res.status(ST_CODES.OK).json({ status: true, message: `${sent} reminder${sent === 1 ? "" : "s"} sent`, data: results });
    } catch (error) {
      console.error("reminder send error", error);
      return bad(res, "Couldn't send reminders", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /reminders/log?org_id=
  async log(req, res) {
    try {
      const org = orgOf(req);
      if (org === null) return bad(res, "Organization ID is required");
      const rows = await ReminderLog.find({ organization_id: org, admin_id: res.locals.user_id }).sort({ sent_at: -1 }).limit(200).lean();
      res.status(ST_CODES.OK).json({ status: true, data: rows });
    } catch (error) {
      console.error("reminder log error", error);
      return bad(res, "Couldn't load the history", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}

module.exports = new PaymentReminderController();
