// Fixed assets: the register, monthly depreciation posted to the books, and
// disposal. Depreciation is one journal per asset per month (Dr depreciation
// expense, Cr accumulated depreciation), so every period's profit and loss and
// the balance sheet are right. Money is in whole paise.
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const { toPaise, fromPaise, getAccountsMap, formatCurrency } = require("../helpers/accountingHelper");
const { buildSchedule, dueEntries } = require("../helpers/depreciation");
const { lockedUntil, assertUnlocked } = require("../helpers/periodLock");

const Asset = () => mongoose.model("FixedAsset");
const Journal = () => mongoose.model("Journal");
const COA = () => mongoose.model("Chart_of_account");

const MAX_RUN_MONTHS = 120;
const ACCUMULATED_NAME = "Accumulated Depreciation";

const bad = (res, message) => res.status(ST_CODES.BAD_REQUEST).json({ status: false, message });
const fail = (res, label, error) => {
  console.log(`${label} error`, error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: `Couldn't ${label}` });
};

const parseDay = (v) => {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = dayjs(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.year() === Number(m[1]) && d.month() === Number(m[2]) - 1 && d.date() === Number(m[3]) ? d : null;
};

// The contra-asset account depreciation builds up in. Created in the chart of
// accounts the first time it is needed.
const ensureAccumulatedAccount = async (organization_id, admin_id) => {
  const accounts = await getAccountsMap(organization_id, admin_id);
  const found = [...accounts.values()].find((a) => String(a.account_name).trim().toLowerCase() === ACCUMULATED_NAME.toLowerCase());
  if (found) return found.account_id;
  const template = [...accounts.values()].find((a) => a.account_type === "fixed_asset");
  const max = [...accounts.values()].reduce((m, a) => Math.max(m, Number(String(a.account_id || "").split("_")[1]) || 0), 0);
  const account_id = `AC_${String(max + 1).padStart(3, "0")}`;
  await COA().updateOne(
    { organization_id: String(organization_id), admin_id },
    {
      $push: {
        chart_of_accounts: {
          account_id, account_name: ACCUMULATED_NAME, account_code: "", account_type: "fixed_asset", account_type_formatted: template?.account_type_formatted || "Fixed Asset",
          description: "Depreciation charged so far on fixed assets", is_user_created: false, is_system_account: false, is_active: true, can_show_in_ze: false,
          parent_account_id: "", parent_account_name: "", depth: 0, has_attachment: false, is_child_present: false, child_count: null, is_standalone_account: false, is_ze_paid_through_account: false,
        },
      },
    }
  );
  return account_id;
};

// An asset with its figures worked out.
const present = (a, upTo = dayjs()) => {
  const schedule = buildSchedule(a);
  const due = a.status === "active" ? dueEntries(a, upTo) : [];
  const cost = toPaise(a.cost);
  const accumulated = toPaise(a.accumulated_depreciation);
  return {
    _id: a._id,
    asset_id: a.asset_id,
    name: a.name,
    description: a.description,
    purchase_date: dayjs(a.purchase_date).format("YYYY-MM-DD"),
    depreciation_start_date: dayjs(a.depreciation_start_date).format("YYYY-MM-DD"),
    cost: a.cost,
    salvage_value: a.salvage_value,
    method: a.method,
    useful_life_months: a.useful_life_months,
    rate: a.rate,
    asset_account_id: a.asset_account_id,
    expense_account_id: a.expense_account_id,
    accumulated_account_id: a.accumulated_account_id,
    status: a.status,
    accumulated_depreciation: fromPaise(accumulated),
    book_value: fromPaise(cost - accumulated),
    months_posted: (a.postings || []).length,
    months_total: schedule.length,
    monthly_depreciation: schedule.length ? fromPaise(schedule[Math.min((a.postings || []).length, schedule.length - 1)].amount) : 0,
    due_months: due.length,
    due_amount: fromPaise(due.reduce((t, r) => t + r.amount, 0)),
    can_change_figures: (a.postings || []).length === 0 && a.status === "active",
    disposal: a.disposal?.date ? { date: dayjs(a.disposal.date).format("YYYY-MM-DD"), proceeds: a.disposal.proceeds, gain_or_loss: a.disposal.gain_or_loss } : null,
  };
};

// Validates the figures of an asset; returns { error } or { values }.
const readFigures = async (body, organization_id, admin_id) => {
  const name = String(body.name || "").trim();
  if (!name) return { error: "Give the asset a name" };
  if (name.length > 120) return { error: "The name can be at most 120 characters" };
  const purchase = parseDay(body.purchase_date);
  if (!purchase) return { error: "The purchase date must be a valid date (YYYY-MM-DD)" };
  const start = body.depreciation_start_date ? parseDay(body.depreciation_start_date) : purchase;
  if (!start) return { error: "The depreciation start date must be a valid date (YYYY-MM-DD)" };
  const cost = Number(body.cost);
  const salvage = Number(body.salvage_value || 0);
  if (!Number.isFinite(cost) || cost <= 0) return { error: "The cost must be more than zero" };
  if (!Number.isFinite(salvage) || salvage < 0 || salvage >= cost) return { error: "The salvage value must be zero or more, and less than the cost" };
  if (Math.abs(toPaise(cost) - cost * 100) > 1e-6 || Math.abs(toPaise(salvage) - salvage * 100) > 1e-6) return { error: "Amounts can have at most 2 decimal places" };
  const method = body.method === "wdv" ? "wdv" : "straight_line";
  const life = Math.floor(Number(body.useful_life_months || 0));
  const rate = Number(body.rate || 0);
  if (method === "straight_line" && (!Number.isFinite(life) || life < 1 || life > 1200)) return { error: "Useful life must be between 1 and 1200 months" };
  if (method === "wdv" && (!Number.isFinite(rate) || rate <= 0 || rate > 100)) return { error: "The yearly rate must be more than 0 and at most 100 percent" };

  const accounts = await getAccountsMap(organization_id, admin_id);
  const pick = (id, label, types) => {
    const a = accounts.get(String(id || ""));
    if (!a || a.is_active === false || !types.includes(a.account_type)) return { error: `Choose a valid ${label}` };
    return { account: a };
  };
  const asset = pick(body.asset_account_id, "fixed asset account", ["fixed_asset"]);
  if (asset.error) return { error: asset.error };
  const expense = pick(body.expense_account_id, "depreciation expense account", ["expense"]);
  if (expense.error) return { error: expense.error };
  return {
    values: {
      name, description: String(body.description || "").slice(0, 500), purchase_date: purchase.toDate(), depreciation_start_date: start.toDate(), cost, salvage_value: salvage, method,
      useful_life_months: method === "straight_line" ? life : 0, rate: method === "wdv" ? rate : 0, asset_account_id: asset.account.account_id, expense_account_id: expense.account.account_id,
    },
  };
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

class FixedAssetController {
  async list(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const upTo = req.query.up_to ? parseDay(req.query.up_to) : dayjs();
      if (!upTo) return bad(res, "up_to must be a valid date");
      const assets = await Asset().find({ organization_id: String(organization_id), admin_id }).sort({ createdAt: 1 }).lean();
      const rows = assets.map((a) => present(a, upTo));
      // The accounts the forms offer, so the page needs no chart-of-accounts access.
      const all = [...(await getAccountsMap(organization_id, admin_id)).values()].filter((a) => a.is_active !== false);
      const options = (types) => all.filter((a) => types.includes(a.account_type)).map((a) => ({ account_id: a.account_id, account_name: a.account_name })).sort((x, y) => x.account_name.localeCompare(y.account_name));
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          assets: rows,
          accounts: {
            asset: options(["fixed_asset"]),
            expense: options(["expense"]),
            proceeds: options(["bank", "cash", "other_current_asset", "accounts_receivable"]),
            income: options(["income", "other_income"]),
            loss: options(["expense", "other_expense"]),
          },
          totals: {
            cost: rows.reduce((t, r) => t + toPaise(r.cost), 0) / 100,
            accumulated: rows.reduce((t, r) => t + toPaise(r.accumulated_depreciation), 0) / 100,
            book_value: rows.filter((r) => r.status === "active").reduce((t, r) => t + toPaise(r.book_value), 0) / 100,
            due_amount: rows.reduce((t, r) => t + toPaise(r.due_amount), 0) / 100,
          },
        },
      });
    } catch (error) {
      return fail(res, "load the assets", error);
    }
  }

  async create(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      const read = await readFigures(req.body, org_id, admin_id);
      if (read.error) return bad(res, read.error);
      const accumulated_account_id = await ensureAccumulatedAccount(org_id, admin_id);
      const asset_id = await commonHelper.generateUniqueId(Asset(), "asset_id", 4, "FA");
      const asset = await Asset().create({ organization_id: String(org_id), admin_id, asset_id, accumulated_account_id, created_by_id: String(res.locals.actor_id || admin_id), ...read.values });
      res.status(201).json({ status: true, data: present(asset.toObject()) });
    } catch (error) {
      return fail(res, "add the asset", error);
    }
  }

  async update(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      const asset = await Asset().findOne({ _id: req.params.id, organization_id: String(org_id), admin_id });
      if (!asset) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Asset not found" });
      if (asset.status === "disposed") return bad(res, "A disposed asset can't be changed");
      // Once depreciation is posted the figures are part of the books.
      if (asset.postings.length > 0) {
        const name = String(req.body.name ?? asset.name).trim();
        if (!name) return bad(res, "Give the asset a name");
        asset.name = name.slice(0, 120);
        asset.description = String(req.body.description ?? asset.description).slice(0, 500);
      } else {
        const read = await readFigures({ ...asset.toObject(), purchase_date: dayjs(asset.purchase_date).format("YYYY-MM-DD"), depreciation_start_date: dayjs(asset.depreciation_start_date).format("YYYY-MM-DD"), ...req.body }, org_id, admin_id);
        if (read.error) return bad(res, read.error);
        Object.assign(asset, read.values);
      }
      await asset.save();
      res.status(ST_CODES.OK).json({ status: true, data: present(asset.toObject()) });
    } catch (error) {
      return fail(res, "update the asset", error);
    }
  }

  async remove(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const asset = await Asset().findOne({ _id: req.params.id, organization_id: String(organization_id), admin_id });
      if (!asset) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Asset not found" });
      if (asset.postings.length > 0 || asset.status === "disposed") return bad(res, "Depreciation has been posted for this asset, so it can't be deleted. Dispose of it instead.");
      await asset.deleteOne();
      res.status(ST_CODES.OK).json({ status: true, message: "Deleted" });
    } catch (error) {
      return fail(res, "delete the asset", error);
    }
  }

  async schedule(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const asset = await Asset().findOne({ _id: req.params.id, organization_id: String(organization_id), admin_id }).lean();
      if (!asset) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Asset not found" });
      const posted = new Map((asset.postings || []).map((p) => [p.month, p.journal_id]));
      const rows = buildSchedule(asset).map((r) => ({ month: r.month, date: r.date, amount: fromPaise(r.amount), accumulated: fromPaise(r.accumulated), book_value: fromPaise(r.book_value), posted: posted.has(r.month), journal_id: posted.get(r.month) || "" }));
      res.status(ST_CODES.OK).json({ status: true, data: { asset: present(asset), schedule: rows } });
    } catch (error) {
      return fail(res, "load the schedule", error);
    }
  }

  // GET /fixed-assets/depreciation/preview?org_id=&up_to=  what a run would post.
  async preview(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const upTo = parseDay(req.query.up_to);
      if (!upTo) return bad(res, "up_to must be a valid date (YYYY-MM-DD)");
      const assets = await Asset().find({ organization_id: String(organization_id), admin_id, status: "active" }).lean();
      const items = assets
        .map((a) => ({ _id: a._id, asset_id: a.asset_id, name: a.name, entries: dueEntries(a, upTo) }))
        .filter((a) => a.entries.length > 0)
        .map((a) => ({ _id: a._id, asset_id: a.asset_id, name: a.name, months: a.entries.length, from: a.entries[0].month, to: a.entries[a.entries.length - 1].month, amount: fromPaise(a.entries.reduce((t, r) => t + r.amount, 0)) }));
      res.status(ST_CODES.OK).json({ status: true, data: { up_to: upTo.format("YYYY-MM-DD"), items, total: items.reduce((t, i) => t + toPaise(i.amount), 0) / 100 } });
    } catch (error) {
      return fail(res, "preview depreciation", error);
    }
  }

  // POST /fixed-assets/depreciation/run  { org_id, up_to, asset_ids? }
  async run(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id, up_to, asset_ids } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      const upTo = parseDay(up_to);
      if (!upTo) return bad(res, "up_to must be a valid date (YYYY-MM-DD)");
      const query = { organization_id: String(org_id), admin_id, status: "active" };
      if (Array.isArray(asset_ids) && asset_ids.length) query._id = { $in: asset_ids.filter((id) => mongoose.isValidObjectId(id)) };
      const assets = await Asset().find(query);
      const accounts = await getAccountsMap(org_id, admin_id);
      const locked = await lockedUntil(admin_id, org_id);
      let posted = 0;
      let total = 0;
      const skipped = [];
      for (const asset of assets) {
        // Months in a locked period can't be posted; say so rather than posting around them silently.
        let entries = dueEntries(asset, upTo);
        if (locked) {
          const closed = entries.filter((e) => !dayjs(e.date).isAfter(locked, "day"));
          if (closed.length) skipped.push({ asset_id: asset.asset_id, reason: `${closed.length} month${closed.length === 1 ? " is" : "s are"} in the locked period (up to ${locked.format("DD-MM-YYYY")}) and weren't posted` });
          entries = entries.filter((e) => dayjs(e.date).isAfter(locked, "day"));
        }
        entries = entries.slice(0, MAX_RUN_MONTHS);
        const expense = accounts.get(asset.expense_account_id);
        const accumulated = accounts.get(asset.accumulated_account_id);
        if (!expense || !accumulated) {
          if (entries.length) skipped.push({ asset_id: asset.asset_id, reason: "Its depreciation or accumulated depreciation account no longer exists" });
          continue;
        }
        for (const entry of entries) {
          const amount = fromPaise(entry.amount);
          const journal = await postJournal(org_id, admin_id, {
            date: dayjs(entry.date).toDate(), type: "Depreciation", notes: `Depreciation of ${asset.name} (${asset.asset_id}) for ${entry.month}`,
            lines: [
              { coa_account_id: expense.account_id, coa_account_name: expense.account_name, creditOrDebit: "Debit", amount },
              { coa_account_id: accumulated.account_id, coa_account_name: accumulated.account_name, creditOrDebit: "Credit", amount },
            ],
          });
          // Atomic: a month is only ever posted once, even if two runs overlap.
          const done = await Asset().updateOne(
            { _id: asset._id, status: "active", "postings.month": { $ne: entry.month } },
            { $push: { postings: { month: entry.month, amount, journal_id: journal.journal_id } }, $inc: { accumulated_depreciation: amount } }
          );
          if (done.modifiedCount !== 1) {
            await Journal().deleteOne({ _id: journal._id });
            continue;
          }
          posted += 1;
          total += entry.amount;
        }
      }
      res.status(ST_CODES.OK).json({ status: true, data: { months_posted: posted, total: fromPaise(total), skipped }, message: `${posted} month${posted === 1 ? "" : "s"} of depreciation posted` });
    } catch (error) {
      return fail(res, "post depreciation", error);
    }
  }

  // POST /fixed-assets/:id/dispose  { org_id, date, proceeds, proceeds_account_id?, gain_loss_account_id? }
  async dispose(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id, date, proceeds, proceeds_account_id, gain_loss_account_id } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      const asset = await Asset().findOne({ _id: req.params.id, organization_id: String(org_id), admin_id });
      if (!asset) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Asset not found" });
      if (asset.status === "disposed") return bad(res, "This asset has already been disposed of");
      const when = parseDay(date);
      if (!when) return bad(res, "The disposal date must be a valid date (YYYY-MM-DD)");
      if (when.isBefore(dayjs(asset.purchase_date).startOf("day"))) return bad(res, "The disposal date can't be before the purchase date");
      try {
        await assertUnlocked(admin_id, org_id, [when]);
      } catch (e) {
        if (e.code === "PERIOD_LOCKED") return res.status(ST_CODES.FORBIDDEN).json({ status: false, code: "PERIOD_LOCKED", message: e.message });
        throw e;
      }
      const received = Number(proceeds || 0);
      if (!Number.isFinite(received) || received < 0 || Math.abs(toPaise(received) - received * 100) > 1e-6) return bad(res, "Proceeds must be zero or more, with at most 2 decimal places");

      // Depreciation must be up to date for the months before the disposal month.
      const before = when.startOf("month").subtract(1, "day");
      const owing = dueEntries(asset, before);
      if (owing.length > 0) return bad(res, `Post depreciation up to ${before.format("YYYY-MM")} first (${owing.length} month${owing.length === 1 ? "" : "s"} outstanding)`);

      const accounts = await getAccountsMap(org_id, admin_id);
      const assetAccount = accounts.get(asset.asset_account_id);
      const accumulatedAccount = accounts.get(asset.accumulated_account_id);
      if (!assetAccount || !accumulatedAccount) return bad(res, "The asset's accounts no longer exist in the chart of accounts");
      const cost = toPaise(asset.cost);
      const acc = toPaise(asset.accumulated_depreciation);
      const proceedsPaise = toPaise(received);
      const gain = proceedsPaise - (cost - acc); // negative = loss

      const lines = [];
      const line = (account, side, paise) => lines.push({ coa_account_id: account.account_id, coa_account_name: account.account_name, creditOrDebit: side, amount: fromPaise(paise) });
      if (proceedsPaise > 0) {
        const to = accounts.get(String(proceeds_account_id || ""));
        if (!to || to.is_active === false || !["bank", "cash", "other_current_asset", "accounts_receivable"].includes(to.account_type)) return bad(res, "Choose the bank or cash account the money went into");
        line(to, "Debit", proceedsPaise);
      }
      if (acc > 0) line(accumulatedAccount, "Debit", acc);
      line(assetAccount, "Credit", cost);
      if (gain !== 0) {
        const g = accounts.get(String(gain_loss_account_id || ""));
        const okTypes = gain > 0 ? ["income", "other_income"] : ["expense", "other_expense"];
        if (!g || g.is_active === false || !okTypes.includes(g.account_type)) return bad(res, gain > 0 ? "Choose an income account for the gain on disposal" : "Choose an expense account for the loss on disposal");
        line(g, gain > 0 ? "Credit" : "Debit", Math.abs(gain));
      }
      const journal = await postJournal(org_id, admin_id, { date: when.toDate(), type: "Asset Disposal", notes: `Disposal of ${asset.name} (${asset.asset_id})`, lines });
      const done = await Asset().updateOne(
        { _id: asset._id, status: "active" },
        { $set: { status: "disposed", disposal: { date: when.toDate(), proceeds: received, gain_or_loss: fromPaise(gain), journal_id: journal.journal_id } } }
      );
      if (done.modifiedCount !== 1) {
        await Journal().deleteOne({ _id: journal._id });
        return bad(res, "This asset has already been disposed of");
      }
      const fresh = await Asset().findById(asset._id).lean();
      res.status(ST_CODES.OK).json({ status: true, data: present(fresh), message: gain >= 0 ? "Disposed" : "Disposed at a loss" });
    } catch (error) {
      return fail(res, "dispose of the asset", error);
    }
  }
}

module.exports = new FixedAssetController();
