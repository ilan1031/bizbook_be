// Wealth: the investment register. Company holdings are posted to the books
// (Dr Investments Held, Cr the account paid from) and closed with a gain or
// loss entry; their running value changes only in the register, never in the
// ledger, so the books stay at cost. Personal holdings are the owner's own
// record and post nothing. Money is in whole paise.
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const { toPaise, fromPaise, getAccountsMap, formatCurrency } = require("../helpers/accountingHelper");
const { assertUnlocked } = require("../helpers/periodLock");
const Investment = require("../model/investmentSchema");

const KINDS = ["fixed_deposit", "mutual_fund", "shares", "bonds", "gold", "loan_given", "property", "other"];
const HELD_NAME = "Investments Held";
const OPENING_OFFSET = ["AC_043", "Opening Balance Offset"];
const INTEREST_INCOME = "AC_048";
const GENERAL_INCOME = "AC_047";
const OTHER_EXPENSE = "AC_065";
const INTEREST_KINDS = ["fixed_deposit", "bonds", "loan_given"];
const MAX_AMOUNT = 1e11;

const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const fail = (res, label, error) => {
  console.error(`${label} error`, error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: `Couldn't ${label}` });
};
const Journal = () => mongoose.model("Journal");
const COA = () => mongoose.model("Chart_of_account");

const parseDay = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = dayjs(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.year() === Number(m[1]) && d.month() === Number(m[2]) - 1 && d.date() === Number(m[3]) ? d : null;
};
const amountOf = (v, { min = 0, allowZero = false } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n > MAX_AMOUNT || n < min || (!allowZero && n <= 0)) return null;
  return Math.abs(toPaise(n) - n * 100) > 1e-6 ? null : n;
};

const scopeOf = (req) => (req.params.scope === "company" || req.params.scope === "personal" ? req.params.scope : null);

// The asset account company holdings are booked in, created on first use.
const ensureHeldAccount = async (organization_id, admin_id) => {
  const accounts = await getAccountsMap(organization_id, admin_id);
  const found = [...accounts.values()].find((a) => String(a.account_name).trim().toLowerCase() === HELD_NAME.toLowerCase());
  if (found) return found;
  const template = [...accounts.values()].find((a) => a.account_type === "other_asset");
  const max = [...accounts.values()].reduce((m, a) => Math.max(m, Number(String(a.account_id || "").split("_")[1]) || 0), 0);
  const account = {
    account_id: `AC_${String(max + 1).padStart(3, "0")}`, account_name: HELD_NAME, account_code: "", account_type: "other_asset", account_type_formatted: template?.account_type_formatted || "Other Asset",
    description: "Fixed deposits, funds, shares and other holdings, at cost", is_user_created: false, is_system_account: false, is_active: true, can_show_in_ze: false,
    parent_account_id: "", parent_account_name: "", depth: 0, has_attachment: false, is_child_present: false, child_count: null, is_standalone_account: false, is_ze_paid_through_account: false,
  };
  await COA().updateOne({ organization_id: String(organization_id), admin_id }, { $push: { chart_of_accounts: account } });
  return account;
};

const postJournal = async (organization_id, admin_id, { date, type, notes, lines }) => {
  const journal_id = await commonHelper.generateUniqueId(Journal(), "journal_id", 5, "JL");
  const total = lines.filter((l) => l.creditOrDebit === "Debit").reduce((t, l) => t + toPaise(l.amount), 0);
  return Journal().create({
    organization_id: String(organization_id), admin_id, journal_id, journal_date: date, journal_date_formatted: commonHelper.formatDateString(date), type, notes,
    total_amount: fromPaise(total), total_amount_formatted: formatCurrency(fromPaise(total)), posting_status: "posted",
    line_items: lines.map((l) => ({ ...l, amount_formatted: formatCurrency(l.amount) })),
  });
};
const line = (account, side, amount) => ({ coa_account_id: account.account_id, coa_account_name: account.account_name, creditOrDebit: side, amount });
const lockCheck = async (res, admin_id, org, dates) => {
  try {
    await assertUnlocked(admin_id, org, dates);
    return true;
  } catch (e) {
    if (e.code === "PERIOD_LOCKED") {
      bad(res, e.message);
      return false;
    }
    throw e;
  }
};

