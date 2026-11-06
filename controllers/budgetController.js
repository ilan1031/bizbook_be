// Budgets and the Budget vs Actual report. A budget is twelve monthly amounts
// per income or expense account; the report sets them against the posted
// journals for the same months. Money is in whole paise.
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const { POSTED_JOURNALS, INCOME_TYPES, EXPENSE_TYPES, toPaise, fromPaise, getAccountsMap } = require("../helpers/accountingHelper");

const Budget = () => mongoose.model("Budget");
const Journal = () => mongoose.model("Journal");

const MAX_LINES = 200;
const MAX_AMOUNT = 100000000000; // 1,000 crore a month: a typo guard, not a real limit
const bad = (res, message) => res.status(ST_CODES.BAD_REQUEST).json({ status: false, message });
const fail = (res, label, error) => {
  console.log(`${label} error`, error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: `Couldn't ${label}` });
};

const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));
const monthList = (start) => Array.from({ length: 12 }, (_, i) => dayjs(`${start}-01`).add(i, "month").format("YYYY-MM"));

// Validates a budget body; returns { error } or { values }.
const readBudget = async (body, organization_id, admin_id) => {
  const name = String(body.name || "").trim();
  if (!name) return { error: "Give the budget a name" };
  if (name.length > 120) return { error: "The name can be at most 120 characters" };
  if (!isMonth(body.start_month)) return { error: "Choose the month the budget starts (YYYY-MM)" };
  if (!Array.isArray(body.lines) || body.lines.length === 0) return { error: "Add at least one account to the budget" };
  if (body.lines.length > MAX_LINES) return { error: `A budget can have at most ${MAX_LINES} accounts` };
  const accounts = await getAccountsMap(organization_id, admin_id);
  const seen = new Set();
  const lines = [];
  for (const [index, line] of body.lines.entries()) {
    const label = `Line ${index + 1}`;
    const account = accounts.get(String(line?.account_id || ""));
    if (!account || ![...INCOME_TYPES, ...EXPENSE_TYPES].includes(account.account_type)) return { error: `${label}: choose an income or expense account` };
    if (seen.has(account.account_id)) return { error: `${account.account_name} is in the budget twice` };
    seen.add(account.account_id);
    if (!Array.isArray(line.amounts) || line.amounts.length !== 12) return { error: `${label}: give an amount for each of the 12 months` };
    const amounts = [];
    for (const raw of line.amounts) {
      const n = Number(raw === "" || raw === null || raw === undefined ? 0 : raw);
      if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return { error: `${label}: amounts must be numbers of zero or more` };
      if (Math.abs(toPaise(n) - n * 100) > 1e-6) return { error: `${label}: amounts can have at most 2 decimal places` };
      amounts.push(n);
    }
    lines.push({ account_id: account.account_id, amounts });
  }
  return { values: { name, start_month: body.start_month, lines } };
};

const present = (b, accounts) => ({
  _id: b._id,
  budget_id: b.budget_id,
  name: b.name,
  start_month: b.start_month,
  end_month: dayjs(`${b.start_month}-01`).add(11, "month").format("YYYY-MM"),
  lines: (b.lines || []).map((l) => ({ account_id: l.account_id, account_name: accounts?.get(l.account_id)?.account_name || l.account_id, account_type: accounts?.get(l.account_id)?.account_type || "", amounts: l.amounts, total: fromPaise(l.amounts.reduce((t, n) => t + toPaise(n), 0)) })),
});

