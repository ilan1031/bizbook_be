// Payment links: a Razorpay link for an unpaid invoice that the customer can
// pay from any device. Razorpay tells us when it is paid (webhook), and the
// payment is then recorded against the invoice through the normal customer
// payment flow, so the journal and invoice balance follow.
const crypto = require("crypto");
const mongoose = require("mongoose");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const mailer = require("../helpers/mailer");
const razorpay = require("../helpers/razorpayClient");
const PaymentLink = require("../model/paymentLinkSchema");

const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const orgOf = (req) => {
  const raw = String(req.query.org_id || req.body?.org_id || "");
  return /^\d+$/.test(raw) ? raw : null;
};
const paise = (n) => Math.round((Number(n) || 0) * 100);
const MIN_PAISE = 100; // Razorpay's smallest link is ₹1
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_EXPIRY_DAYS = 14;
const Invoice = () => mongoose.model("Invoice");

const findInvoice = (org, invoiceId) =>
  Invoice().findOne({ organization_id: { $in: [org, Number(org)] }, invoice_id: String(invoiceId), deleted_at: null }).lean();
const open = (inv) => inv && !["draft", "void"].includes(String(inv.status).toLowerCase()) && (Number(inv.balance) || 0) > 0;

// Runs the customer payment controller in-process and returns what it answered.
const recordPayment = async (link, invoice) => {
  const controller = require("./customerPaymentController");
  const now = new Date();
  let status = 200;
  let payload = null;
  const res = { locals: { user_id: link.admin_id }, status(c) { status = c; return this; }, json(p) { payload = p; return this; }, send(p) { payload = p; return this; } };
  await controller.createCustomerPayment(
    {
      query: { organization_id: link.organization_id },
      headers: {},
      body: {
        formType: "Invoice Payment",
        amount: link.amount,
        customer_id: link.customer_id,
        customer_name: link.customer_name,
        payment_mode: "Payment Link (Razorpay)",
        reference_number: link.razorpay_payment_id,
        date: now,
        date_formatted: commonHelper.formatDateString(now),
        invoices: [{ invoice_id: invoice.invoice_id, amount_applied: link.amount }],
      },
    },
    res
  );
  return { status, payload };
};