const present = (inv) => {
  const last = [...(inv.valuations || [])].sort((a, b) => new Date(a.date) - new Date(b.date)).pop();
  const costP = toPaise(inv.cost);
  const current = inv.status === "closed" ? inv.closed?.proceeds ?? 0 : last ? last.value : inv.cost;
  const gainP = toPaise(current) - costP;
  const days = inv.maturity_date && inv.status === "active" ? dayjs(inv.maturity_date).startOf("day").diff(dayjs().startOf("day"), "day") : null;
  return {
    _id: inv._id, scope: inv.scope, name: inv.name, kind: inv.kind, institution: inv.institution, purchase_date: dayjs(inv.purchase_date).format("YYYY-MM-DD"),
    cost: inv.cost, units: inv.units, interest_rate: inv.interest_rate, maturity_date: inv.maturity_date ? dayjs(inv.maturity_date).format("YYYY-MM-DD") : null, note: inv.note,
    status: inv.status, current_value: current, valued_on: last ? dayjs(last.date).format("YYYY-MM-DD") : null, gain: fromPaise(gainP), gain_percent: costP ? Math.round((gainP / costP) * 10000) / 100 : 0,
    days_to_maturity: days, matured: days !== null && days < 0, maturing_soon: days !== null && days >= 0 && days <= 30,
    valuations: [...(inv.valuations || [])].sort((a, b) => new Date(b.date) - new Date(a.date)).map((v) => ({ date: dayjs(v.date).format("YYYY-MM-DD"), value: v.value, note: v.note })),
    posted: Boolean(inv.journal_id), closed: inv.closed?.date ? { date: dayjs(inv.closed.date).format("YYYY-MM-DD"), proceeds: inv.closed.proceeds, gain_or_loss: inv.closed.gain_or_loss } : null,
  };
};

// Validates a personal asset/loan entry. `full` requires every field (create).
function readEntry(b, full) {
  const values = {};
  if (full || b.type !== undefined) {
    if (!["asset", "liability"].includes(b.type)) return { error: "Choose asset or loan" };
    values.type = b.type;
  }
  const type = values.type || b.type;
  if (full || b.name !== undefined) {
    const name = String(b.name || "").trim();
    if (!name || name.length > 120) return { error: "Give it a name (up to 120 characters)" };
    values.name = name;
  }
  if (full || b.category !== undefined) {
    const category = String(b.category || "other");
    const allowed = ["home", "vehicle", "savings", "cash", "gold", "other", "home_loan", "vehicle_loan", "personal_loan", "credit_card"];
    if (!allowed.includes(category)) return { error: "Choose a valid category" };
    values.category = category;
    if (type === "asset" && ["home_loan", "vehicle_loan", "personal_loan", "credit_card"].includes(category)) return { error: "That category is for loans" };
    if (type === "liability" && ["home", "vehicle", "savings", "cash", "gold"].includes(category)) return { error: "That category is for assets" };
  }
  if (full || b.amount !== undefined) {
    const amount = amountOf(b.amount, { allowZero: true });
    if (amount === null) return { error: "Enter the amount (zero or more, at most 2 decimal places)" };
    values.amount = amount;
  }
  if (full || b.as_on !== undefined) {
    const d = b.as_on ? parseDay(b.as_on) : dayjs();
    if (!d) return { error: "Enter a valid date" };
    if (d.isAfter(dayjs().endOf("day"))) return { error: "The date can't be in the future" };
    values.as_on = d.toDate();
  }
  if (b.note !== undefined) values.note = String(b.note).slice(0, 300);
  return { values };
}

const find = async (req, res) => {
  const scope = scopeOf(req);
  const org = String(req.query.org_id || req.body?.org_id || "");
  if (!scope) { bad(res, "Unknown wealth area", ST_CODES.NOT_FOUND); return null; }
  if (!/^\d+$/.test(org)) { bad(res, "Organization ID is required"); return null; }
  if (!mongoose.isValidObjectId(req.params.id)) { bad(res, "Investment not found", ST_CODES.NOT_FOUND); return null; }
  const inv = await Investment.findOne({ _id: req.params.id, organization_id: org, admin_id: res.locals.user_id, scope });
  if (!inv) { bad(res, "Investment not found", ST_CODES.NOT_FOUND); return null; }
  return { inv, org, scope };
};

