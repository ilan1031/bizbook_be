// Financial goals: a target amount by a date, progress from money put aside and
// linked holdings, and the monthly saving still needed. Money is in whole paise.
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { toPaise, fromPaise } = require("../helpers/accountingHelper");
const Goal = require("../model/goalSchema");
const Investment = require("../model/investmentSchema");

const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const fail = (res, label, error) => {
  console.error(`${label} error`, error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: `Couldn't ${label}` });
};
const scopeOf = (req) => (req.params.scope === "company" || req.params.scope === "personal" ? req.params.scope : null);
const parseDay = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = dayjs(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.year() === Number(m[1]) && d.month() === Number(m[2]) - 1 && d.date() === Number(m[3]) ? d : null;
};
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1e11 && Math.abs(toPaise(n) - n * 100) < 1e-6 ? n : null;
};
const latestValue = (inv) => {
  const last = [...(inv.valuations || [])].sort((a, b) => new Date(a.date) - new Date(b.date)).pop();
  return last ? last.value : inv.cost;
};

// A goal with its progress worked out. `holdings` maps investment id -> document.
const present = (g, holdings) => {
  const today = dayjs().startOf("day");
  const linked = (g.linked_investments || []).map((id) => holdings.get(String(id))).filter(Boolean);
  const putAsideP = (g.contributions || []).reduce((t, c) => t + toPaise(c.amount), 0);
  const heldP = linked.filter((h) => h.status === "active").reduce((t, h) => t + toPaise(latestValue(h)), 0);
  const savedP = putAsideP + heldP;
  const targetP = toPaise(g.target_amount);
  const remainingP = Math.max(targetP - savedP, 0);
  const start = dayjs(g.start_date).startOf("day");
  const end = dayjs(g.target_date).startOf("day");
  const totalDays = Math.max(end.diff(start, "day"), 1);
  const elapsed = Math.min(Math.max(today.diff(start, "day"), 0), totalDays);
  const expectedP = Math.round((targetP * elapsed) / totalDays);
  const monthsLeft = end.isAfter(today) ? Math.max(Math.ceil(end.diff(today, "day") / 30.4375), 1) : 0;
  let status = "on_track";
  if (savedP >= targetP) status = "achieved";
  else if (!end.isAfter(today)) status = "overdue";
  else if (savedP < expectedP * 0.9) status = "behind";
  return {
    _id: g._id, scope: g.scope, name: g.name, note: g.note, target_amount: g.target_amount, start_date: start.format("YYYY-MM-DD"), target_date: end.format("YYYY-MM-DD"),
    saved: fromPaise(savedP), put_aside: fromPaise(putAsideP), from_holdings: fromPaise(heldP), remaining: fromPaise(remainingP),
    percent: targetP ? Math.min(Math.round((savedP / targetP) * 1000) / 10, 100) : 0, expected_by_now: fromPaise(expectedP),
    months_left: monthsLeft, monthly_needed: monthsLeft ? fromPaise(Math.ceil(remainingP / monthsLeft)) : fromPaise(remainingP), status,
    linked_investments: linked.map((h) => ({ _id: h._id, name: h.name, value: latestValue(h), status: h.status })),
    contributions: [...(g.contributions || [])].sort((a, b) => new Date(b.date) - new Date(a.date)).map((c) => ({ _id: c._id, date: dayjs(c.date).format("YYYY-MM-DD"), amount: c.amount, note: c.note })),
  };
};

const loadHoldings = async (goals) => {
  const ids = [...new Set(goals.flatMap((g) => (g.linked_investments || []).map(String)))];
  const docs = ids.length ? await Investment.find({ _id: { $in: ids } }).lean() : [];
  return new Map(docs.map((d) => [String(d._id), d]));
};

// Checks the investments a goal links to: same owner, organisation and scope, still held, and not already used by another goal.
const checkLinks = async (ids, { org, admin_id, scope, exceptGoal }) => {
  if (ids === undefined) return { ids: undefined };
  if (!Array.isArray(ids)) return { error: "Linked holdings must be a list" };
  const unique = [...new Set(ids.map(String))];
  if (unique.some((i) => !mongoose.isValidObjectId(i))) return { error: "One of the linked holdings isn't valid" };
  if (!unique.length) return { ids: [] };
  const found = await Investment.find({ _id: { $in: unique }, organization_id: org, admin_id, scope, status: "active" }, { _id: 1, name: 1 }).lean();
  if (found.length !== unique.length) return { error: "You can only link holdings you still own in this area" };
  const taken = await Goal.findOne({ organization_id: org, admin_id, scope, linked_investments: { $in: unique }, ...(exceptGoal ? { _id: { $ne: exceptGoal } } : {}) }, { name: 1 }).lean();
  if (taken) return { error: `A holding is already counted towards "${taken.name}"` };
  return { ids: unique };
};

const find = async (req, res) => {
  const scope = scopeOf(req);
  const org = String(req.query.org_id || req.body?.org_id || "");
  if (!scope || !/^\d+$/.test(org) || !mongoose.isValidObjectId(req.params.id)) { bad(res, "Goal not found", ST_CODES.NOT_FOUND); return null; }
  const goal = await Goal.findOne({ _id: req.params.id, organization_id: org, admin_id: res.locals.user_id, scope });
  if (!goal) { bad(res, "Goal not found", ST_CODES.NOT_FOUND); return null; }
  return { goal, org, scope };
};