class BudgetController {
  async list(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const accounts = await getAccountsMap(organization_id, admin_id);
      const budgets = await Budget().find({ organization_id: String(organization_id), admin_id }).sort({ createdAt: -1 }).lean();
      const options = [...accounts.values()]
        .filter((a) => a.is_active !== false && [...INCOME_TYPES, ...EXPENSE_TYPES].includes(a.account_type))
        .map((a) => ({ account_id: a.account_id, account_name: a.account_name, account_type: a.account_type, kind: INCOME_TYPES.includes(a.account_type) ? "income" : "expense" }))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.account_name.localeCompare(b.account_name));
      res.status(ST_CODES.OK).json({ status: true, data: { budgets: budgets.map((b) => present(b, accounts)), accounts: options } });
    } catch (error) {
      return fail(res, "load the budgets", error);
    }
  }

  async create(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      const read = await readBudget(req.body, org_id, admin_id);
      if (read.error) return bad(res, read.error);
      const budget_id = await commonHelper.generateUniqueId(Budget(), "budget_id", 4, "BG");
      const doc = await Budget().create({ organization_id: String(org_id), admin_id, budget_id, created_by_id: String(res.locals.actor_id || admin_id), ...read.values });
      res.status(201).json({ status: true, data: present(doc.toObject(), await getAccountsMap(org_id, admin_id)) });
    } catch (error) {
      return fail(res, "save the budget", error);
    }
  }

  async update(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      const doc = await Budget().findOne({ _id: req.params.id, organization_id: String(org_id), admin_id });
      if (!doc) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Budget not found" });
      const read = await readBudget({ name: doc.name, start_month: doc.start_month, lines: doc.lines.map((l) => ({ account_id: l.account_id, amounts: l.amounts })), ...req.body }, org_id, admin_id);
      if (read.error) return bad(res, read.error);
      Object.assign(doc, read.values);
      await doc.save();
      res.status(ST_CODES.OK).json({ status: true, data: present(doc.toObject(), await getAccountsMap(org_id, admin_id)) });
    } catch (error) {
      return fail(res, "save the budget", error);
    }
  }

  async remove(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const done = await Budget().deleteOne({ _id: req.params.id, organization_id: String(organization_id), admin_id });
      if (done.deletedCount !== 1) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Budget not found" });
      res.status(ST_CODES.OK).json({ status: true, message: "Deleted" });
    } catch (error) {
      return fail(res, "delete the budget", error);
    }
  }

  // GET /reports/budget-vs-actual?org_id=&budget_id=&from_month=&to_month=
  async versusActual(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      if (!req.query.budget_id || !mongoose.isValidObjectId(req.query.budget_id)) return bad(res, "Choose a budget");
      const budget = await Budget().findOne({ _id: req.query.budget_id, organization_id: String(organization_id), admin_id }).lean();
      if (!budget) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Budget not found" });
      const months = monthList(budget.start_month);
      const defaultTo = months.includes(dayjs().format("YYYY-MM")) ? dayjs().format("YYYY-MM") : dayjs().isBefore(dayjs(`${months[0]}-01`)) ? months[0] : months[11];
      const fromMonth = req.query.from_month || months[0];
      const toMonth = req.query.to_month || defaultTo;
      if (!months.includes(fromMonth) || !months.includes(toMonth)) return bad(res, "The months must be inside the budget's twelve months");
      if (fromMonth > toMonth) return bad(res, "The first month must be on or before the last");
      const inRange = months.map((m) => m >= fromMonth && m <= toMonth);

      const accounts = await getAccountsMap(organization_id, admin_id);
      const journals = await Journal()
        .find(
          { organization_id: String(organization_id), admin_id, journal_date: { $gte: dayjs(`${fromMonth}-01`).startOf("month").toDate(), $lte: dayjs(`${toMonth}-01`).endOf("month").toDate() }, ...POSTED_JOURNALS },
          { line_items: 1 }
        )
        .lean();
      // actual per account, in the account's own direction (income: credits - debits)
      const actual = new Map();
      for (const j of journals) {
        for (const l of j.line_items || []) {
          const account = accounts.get(l.coa_account_id);
          if (!account) continue;
          const isIncome = INCOME_TYPES.includes(account.account_type);
          if (!isIncome && !EXPENSE_TYPES.includes(account.account_type)) continue;
          const paise = toPaise(l.amount || 0);
          const debit = l.creditOrDebit === "Debit";
          actual.set(l.coa_account_id, (actual.get(l.coa_account_id) || 0) + (isIncome ? (debit ? -paise : paise) : debit ? paise : -paise));
        }
      }

      const budgeted = new Map(budget.lines.map((l) => [l.account_id, l.amounts.reduce((t, n, i) => t + (inRange[i] ? toPaise(n) : 0), 0)]));
      const ids = new Set([...budgeted.keys(), ...[...actual.entries()].filter(([, v]) => v !== 0).map(([k]) => k)]);
      const rows = [...ids].map((id) => {
        const account = accounts.get(id);
        const kind = INCOME_TYPES.includes(account.account_type) ? "income" : "expense";
        const b = budgeted.get(id) || 0;
        const a = actual.get(id) || 0;
        // Favourable (positive) is more income than planned, or less spend.
        const variance = kind === "income" ? a - b : b - a;
        return { account_id: id, account_name: account.account_name, kind, budgeted: !budgeted.has(id) ? false : true, budget: fromPaise(b), actual: fromPaise(a), variance: fromPaise(variance), percent_used: b > 0 ? Math.round((a / b) * 1000) / 10 : null };
      });
      rows.sort((x, y) => x.kind.localeCompare(y.kind) || x.account_name.localeCompare(y.account_name));
      const sum = (kind, field) => rows.filter((r) => r.kind === kind).reduce((t, r) => t + toPaise(r[field]), 0);
      const totals = {
        income: { budget: fromPaise(sum("income", "budget")), actual: fromPaise(sum("income", "actual")) },
        expense: { budget: fromPaise(sum("expense", "budget")), actual: fromPaise(sum("expense", "actual")) },
      };
      totals.net = { budget: fromPaise(toPaise(totals.income.budget) - toPaise(totals.expense.budget)), actual: fromPaise(toPaise(totals.income.actual) - toPaise(totals.expense.actual)) };
      res.status(ST_CODES.OK).json({
        status: true,
        data: { budget: { _id: budget._id, name: budget.name, start_month: budget.start_month, months }, from_month: fromMonth, to_month: toMonth, rows, totals },
      });
    } catch (error) {
      return fail(res, "compare the budget with the books", error);
    }
  }
}

module.exports = new BudgetController();