// ---- Net worth -------------------------------------------------------------
const WealthEntry = require("../model/wealthEntrySchema");
const { POSTED_JOURNALS, isDebitNormal, ASSET_TYPES, LIABILITY_TYPES } = require("../helpers/accountingHelper");

const ENTRY_CATEGORIES = { asset: ["home", "vehicle", "savings", "cash", "gold", "other"], liability: ["home_loan", "vehicle_loan", "personal_loan", "credit_card", "other"] };
const CATEGORY_LABELS = { home: "Home", vehicle: "Vehicle", savings: "Savings", cash: "Cash", gold: "Gold", other: "Other", home_loan: "Home loan", vehicle_loan: "Vehicle loan", personal_loan: "Personal loan", credit_card: "Credit card" };
const KIND_LABELS = { fixed_deposit: "Fixed deposits", mutual_fund: "Mutual funds", shares: "Shares", bonds: "Bonds", gold: "Gold", loan_given: "Loans given", property: "Property", other: "Other investments" };

// What a holding was worth on a date, or null when it was not held then.
const valueAt = (inv, asOf) => {
  if (dayjs(inv.purchase_date).isAfter(asOf, "day")) return null;
  if (inv.status === "closed" && inv.closed?.date && !dayjs(inv.closed.date).isAfter(asOf, "day")) return null;
  const last = [...(inv.valuations || [])].filter((v) => !dayjs(v.date).isAfter(asOf, "day")).sort((a, b) => new Date(a.date) - new Date(b.date)).pop();
  return last ? last.value : inv.cost;
};
const slices = (map, labels) =>
  Object.entries(map).filter(([, p]) => p !== 0).map(([key, p]) => ({ key, label: labels[key] || key, value: fromPaise(p) })).sort((a, b) => b.value - a.value);
const withShare = (list, total) => list.map((s) => ({ ...s, percent: total > 0 ? Math.round((s.value / total) * 1000) / 10 : 0 }));