class GoalController {
  // GET /wealth/:scope/goals?org_id=
  async list(req, res) {
    try {
      const scope = scopeOf(req);
      const org = String(req.query.org_id || "");
      if (!scope) return bad(res, "Unknown wealth area", ST_CODES.NOT_FOUND);
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID is required");
      const goals = await Goal.find({ organization_id: org, admin_id: res.locals.user_id, scope }).sort({ target_date: 1 }).lean();
      const holdings = await loadHoldings(goals);
      const available = await Investment.find({ organization_id: org, admin_id: res.locals.user_id, scope, status: "active" }, { name: 1 }).lean();
      res.status(ST_CODES.OK).json({ status: true, data: goals.map((g) => present(g, holdings)), holdings: available.map((h) => ({ _id: h._id, name: h.name })) });
    } catch (error) {
      return fail(res, "load goals", error);
    }
  }

  // POST /wealth/:scope/goals  { org_id, name, target_amount, target_date, start_date?, note?, linked_investments? }
  async create(req, res) {
    try {
      const scope = scopeOf(req);
      const org = String(req.body?.org_id || "");
      const admin_id = res.locals.user_id;
      if (!scope) return bad(res, "Unknown wealth area", ST_CODES.NOT_FOUND);
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID is required");
      const b = req.body || {};
      const name = String(b.name || "").trim();
      if (!name || name.length > 120) return bad(res, "Give the goal a name (up to 120 characters)");
      const target = money(b.target_amount);
      if (target === null) return bad(res, "The target must be more than zero, with at most 2 decimal places");
      const end = parseDay(b.target_date);
      if (!end) return bad(res, "Enter a valid target date");
      const start = b.start_date ? parseDay(b.start_date) : dayjs().startOf("day");
      if (!start) return bad(res, "Enter a valid start date");
      if (!end.isAfter(start)) return bad(res, "The target date must be after the start date");
      if (!end.isAfter(dayjs().startOf("day"))) return bad(res, "The target date must be in the future");
      const links = await checkLinks(b.linked_investments, { org, admin_id, scope });
      if (links.error) return bad(res, links.error);
      const g = await Goal.create({ organization_id: org, admin_id, scope, name, target_amount: target, start_date: start.toDate(), target_date: end.toDate(), note: String(b.note || "").slice(0, 300), linked_investments: links.ids || [] });
      res.status(ST_CODES.CREATED || 201).json({ status: true, data: present(g.toObject(), await loadHoldings([g])) });
    } catch (error) {
      return fail(res, "add the goal", error);
    }
  }

  // PATCH /wealth/:scope/goals/:id  { name?, target_amount?, target_date?, note?, linked_investments? }
  async update(req, res) {
    try {
      const f = await find(req, res);
      if (!f) return;
      const { goal, org, scope } = f;
      const b = req.body || {};
      if (b.name !== undefined) {
        const name = String(b.name).trim();
        if (!name || name.length > 120) return bad(res, "Give the goal a name (up to 120 characters)");
        goal.name = name;
      }
      if (b.target_amount !== undefined) {
        const t = money(b.target_amount);
        if (t === null) return bad(res, "The target must be more than zero, with at most 2 decimal places");
        goal.target_amount = t;
      }
      if (b.target_date !== undefined) {
        const end = parseDay(b.target_date);
        if (!end) return bad(res, "Enter a valid target date");
        if (!end.isAfter(dayjs(goal.start_date))) return bad(res, "The target date must be after the start date");
        goal.target_date = end.toDate();
      }
      if (b.note !== undefined) goal.note = String(b.note).slice(0, 300);
      if (b.linked_investments !== undefined) {
        // Holdings already linked stay allowed even if sold since; only new links are checked.
        const links = await checkLinks(b.linked_investments, { org, admin_id: res.locals.user_id, scope, exceptGoal: goal._id });
        if (links.error) return bad(res, links.error);
        goal.linked_investments = links.ids;
      }
      await goal.save();
      res.status(ST_CODES.OK).json({ status: true, data: present(goal.toObject(), await loadHoldings([goal])) });
    } catch (error) {
      return fail(res, "save the goal", error);
    }
  }

  // DELETE /wealth/:scope/goals/:id
  async remove(req, res) {
    try {
      const f = await find(req, res);
      if (!f) return;
      await f.goal.deleteOne();
      res.status(ST_CODES.OK).json({ status: true, message: "Goal deleted" });
    } catch (error) {
      return fail(res, "delete the goal", error);
    }
  }

  // POST /wealth/:scope/goals/:id/contributions  { date?, amount, note? }
  async contribute(req, res) {
    try {
      const f = await find(req, res);
      if (!f) return;
      const { goal } = f;
      const amount = money(req.body?.amount);
      if (amount === null) return bad(res, "The amount must be more than zero, with at most 2 decimal places");
      const date = req.body?.date ? parseDay(req.body.date) : dayjs();
      if (!date) return bad(res, "Enter a valid date");
      if (date.isAfter(dayjs().endOf("day"))) return bad(res, "The date can't be in the future");
      goal.contributions.push({ date: date.toDate(), amount, note: String(req.body?.note || "").slice(0, 200) });
      await goal.save();
      res.status(ST_CODES.OK).json({ status: true, data: present(goal.toObject(), await loadHoldings([goal])) });
    } catch (error) {
      return fail(res, "save the amount", error);
    }
  }

  // DELETE /wealth/:scope/goals/:id/contributions/:cid
  async uncontribute(req, res) {
    try {
      const f = await find(req, res);
      if (!f) return;
      const { goal } = f;
      const c = goal.contributions.id(req.params.cid);
      if (!c) return bad(res, "Entry not found", ST_CODES.NOT_FOUND);
      c.deleteOne();
      await goal.save();
      res.status(ST_CODES.OK).json({ status: true, data: present(goal.toObject(), await loadHoldings([goal])) });
    } catch (error) {
      return fail(res, "remove the entry", error);
    }
  }
}

module.exports = new GoalController();
