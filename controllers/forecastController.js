// Cash forecast: month by month, what cash is expected to come in and go out,
// starting from the cash and bank balance in the books today.
//
// Coming in: unpaid invoices on their due date (overdue ones in the first
// month), company deposits and bonds on their maturity date, and anything the
// owner has planned. Going out: unpaid bills on their due date (overdue ones
// in the first month) and planned payments. Customers can be assumed to pay
// late with the `delay` setting. Money is in whole paise.
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
dayjs.extend(customParseFormat);
const ST_CODES = require("../helpers/statusCodeHelpers");
const { POSTED_JOURNALS, toPaise, fromPaise, getAccountsMap } = require("../helpers/accountingHelper");
const Investment = require("../model/investmentSchema");
const ForecastItem = require("../model/forecastItemSchema");

const MONTH_CHOICES = [3, 6, 12];
const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const fail = (res, label, error) => {
  console.error(`${label} error`, error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: `Couldn't ${label}` });
};
const orgOf = (req) => {
  const raw = String(req.query.org_id || req.body?.org_id || "");
  return /^\d+$/.test(raw) ? raw : null;
};
const parse = (v) => {
  if (!v) return null;
  const d = dayjs(v, ["YYYY-MM-DD", "DD-MM-YYYY"], false);
  if (d.isValid()) return d;
  const x = dayjs(v);
  return x.isValid() ? x : null;
};
const parseStrict = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = dayjs(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.year() === Number(m[1]) && d.month() === Number(m[2]) - 1 && d.date() === Number(m[3]) ? d : null;
};