class WealthController {
  // GET /wealth/:scope/net-worth?org_id=&as_of=
  async netWorth(req, res) {
    try {
      const scope = scopeOf(req);
      const org = String(req.query.org_id || "");
      const admin_id = res.locals.user_id;
      if (!scope) return bad(res, "Unknown wealth area", ST_CODES.NOT_FOUND);
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID is required");
      const asOf = req.query.as_of ? parseDay(req.query.as_of) : dayjs();
      if (!asOf) return bad(res, "as_of must be a valid date");
      const holdings = await Investment.find({ organization_id: org, admin_id, scope }).lean();
      const byKind = {};
      let investP = 0;
      let costP = 0;
      for (const h of holdings) {
        const v = valueAt(h, asOf);
        if (v === null) continue;
        byKind[h.kind] = (byKind[h.kind] || 0) + toPaise(v);
        investP += toPaise(v);
        costP += toPaise(h.cost);
      }

      if (scope === "personal") {
        const entries = (await WealthEntry.find({ organization_id: org, admin_id, as_on: { $lte: asOf.endOf("day").toDate() } }).lean());
        const assetsBy = {};
        const liabBy = {};
        for (const e of entries) {
          const bucket = e.type === "asset" ? assetsBy : liabBy;
          bucket[e.category] = (bucket[e.category] || 0) + toPaise(e.amount);
        }
        const assetsP = investP + Object.values(assetsBy).reduce((t, p) => t + p, 0);
        const liabP = Object.values(liabBy).reduce((t, p) => t + p, 0);
        const allocation = withShare([...slices(byKind, KIND_LABELS), ...slices(assetsBy, CATEGORY_LABELS).map((s) => ({ ...s, key: `asset_${s.key}` }))].sort((a, b) => b.value - a.value), fromPaise(assetsP));
        return res.status(ST_CODES.OK).json({
          status: true,
          data: { scope, as_of: asOf.format("YYYY-MM-DD"), total_assets: fromPaise(assetsP), total_liabilities: fromPaise(liabP), net_worth: fromPaise(assetsP - liabP), investments: fromPaise(investP), invested_cost: fromPaise(costP), allocation, liabilities: slices(liabBy, CATEGORY_LABELS) },
        });
      }

      // Company: the books give assets and liabilities at cost; the register adds what holdings are worth now.
      const [accounts, journals] = await Promise.all([
        getAccountsMap(org, admin_id),
        Journal().find({ organization_id: org, admin_id, journal_date: { $lte: asOf.endOf("day").toDate() }, ...POSTED_JOURNALS }, { line_items: 1 }).lean(),
      ]);
      const bal = new Map();
      for (const j of journals) for (const l of j.line_items || []) bal.set(l.coa_account_id, (bal.get(l.coa_account_id) || 0) + (l.creditOrDebit === "Debit" ? 1 : -1) * toPaise(l.amount || 0));
      const groups = { cash: 0, receivables: 0, stock: 0, fixed: 0, other: 0 };
      const GROUP_OF = { cash: "cash", bank: "cash", accounts_receivable: "receivables", stock: "stock", fixed_asset: "fixed" };
      let assetsP = 0;
      let liabP = 0;
      let heldP = 0;
      for (const [id, signed] of bal) {
        const a = accounts.get(id);
        if (!a) continue;
        if (ASSET_TYPES.includes(a.account_type)) {
          assetsP += signed;
          if (String(a.account_name).trim().toLowerCase() === HELD_NAME.toLowerCase()) heldP += signed;
          else groups[GROUP_OF[a.account_type] || "other"] += signed;
        } else if (LIABILITY_TYPES.includes(a.account_type)) liabP += -signed;
      }
      const unrealisedP = investP - costP;
      const labels = { cash: "Cash and bank", receivables: "Money owed to you", stock: "Stock", fixed: "Fixed assets (net)", other: "Other assets" };
      const bookP = assetsP - liabP;
      // Investments in the register replace the at-cost balance of Investments Held.
      const adjAssetsP = assetsP - heldP + investP;
      const allocation = withShare([...slices(groups, labels), ...slices(byKind, KIND_LABELS)].sort((a, b) => b.value - a.value), fromPaise(adjAssetsP));
      return res.status(ST_CODES.OK).json({
        status: true,
        data: {
          scope, as_of: asOf.format("YYYY-MM-DD"), total_assets: fromPaise(adjAssetsP), total_liabilities: fromPaise(liabP), net_worth: fromPaise(adjAssetsP - liabP),
          net_worth_in_books: fromPaise(bookP), unrealised_gain: fromPaise(unrealisedP), investments: fromPaise(investP), invested_cost: fromPaise(costP),
          register_matches_books: heldP === costP, allocation,
        },
      });
    } catch (error) {
      return fail(res, "work out net worth", error);
    }
  }

  // GET /wealth/personal/entries?org_id=
  async entries(req, res) {
    try {
      const org = String(req.query.org_id || "");
      if (req.params.scope !== "personal") return bad(res, "Not found", ST_CODES.NOT_FOUND);
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID is required");
      const rows = await WealthEntry.find({ organization_id: org, admin_id: res.locals.user_id }).sort({ type: 1, amount: -1 }).lean();
      res.status(ST_CODES.OK).json({ status: true, data: rows.map((e) => ({ ...e, as_on: dayjs(e.as_on).format("YYYY-MM-DD") })), categories: ENTRY_CATEGORIES, labels: CATEGORY_LABELS });
    } catch (error) {
      return fail(res, "load entries", error);
    }
  }

  // POST /wealth/personal/entries  { org_id, type, category, name, amount, as_on?, note? }
  async entryCreate(req, res) {
    try {
      const org = String(req.body?.org_id || "");
      if (req.params.scope !== "personal") return bad(res, "Not found", ST_CODES.NOT_FOUND);
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID is required");
      const read = readEntry(req.body, true);
      if (read.error) return bad(res, read.error);
      const e = await WealthEntry.create({ organization_id: org, admin_id: res.locals.user_id, ...read.values });
      res.status(ST_CODES.CREATED || 201).json({ status: true, data: e });
    } catch (error) {
      return fail(res, "add the entry", error);
    }
  }

  // PATCH /wealth/personal/entries/:id
  async entryUpdate(req, res) {
    try {
      const org = String(req.query.org_id || req.body?.org_id || "");
      if (req.params.scope !== "personal" || !/^\d+$/.test(org) || !mongoose.isValidObjectId(req.params.id)) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      const e = await WealthEntry.findOne({ _id: req.params.id, organization_id: org, admin_id: res.locals.user_id });
      if (!e) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      const read = readEntry({ type: e.type, ...req.body }, false);
      if (read.error) return bad(res, read.error);
      Object.assign(e, read.values);
      await e.save();
      res.status(ST_CODES.OK).json({ status: true, data: e });
    } catch (error) {
      return fail(res, "save the entry", error);
    }
  }