class PaymentLinkController {
  // GET /payment-links?org_id=&invoice_id=
  async list(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const q = { organization_id: org };
      if (req.query.invoice_id) q.invoice_id = String(req.query.invoice_id);
      const rows = await PaymentLink.find(q).sort({ createdAt: -1 }).limit(300).lean();
      const now = Date.now();
      res.status(ST_CODES.OK).json({
        status: true,
        data: rows.map((r) => ({ ...r, status: r.status === "created" && r.expires_at && new Date(r.expires_at).getTime() < now ? "expired" : r.status })),
        configured: razorpay.isConfigured(),
      });
    } catch (error) {
      console.error("payment link list error", error);
      return bad(res, "Couldn't load payment links", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /payment-links/invoices?org_id=  unpaid invoices a link can be made for
  async invoices(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const rows = await Invoice()
        .find({ organization_id: { $in: [org, Number(org)] }, admin_id: res.locals.user_id, deleted_at: null, status: { $nin: ["draft", "Draft", "void", "Void"] }, balance: { $gt: 0 } })
        .select("invoice_id invoice_number customer_name email date due_date total balance")
        .sort({ date: -1 })
        .limit(300)
        .lean();
      res.status(ST_CODES.OK).json({ status: true, data: rows });
    } catch (error) {
      console.error("payment link invoices error", error);
      return bad(res, "Couldn't load invoices", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /payment-links  { org_id, invoice_id, amount?, send_email? }
  async create(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!razorpay.isConfigured()) return bad(res, "Online payments aren't set up yet. Add the Razorpay keys first.", ST_CODES.SERVICE_UNAVAILABLE || 503);
      const invoice = await findInvoice(org, req.body?.invoice_id);
      if (!invoice || String(invoice.admin_id) !== String(res.locals.user_id)) return bad(res, "Invoice not found", ST_CODES.NOT_FOUND);
      if (!open(invoice)) return bad(res, "This invoice has nothing left to pay");
      const due = paise(invoice.balance);
      const wanted = req.body?.amount === undefined || req.body.amount === "" ? due : paise(req.body.amount);
      if (!Number.isFinite(wanted) || wanted < MIN_PAISE) return bad(res, "The amount must be at least ₹1");
      if (wanted > due) return bad(res, `Only ₹${due / 100} is due on this invoice`);
      if (await PaymentLink.exists({ organization_id: org, invoice_id: invoice.invoice_id, status: { $in: ["created", "processing"] }, $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }] })) {
        return bad(res, "This invoice already has a payment link waiting. Cancel it first to make another.");
      }
      const email = EMAIL.test(String(invoice.email || "").trim()) ? String(invoice.email).trim() : "";
      const expires = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86400000);
      const created = await razorpay.getClient().paymentLink.create({
        amount: wanted,
        currency: "INR",
        accept_partial: false,
        description: `Invoice ${invoice.invoice_number}`,
        reference_id: `${org}-${invoice.invoice_id}-${Date.now()}`.slice(0, 40),
        expire_by: Math.floor(expires.getTime() / 1000),
        customer: { name: invoice.customer_name || undefined, ...(email ? { email } : {}) },
        notify: { sms: false, email: false },
      });
      const link = await PaymentLink.create({
        organization_id: org, admin_id: res.locals.user_id, invoice_ref: invoice._id, invoice_id: invoice.invoice_id, invoice_number: invoice.invoice_number,
        customer_id: invoice.customer_id || "", customer_name: invoice.customer_name || "", customer_email: email, amount: wanted / 100,
        razorpay_link_id: created.id, short_url: created.short_url || "", expires_at: expires,
      });
      let emailed = false;
      if (req.body?.send_email && email) {
        const org_doc = await mongoose.model("Organization").findOne({ organization_id: Number(org) }, { org_name: 1 }).lean();
        const orgName = org_doc?.org_name || "Your supplier";
        const e = mailer.escapeHtml;
        const r = await mailer.sendMail({
          to: email, fromName: orgName, subject: `Pay invoice ${invoice.invoice_number} online`,
          text: `Hi ${invoice.customer_name || "there"},\n\nYou can pay ₹${link.amount} for invoice ${invoice.invoice_number} online here:\n${link.short_url}\n\nThank you,\n${orgName}`,
          html: mailer.layout(`Pay invoice ${invoice.invoice_number}`, `<p>Hi ${e(invoice.customer_name || "there")},</p><p>You can pay <b>₹${e(link.amount)}</b> for invoice <b>${e(invoice.invoice_number)}</b> online.</p><p><a href="${e(link.short_url)}" style="background:#1b7a2f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Pay now</a></p><p>Thank you,<br>${e(orgName)}</p>`),
        });
        if (r.ok) {
          emailed = true;
          await PaymentLink.updateOne({ _id: link._id }, { $set: { emailed_at: new Date() } });
        }
      }
      res.status(ST_CODES.CREATED || 201).json({ status: true, message: "Payment link created", data: link, emailed });
    } catch (error) {
      console.error("payment link create error", error);
      return bad(res, "Couldn't create the payment link", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // DELETE /payment-links/:id  cancels a link that has not been paid.
  async cancel(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Payment link not found", ST_CODES.NOT_FOUND);
      const link = await PaymentLink.findOne({ _id: req.params.id, organization_id: org });
      if (!link) return bad(res, "Payment link not found", ST_CODES.NOT_FOUND);
      if (link.status !== "created") return bad(res, link.status === "paid" ? "This link has already been paid" : `This link is ${link.status}`);
      try {
        await razorpay.getClient().paymentLink.cancel(link.razorpay_link_id);
      } catch (err) {
        // Already expired or cancelled at Razorpay: ours should follow.
        if (!/cancel|expire|status/i.test(String(err?.error?.description || err?.message || ""))) throw err;
      }
      link.status = "cancelled";
      await link.save();
      res.status(ST_CODES.OK).json({ status: true, message: "Payment link cancelled", data: link });
    } catch (error) {
      console.error("payment link cancel error", error);
      return bad(res, "Couldn't cancel the payment link", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /webhooks/razorpay  (public; signed by Razorpay with RAZORPAY_WEBHOOK_SECRET)
  async webhook(req, res) {
    try {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!secret) return res.status(503).json({ status: false, message: "Webhook is not configured" });
      const given = String(req.headers["x-razorpay-signature"] || "");
      const expected = crypto.createHmac("sha256", secret).update(req.rawBody || Buffer.from("")).digest("hex");
      if (!given || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
        return res.status(400).json({ status: false, message: "Invalid signature" });
      }
      const event = req.body?.event;
      const linkEntity = req.body?.payload?.payment_link?.entity;
      const paymentEntity = req.body?.payload?.payment?.entity;
      if (!linkEntity?.id) return res.status(200).json({ status: true, message: "Ignored" });
      if (event === "payment_link.expired" || event === "payment_link.cancelled") {
        await PaymentLink.updateOne({ razorpay_link_id: linkEntity.id, status: "created" }, { $set: { status: event === "payment_link.expired" ? "expired" : "cancelled" } });
        return res.status(200).json({ status: true });
      }
      if (event !== "payment_link.paid") return res.status(200).json({ status: true, message: "Ignored" });

      // Claim the link once, so a repeated webhook never records twice.
      const link = await PaymentLink.findOneAndUpdate({ razorpay_link_id: linkEntity.id, status: "created" }, { $set: { status: "processing" } }, { new: true });
      if (!link) return res.status(200).json({ status: true, message: "Already handled" });
      const release = (status = "created") => PaymentLink.updateOne({ _id: link._id }, { $set: { status } });

      if (String(paymentEntity?.status) !== "captured" && String(paymentEntity?.status) !== "paid") { await release(); return res.status(200).json({ status: true, message: "Not captured" }); }
      if (Number(paymentEntity?.amount) !== paise(link.amount)) { await release(); return res.status(400).json({ status: false, message: "Amount does not match" }); }
      link.razorpay_payment_id = String(paymentEntity.id || "");
      const invoice = await findInvoice(link.organization_id, link.invoice_id);
      if (!invoice) { await release(); return res.status(500).json({ status: false, message: "Invoice not found" }); }
      const r = await recordPayment(link, invoice);
      if (r.status >= 300 || r.payload?.status === false) {
        console.error("payment link: couldn't record payment", r.payload);
        await release(); // Razorpay retries the webhook
        return res.status(500).json({ status: false, message: "Couldn't record the payment" });
      }
      await PaymentLink.updateOne({ _id: link._id }, { $set: { status: "paid", paid_at: new Date(), razorpay_payment_id: link.razorpay_payment_id, payment_id: r.payload?.payment_id || "" } });
      return res.status(200).json({ status: true, message: "Payment recorded" });
    } catch (error) {
      console.error("razorpay webhook error", error);
      return res.status(500).json({ status: false, message: "Webhook failed" });
    }
  }
}

module.exports = new PaymentLinkController();