class ForecastController {
  // GET /wealth/company/forecast?org_id=&months=3|6|12&delay=0
  async forecast(req, res) {
    try {
      const org = orgOf(req);
      const admin_id = res.locals.user_id;
      if (!org) return bad(res, "Organization ID is required");
      const months = Number(req.query.months || 6);
      if (!MONTH_CHOICES.includes(months)) return bad(res, "Choose 3, 6 or 12 months");
      const delay = req.query.delay === undefined || req.query.delay === "" ? 0 : Number(req.query.delay);
      if (!Number.isInteger(delay) || delay < 0 || delay > 90) return bad(res, "Payment delay must be a whole number of days from 0 to 90");

      const today = dayjs().startOf("day");
      const start = today.startOf("month");
      const horizon = start.add(months, "month"); // first day after the forecast
      const slot = (d) => {
        // Month index of a date; anything already past counts in the first month.
        if (!d) return null;
        const i = d.startOf("month").diff(start, "month");
        if (i >= months) return null;
        return Math.max(i, 0);
      };
      const grid = Array.from({ length: months }, (_, i) => ({
        month: start.add(i, "month").format("YYYY-MM"), label: start.add(i, "month").format("MMM YYYY"),
        receivables: 0, maturities: 0, planned_in: 0, payables: 0, planned_out: 0,
      }));

      const [accounts, journals, invoices, bills, holdings, planned] = await Promise.all([
        getAccountsMap(org, admin_id),
        mongoose.model("Journal").find({ organization_id: org, admin_id, journal_date: { $lte: new Date() }, ...POSTED_JOURNALS }, { line_items: 1 }).lean(),
        mongoose.model("Invoice").find({ organization_id: Number(org), admin_id, status: { $nin: ["draft", "Draft", "void", "Void"] }, balance: { $gt: 0 } }).select("due_date date balance").lean(),
        mongoose.model("PO_bill").find({ organization_id: Number(org), admin_id, status_type: { $nin: ["DRAFT", "VOID", "PAID"] }, balance: { $gt: 0 } }).select("due_date billDate balance").lean(),
        Investment.find({ organization_id: org, admin_id, scope: "company", status: "active", maturity_date: { $ne: null } }).lean(),
        ForecastItem.find({ organization_id: org, admin_id, date: { $lt: horizon.toDate() } }).lean(),
      ]);

      let openingP = 0;
      for (const j of journals) {
        for (const l of j.line_items || []) {
          const a = accounts.get(l.coa_account_id);
          if (a && ["cash", "bank"].includes(a.account_type)) openingP += (l.creditOrDebit === "Debit" ? 1 : -1) * toPaise(l.amount || 0);
        }
      }

      let overdueInP = 0;
      let laterInP = 0;
      for (const inv of invoices) {
        const due = parse(inv.due_date) || parse(inv.date);
        if (!due) continue;
        const when = due.add(delay, "day");
        if (when.isBefore(today)) overdueInP += toPaise(inv.balance);
        const i = slot(when);
        if (i === null) laterInP += toPaise(inv.balance);
        else grid[i].receivables += toPaise(inv.balance);
      }
      let overdueOutP = 0;
      let laterOutP = 0;
      for (const bill of bills) {
        const due = parse(bill.due_date) || parse(bill.billDate);
        if (!due) continue;
        if (due.isBefore(today)) overdueOutP += toPaise(bill.balance);
        const i = slot(due);
        if (i === null) laterOutP += toPaise(bill.balance);
        else grid[i].payables += toPaise(bill.balance);
      }
      for (const h of holdings) {
        const i = slot(dayjs(h.maturity_date));
        if (i === null) continue;
        const last = [...(h.valuations || [])].sort((a, b) => new Date(a.date) - new Date(b.date)).pop();
        grid[i].maturities += toPaise(last ? last.value : h.cost);
      }
      for (const p of planned) {
        const i = slot(dayjs(p.date));
        if (i === null) continue;
        if (p.direction === "in") grid[i].planned_in += toPaise(p.amount);
        else grid[i].planned_out += toPaise(p.amount);
      }

      let running = openingP;
      let lowP = openingP;
      let lowMonth = null;
      let firstShort = null;
      const rows = grid.map((g) => {
        const inflow = g.receivables + g.maturities + g.planned_in;
        const outflow = g.payables + g.planned_out;
        running += inflow - outflow;
        if (running < lowP || lowMonth === null) {
          if (running < lowP) { lowP = running; lowMonth = g.label; }
        }
        if (running < 0 && !firstShort) firstShort = g.label;
        return {
          month: g.month, label: g.label,
          inflow: { receivables: fromPaise(g.receivables), maturities: fromPaise(g.maturities), planned: fromPaise(g.planned_in), total: fromPaise(inflow) },
          outflow: { payables: fromPaise(g.payables), planned: fromPaise(g.planned_out), total: fromPaise(outflow) },
          net: fromPaise(inflow - outflow), closing: fromPaise(running),
        };
      });
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          months, delay, as_of: today.format("YYYY-MM-DD"), opening_cash: fromPaise(openingP), rows,
          lowest: { amount: fromPaise(lowP), month: lowMonth }, first_shortfall: firstShort,
          overdue: { receivables: fromPaise(overdueInP), payables: fromPaise(overdueOutP) },
          beyond_horizon: { receivables: fromPaise(laterInP), payables: fromPaise(laterOutP) },
          assumptions: [
            "Unpaid invoices and bills are counted on their due date; overdue ones fall in the first month.",
            delay ? `Customers are assumed to pay ${delay} days after the due date.` : "Customers are assumed to pay on the due date.",
            "Recurring invoices and expenses that are not yet issued are not included; add them as planned items.",
          ],
        },
      });
    } catch (error) {
      return fail(res, "build the forecast", error);
    }
  }

  // GET /wealth/company/forecast-items?org_id=
  async items(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const rows = await ForecastItem.find({ organization_id: org, admin_id: res.locals.user_id }).sort({ date: 1 }).lean();
      res.status(ST_CODES.OK).json({ status: true, data: rows.map((r) => ({ ...r, date: dayjs(r.date).format("YYYY-MM-DD") })) });
    } catch (error) {
      return fail(res, "load planned items", error);
    }
  }

  // POST /wealth/company/forecast-items  { org_id, label, direction: in|out, amount, date }
  async itemCreate(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const b = req.body || {};
      const label = String(b.label || "").trim();
      if (!label || label.length > 120) return bad(res, "Give it a label (up to 120 characters)");
      if (!["in", "out"].includes(b.direction)) return bad(res, "Choose money in or money out");
      const amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e11 || Math.abs(toPaise(amount) - amount * 100) > 1e-6) return bad(res, "The amount must be more than zero, with at most 2 decimal places");
      const date = parseStrict(b.date);
      if (!date) return bad(res, "Enter a valid date");
      if (date.isBefore(dayjs().startOf("month"))) return bad(res, "Planned items must be in this month or later");
      const item = await ForecastItem.create({ organization_id: org, admin_id: res.locals.user_id, label, direction: b.direction, amount, date: date.toDate() });
      res.status(ST_CODES.CREATED || 201).json({ status: true, data: item });
    } catch (error) {
      return fail(res, "add the planned item", error);
    }
  }

  // DELETE /wealth/company/forecast-items/:id
  async itemRemove(req, res) {
    try {
      const org = orgOf(req);
      if (!org || !mongoose.isValidObjectId(req.params.id)) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      const r = await ForecastItem.deleteOne({ _id: req.params.id, organization_id: org, admin_id: res.locals.user_id });
      if (!r.deletedCount) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      res.status(ST_CODES.OK).json({ status: true, message: "Removed" });
    } catch (error) {
      return fail(res, "remove the planned item", error);
    }
  }
}

module.exports = new ForecastController();