  // DELETE /wealth/personal/entries/:id
  async entryRemove(req, res) {
    try {
      const org = String(req.query.org_id || "");
      if (req.params.scope !== "personal" || !/^\d+$/.test(org) || !mongoose.isValidObjectId(req.params.id)) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      const r = await WealthEntry.deleteOne({ _id: req.params.id, organization_id: org, admin_id: res.locals.user_id });
      if (!r.deletedCount) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      res.status(ST_CODES.OK).json({ status: true, message: "Deleted" });
    } catch (error) {
      return fail(res, "delete the entry", error);
    }
  }

  // GET /wealth/:scope/investments?org_id=&status=active|closed|all
  async list(req, res) {
    try {
      const scope = scopeOf(req);
      const org = String(req.query.org_id || "");
      if (!scope) return bad(res, "Unknown wealth area", ST_CODES.NOT_FOUND);
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID is required");
      const q = { organization_id: org, admin_id: res.locals.user_id, scope };
      const status = req.query.status || "active";
      if (status === "active" || status === "closed") q.status = status;
      const rows = (await Investment.find(q).sort({ purchase_date: -1, _id: -1 }).lean()).map(present);
      const active = rows.filter((r) => r.status === "active");
      const sum = (key) => fromPaise(active.reduce((t, r) => t + toPaise(r[key]), 0));
      const byKind = {};
      for (const r of active) byKind[r.kind] = fromPaise((toPaise(byKind[r.kind] || 0)) + toPaise(r.current_value));
      res.status(ST_CODES.OK).json({ status: true, data: rows, totals: { cost: sum("cost"), current_value: sum("current_value"), gain: sum("gain"), by_kind: byKind } });
    } catch (error) {
      return fail(res, "load investments", error);
    }
  }

  // GET /wealth/:scope/lookups?org_id=  accounts a company holding can be paid from or sold into
  async lookups(req, res) {
    try {
      const org = String(req.query.org_id || "");
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID is required");
      const accounts = [...(await getAccountsMap(org, res.locals.user_id)).values()];
      res.status(ST_CODES.OK).json({
        status: true,
        data: { kinds: KINDS, pay_accounts: accounts.filter((a) => ["cash", "bank"].includes(a.account_type) && a.is_active !== false).map((a) => ({ account_id: a.account_id, account_name: a.account_name })) },
      });
    } catch (error) {
      return fail(res, "load options", error);
    }
  }

  // POST /wealth/:scope/investments
  //   { org_id, name, kind, institution?, purchase_date, cost, units?, interest_rate?, maturity_date?, note?,
  //     pay_account_id? (company: money paid from), already_held? (company: opening holding, no payment) }
  async create(req, res) {
    try {
      const scope = scopeOf(req);
      const org = String(req.body?.org_id || "");
      const admin_id = res.locals.user_id;
      if (!scope) return bad(res, "Unknown wealth area", ST_CODES.NOT_FOUND);
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID is required");
      const b = req.body || {};
      const name = String(b.name || "").trim();
      if (!name || name.length > 120) return bad(res, "Give the holding a name (up to 120 characters)");
      const kind = KINDS.includes(b.kind) ? b.kind : "other";
      const purchase = parseDay(b.purchase_date);
      if (!purchase) return bad(res, "Enter a valid purchase date");
      if (purchase.isAfter(dayjs().endOf("day"))) return bad(res, "The purchase date can't be in the future");
      const cost = amountOf(b.cost);
      if (cost === null) return bad(res, "The amount invested must be more than zero, with at most 2 decimal places");
      const units = b.units === undefined || b.units === "" ? 0 : Number(b.units);
      if (!Number.isFinite(units) || units < 0 || units > 1e12) return bad(res, "Units must be zero or more");
      const rate = b.interest_rate === undefined || b.interest_rate === "" ? 0 : Number(b.interest_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) return bad(res, "The interest rate must be between 0 and 100");
      let maturity = null;
      if (b.maturity_date) {
        maturity = parseDay(b.maturity_date);
        if (!maturity) return bad(res, "Enter a valid maturity date");
        if (maturity.isBefore(purchase)) return bad(res, "The maturity date is before the purchase date");
      }
      const doc = {
        organization_id: org, admin_id, scope, name, kind, institution: String(b.institution || "").trim().slice(0, 120), purchase_date: purchase.toDate(), cost, units, interest_rate: rate,
        maturity_date: maturity ? maturity.toDate() : null, note: String(b.note || "").slice(0, 300),
      };

      let journal = null;
      if (scope === "company") {
        const accounts = await getAccountsMap(org, admin_id);
        let credit;
        if (b.already_held) credit = accounts.get(OPENING_OFFSET[0]) || { account_id: OPENING_OFFSET[0], account_name: OPENING_OFFSET[1] };
        else {
          credit = accounts.get(String(b.pay_account_id || ""));
          if (!credit || credit.is_active === false || !["cash", "bank"].includes(credit.account_type)) return bad(res, "Choose the cash or bank account it was paid from, or mark it as already held");
        }
        if (!(await lockCheck(res, admin_id, org, [purchase]))) return;
        const held = await ensureHeldAccount(org, admin_id);
        journal = await postJournal(org, admin_id, {
          date: purchase.toDate(), type: "Investment", notes: `${b.already_held ? "Opening holding" : "Purchase"}: ${name}`,
          lines: [line(held, "Debit", cost), line(credit, "Credit", cost)],
        });
        doc.journal_id = journal.journal_id;
      }
      let created;
      try {
        created = await Investment.create(doc);
      } catch (e) {
        if (journal) await Journal().deleteOne({ _id: journal._id });
        throw e;
      }
      res.status(ST_CODES.CREATED || 201).json({ status: true, data: present(created.toObject()) });
    } catch (error) {
      return fail(res, "add the investment", error);
    }
  }

  // PATCH /wealth/:scope/investments/:id  { name?, institution?, interest_rate?, maturity_date?, note?, units? }
  async update(req, res) {
    try {
      const f = await find(req, res);
      if (!f) return;
      const { inv } = f;
      const b = req.body || {};
      if (b.name !== undefined) {
        const name = String(b.name).trim();
        if (!name || name.length > 120) return bad(res, "Give the holding a name (up to 120 characters)");
        inv.name = name;
      }
      if (b.institution !== undefined) inv.institution = String(b.institution).trim().slice(0, 120);
      if (b.note !== undefined) inv.note = String(b.note).slice(0, 300);
      if (b.units !== undefined) {
        const u = Number(b.units === "" ? 0 : b.units);
        if (!Number.isFinite(u) || u < 0 || u > 1e12) return bad(res, "Units must be zero or more");
        inv.units = u;
      }
      if (b.interest_rate !== undefined) {
        const r = Number(b.interest_rate === "" ? 0 : b.interest_rate);
        if (!Number.isFinite(r) || r < 0 || r > 100) return bad(res, "The interest rate must be between 0 and 100");
        inv.interest_rate = r;
      }
      if (b.maturity_date !== undefined) {
        if (b.maturity_date === "" || b.maturity_date === null) inv.maturity_date = null;
        else {
          const m = parseDay(b.maturity_date);
          if (!m) return bad(res, "Enter a valid maturity date");
          if (m.isBefore(dayjs(inv.purchase_date).startOf("day"))) return bad(res, "The maturity date is before the purchase date");
          inv.maturity_date = m.toDate();
        }
      }
      await inv.save();
      res.status(ST_CODES.OK).json({ status: true, data: present(inv.toObject()) });
    } catch (error) {
      return fail(res, "save the investment", error);
    }
  }

  // POST /wealth/:scope/investments/:id/valuations  { date, value, note? }  (same date: updated)
  async value(req, res) {
    try {
      const f = await find(req, res);
      if (!f) return;
      const { inv } = f;
      if (inv.status !== "active") return bad(res, "This holding is closed");
      const date = parseDay(req.body?.date);
      if (!date) return bad(res, "Enter a valid date");
      if (date.isAfter(dayjs().endOf("day"))) return bad(res, "A value can't be dated in the future");
      if (date.isBefore(dayjs(inv.purchase_date).startOf("day"))) return bad(res, "The value is dated before the purchase");
      const value = amountOf(req.body?.value, { allowZero: true });
      if (value === null) return bad(res, "Enter the value (zero or more, at most 2 decimal places)");
      const existing = inv.valuations.find((v) => dayjs(v.date).isSame(date, "day"));
      if (existing) {
        existing.value = value;
        existing.note = String(req.body?.note || "").slice(0, 200);
      } else inv.valuations.push({ date: date.toDate(), value, note: String(req.body?.note || "").slice(0, 200) });
      await inv.save();
      res.status(ST_CODES.OK).json({ status: true, data: present(inv.toObject()) });
    } catch (error) {
      return fail(res, "save the value", error);
    }
  }

  // POST /wealth/:scope/investments/:id/close  { date, proceeds, deposit_account_id? }  sold or matured
  async close(req, res) {
    try {
      const f = await find(req, res);
      if (!f) return;
      const { inv, org, scope } = f;
      const admin_id = res.locals.user_id;
      if (inv.status !== "active") return bad(res, "This holding is already closed");
      const date = parseDay(req.body?.date);
      if (!date) return bad(res, "Enter a valid date");
      if (date.isAfter(dayjs().endOf("day"))) return bad(res, "The date can't be in the future");
      if (date.isBefore(dayjs(inv.purchase_date).startOf("day"))) return bad(res, "The date is before the purchase");
      const proceeds = amountOf(req.body?.proceeds, { allowZero: true });
      if (proceeds === null) return bad(res, "Enter what was received (zero or more, at most 2 decimal places)");
      let journal = null;
      const gainP = toPaise(proceeds) - toPaise(inv.cost);
      if (scope === "company") {
        const accounts = await getAccountsMap(org, admin_id);
        const deposit = accounts.get(String(req.body?.deposit_account_id || ""));
        if (proceeds > 0 && (!deposit || deposit.is_active === false || !["cash", "bank"].includes(deposit.account_type))) return bad(res, "Choose the cash or bank account the money went into");
        if (!(await lockCheck(res, admin_id, org, [date]))) return;
        const held = await ensureHeldAccount(org, admin_id);
        const lines = [];
        if (proceeds > 0) lines.push(line(deposit, "Debit", proceeds));
        lines.push(line(held, "Credit", inv.cost));
        if (gainP > 0) {
          const income = accounts.get(INTEREST_KINDS.includes(inv.kind) ? INTEREST_INCOME : GENERAL_INCOME);
          if (!income) return bad(res, "The income account for this gain is missing from your chart of accounts");
          lines.push(line(income, "Credit", fromPaise(gainP)));
        } else if (gainP < 0) {
          const expense = accounts.get(OTHER_EXPENSE);
          if (!expense) return bad(res, "The expense account for this loss is missing from your chart of accounts");
          lines.push(line(expense, "Debit", fromPaise(-gainP)));
        }
        journal = await postJournal(org, admin_id, { date: date.toDate(), type: "Investment Sale", notes: `${inv.kind === "fixed_deposit" ? "Matured" : "Sold"}: ${inv.name}`, lines });
      }
      inv.status = "closed";
      inv.closed = { date: date.toDate(), proceeds, gain_or_loss: fromPaise(gainP), journal_id: journal?.journal_id || "" };
      try {
        await inv.save();
      } catch (e) {
        if (journal) await Journal().deleteOne({ _id: journal._id });
        throw e;
      }
      res.status(ST_CODES.OK).json({ status: true, data: present(inv.toObject()) });
    } catch (error) {
      return fail(res, "close the investment", error);
    }
  }

  // DELETE /wealth/:scope/investments/:id  only an open holding; its purchase entry goes with it
  async remove(req, res) {
    try {
      const f = await find(req, res);
      if (!f) return;
      const { inv, org } = f;
      if (inv.status !== "active") return bad(res, "A closed holding can't be deleted");
      if (inv.scope === "company" && inv.journal_id) {
        if (!(await lockCheck(res, res.locals.user_id, org, [inv.purchase_date]))) return;
        await Journal().deleteOne({ journal_id: inv.journal_id, organization_id: org });
      }
      await inv.deleteOne();
      res.status(ST_CODES.OK).json({ status: true, message: "Investment deleted" });
    } catch (error) {
      return fail(res, "delete the investment", error);
    }
  }
}

module.exports = new WealthController();
