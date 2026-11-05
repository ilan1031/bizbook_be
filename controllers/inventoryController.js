// Inventory: stock summary, item stock history, valuation report, inventory
// adjustments (with their journal) and the sell-beyond-stock setting.
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const stock = require("../helpers/stockHelper");
const { getAccountsMap, toPaise, formatCurrency } = require("../helpers/accountingHelper");
const InventoryAdjustment = require("../model/InventoryAdjustment");
const InventorySettings = require("../model/InventorySettings");
const StockMovement = require("../model/StockMovement");

const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const orgOf = (req) => String(req.query.org_id || req.query.organization_id || req.body?.organization_id || "");
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_QTY = 1e7;
const MAX_VALUE = 1e10;
const STOCK_ACCOUNT_TYPE = "stock";
// The valuation an item is costed by: fifo, lifo, or average (the default).
const methodOf = (v) => (["fifo", "lifo"].includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : "average");

// A real calendar date (2026-02-31 is refused, not rolled over).
const strictDate = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
};

const stockStatus = (row) => {
  if (Number(row.stock_qty) <= 0) return "out_of_stock";
  if (Number(row.reorder_level) > 0 && Number(row.stock_qty) <= Number(row.reorder_level)) return "low_stock";
  return "in_stock";
};
const STATUS_LABEL = { out_of_stock: "Out of stock", low_stock: "Low stock", in_stock: "In stock" };

const trackedItemFilter = (org) => ({ organization_id: org, track_inventory: true, item_type: { $ne: "service" } });

class InventoryController {
  // GET /inventory/summary: stock on hand per tracked item.
  async summary(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      await stock.backfillOpening(org);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 5000);
      const query = trackedItemFilter(org);
      const search = String(req.query.search || "").trim().slice(0, 100);
      if (search) {
        const re = new RegExp(escapeRe(search), "i");
        query.$or = [{ name: re }, { item_name: re }, { sku: re }];
      }
      if (req.query.filter === "low") {
        query.reorder_level = { $gt: 0 };
        query.$expr = { $lte: ["$stock_qty", "$reorder_level"] };
      } else if (req.query.filter === "out") {
        query.stock_qty = { $lte: 0 };
      }
      const sortField = { name: "name", stock: "stock_qty", value: "stock_value" }[req.query.sort] || "name";
      const sortDir = req.query.order === "desc" ? -1 : 1;
      const [items, total, totals] = await Promise.all([
        mongoose.model("Item").find(query, {
          item_id: 1, name: 1, item_name: 1, sku: 1, unit: 1, stock_qty: 1, stock_value: 1, avg_cost: 1, reorder_level: 1, valuation_method: 1,
        }).sort({ [sortField]: sortDir, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        mongoose.model("Item").countDocuments(query),
        mongoose.model("Item").aggregate([
          { $match: trackedItemFilter(org) },
          { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$stock_value" }, low: { $sum: { $cond: [{ $and: [{ $gt: ["$reorder_level", 0] }, { $lte: ["$stock_qty", "$reorder_level"] }] }, 1, 0] } } } },
        ]),
      ]);
      const rows = items.map((it) => {
        const status = stockStatus(it);
        return {
          _id: it._id,
          item_id: it.item_id,
          name: it.name || it.item_name || "",
          sku: it.sku || "",
          unit: it.unit || "",
          stock_qty: Number(it.stock_qty) || 0,
          reorder_level: Number(it.reorder_level) || 0,
          avg_cost: Number(it.avg_cost) || 0,
          stock_value: Number(it.stock_value) || 0,
          valuation_method: methodOf(it.valuation_method),
          status,
          status_label: STATUS_LABEL[status],
        };
      });
      const t = totals[0] || { count: 0, value: 0, low: 0 };
      return res.status(ST_CODES.OK).json({
        status: true,
        data: rows,
        totals: { items: t.count, stock_value: stock.round2(t.value), low_stock: t.low },
        pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalRecords: total, recordsPerPage: limit },
      });
    } catch (error) {
      console.error("inventory summary error", error);
      return bad(res, "Couldn't load stock", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/items/:id/ledger: the stock history of one item.
  async ledger(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const key = String(req.params.id || "");
      const or = [{ item_id: key }];
      if (mongoose.isValidObjectId(key)) or.push({ _id: new mongoose.Types.ObjectId(key) });
      const item = await mongoose.model("Item").findOne({ organization_id: org, $or: or }).lean();
      if (!item) return bad(res, "Item not found", ST_CODES.NOT_FOUND);
      if (!stock.isTracked(item)) return bad(res, "This item doesn't track inventory.");
      await stock.backfillOpening(org);
      const movements = await StockMovement.find({ item_ref: item._id }).sort({ date: 1, sort_rank: 1, _id: 1 }).limit(5000).lean();
      return res.status(ST_CODES.OK).json({
        status: true,
        item: {
          _id: item._id,
          item_id: item.item_id,
          name: item.name || item.item_name || "",
          sku: item.sku || "",
          unit: item.unit || "",
          stock_qty: Number(item.stock_qty) || 0,
          stock_value: Number(item.stock_value) || 0,
          avg_cost: Number(item.avg_cost) || 0,
          reorder_level: Number(item.reorder_level) || 0,
          valuation_method: methodOf(item.valuation_method),
        },
        data: movements.map((m) => ({
          _id: m._id,
          // Opening stock is stored before every document; show the day the item was created.
          date: m.source_type === "opening" ? item.createdAt : m.date,
          source_type: m.source_type,
          source_id: m.source_id,
          source_number: m.source_number,
          party_name: m.party_name,
          qty: m.qty,
          rate: m.rate,
          value: m.value,
          running_qty: m.running_qty,
          running_value: m.running_value,
          unit_cost: m.unit_cost,
        })),
      });
    } catch (error) {
      console.error("inventory ledger error", error);
      return bad(res, "Couldn't load stock history", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/valuation?as_of=YYYY-MM-DD: stock quantity and value per item.
  async valuation(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const asOf = req.query.as_of ? strictDate(req.query.as_of) : new Date();
      if (!asOf) return bad(res, "Enter a valid date.");
      const end = dayjs(asOf).endOf("day").toDate();
      // Date rule (same as the Stock Summary): a date today or later counts every
      // recorded movement, including documents dated after today; an earlier date
      // counts only movements dated up to it.
      const countAll = !dayjs(asOf).isBefore(dayjs(), "day");
      await stock.backfillOpening(org);
      const items = await mongoose.model("Item").find(trackedItemFilter(org), { item_id: 1, name: 1, item_name: 1, sku: 1, valuation_method: 1 }).sort({ name: 1 }).lean();
      const last = await StockMovement.aggregate([
        { $match: countAll ? { organization_id: org } : { organization_id: org, date: { $lte: end } } },
        { $sort: { date: 1, sort_rank: 1, _id: 1 } },
        { $group: { _id: "$item_ref", qty: { $last: "$running_qty" }, value: { $last: "$running_value" }, unit: { $last: "$unit_cost" } } },
      ]);
      const byItem = new Map(last.map((r) => [String(r._id), r]));
      const rows = items
        .filter((it) => byItem.has(String(it._id)))
        .map((it) => {
          const r = byItem.get(String(it._id));
          return {
            _id: it._id,
            item_id: it.item_id,
            name: it.name || it.item_name || "",
            sku: it.sku || "",
            valuation_method: methodOf(it.valuation_method),
            qty: stock.round4(r.qty),
            avg_cost: stock.round2(r.unit),
            value: stock.round2(r.value),
          };
        });
      const total = rows.reduce((s, r) => s + toPaise(r.value), 0);
      return res.status(ST_CODES.OK).json({
        status: true,
        as_of: dayjs(asOf).format("YYYY-MM-DD"),
        data: rows,
        totals: { items: rows.length, value: total / 100, value_formatted: formatCurrency(total / 100) },
      });
    } catch (error) {
      console.error("inventory valuation error", error);
      return bad(res, "Couldn't load the valuation", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/lookups: tracked items and the accounts an adjustment can use.
  async lookups(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      await stock.backfillOpening(org);
      const items = await mongoose.model("Item").find(trackedItemFilter(org), { item_id: 1, name: 1, item_name: 1, sku: 1, unit: 1, stock_qty: 1, avg_cost: 1, valuation_method: 1 }).sort({ name: 1 }).limit(2000).lean();
      const accounts = await getAccountsMap(org, res.locals.user_id);
      const offset = [...accounts.values()]
        .filter((a) => a.is_active !== false && a.account_type !== STOCK_ACCOUNT_TYPE)
        .map((a) => ({ account_id: a.account_id, account_name: a.account_name, account_type: a.account_type }));
      return res.status(ST_CODES.OK).json({
        status: true,
        items: items.map((it) => ({
          _id: String(it._id),
          item_id: it.item_id,
          name: it.name || it.item_name || "",
          sku: it.sku || "",
          unit: it.unit || "",
          stock_qty: Number(it.stock_qty) || 0,
          avg_cost: Number(it.avg_cost) || 0,
        })),
        accounts: offset,
      });
    } catch (error) {
      console.error("inventory lookups error", error);
      return bad(res, "Couldn't load inventory lookups", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/settings
  async getSettings(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      return res.status(ST_CODES.OK).json({ status: true, data: { sell_policy: await stock.sellPolicy(org) } });
    } catch (error) {
      return bad(res, "Couldn't load inventory settings", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // PUT /inventory/settings: { sell_policy: "warn" | "block" }
  async saveSettings(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const policy = req.body?.sell_policy;
      if (!["warn", "block"].includes(policy)) return bad(res, "Choose warn or block for selling beyond stock.");
      await InventorySettings.updateOne({ organization_id: org }, { $set: { sell_policy: policy } }, { upsert: true });
      return res.status(ST_CODES.OK).json({ status: true, message: "Inventory settings saved", data: { sell_policy: policy } });
    } catch (error) {
      console.error("save inventory settings error", error);
      return bad(res, "Couldn't save inventory settings", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/adjustments
  async listAdjustments(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 200);
      const query = { organization_id: org };
      if (req.query.search) {
        const re = new RegExp(escapeRe(String(req.query.search).slice(0, 100)), "i");
        query.$or = [{ adjustment_number: re }, { reason: re }, { reference_number: re }];
      }
      const [docs, total] = await Promise.all([
        InventoryAdjustment.find(query).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        InventoryAdjustment.countDocuments(query),
      ]);
      return res.status(ST_CODES.OK).json({
        status: true,
        data: docs.map((d) => ({
          _id: d._id,
          adjustment_number: d.adjustment_number,
          date: d.date,
          reason: d.reason,
          reference_number: d.reference_number,
          account_name: d.account_name,
          line_count: d.lines.length,
          total_value: d.total_value,
        })),
        pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalRecords: total, recordsPerPage: limit },
      });
    } catch (error) {
      console.error("list adjustments error", error);
      return bad(res, "Couldn't load adjustments", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/adjustments/:id
  async getAdjustment(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Adjustment not found", ST_CODES.NOT_FOUND);
      const adj = await InventoryAdjustment.findOne({ _id: req.params.id, organization_id: org }).lean();
      if (!adj) return bad(res, "Adjustment not found", ST_CODES.NOT_FOUND);
      const journal = adj.journal_id
        ? await mongoose.model("Journal").findOne({ journal_id: adj.journal_id, organization_id: org }, { line_items: 1 }).lean()
        : null;
      return res.status(ST_CODES.OK).json({ status: true, data: { ...adj, journal_lines: journal?.line_items || [] } });
    } catch (error) {
      console.error("get adjustment error", error);
      return bad(res, "Couldn't load the adjustment", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /inventory/adjustments
  async createAdjustment(req, res) {
    try {
      const org = orgOf(req);
      const admin = res.locals.user_id;
      if (!org) return bad(res, "Organization ID is required");
      const body = req.body || {};
      const date = strictDate(body.date);
      if (!date) return bad(res, "Enter a valid date for the adjustment.");
      const reason = String(body.reason || "").trim();
      if (!reason) return bad(res, "Enter a reason for the adjustment.");
      if (reason.length > 200) return bad(res, "The reason can be at most 200 characters.");
      const rawLines = Array.isArray(body.line_items) ? body.line_items : [];
      if (!rawLines.length) return bad(res, "Add at least one item to the adjustment.");
      if (rawLines.length > 100) return bad(res, "An adjustment can have at most 100 items.");

      const accounts = await getAccountsMap(org, admin);
      const account = accounts.get(String(body.account_id || ""));
      if (!account || account.is_active === false) return bad(res, "Choose the account this adjustment is booked to.");
      if (account.account_type === STOCK_ACCOUNT_TYPE) return bad(res, "Choose an account other than Inventory Asset.");
      const inventoryAccount = [...accounts.values()].find((a) => a.account_type === STOCK_ACCOUNT_TYPE && a.is_active !== false && /inventory asset/i.test(a.account_name || ""))
        || [...accounts.values()].find((a) => a.account_type === STOCK_ACCOUNT_TYPE && a.is_active !== false);
      if (!inventoryAccount) return bad(res, "Add an active Inventory Asset account in the chart of accounts first.");

      await stock.backfillOpening(org);
      const items = await stock.findItems(org, rawLines.map((l) => l?.item_id));
      const seen = new Set();
      const lines = [];
      for (const [index, l] of rawLines.entries()) {
        const n = index + 1;
        const item = items.get(String(l?.item_id || ""));
        if (!stock.isTracked(item)) return bad(res, `Line ${n}: choose an item that tracks inventory.`);
        if (seen.has(String(item._id))) return bad(res, `Line ${n}: ${item.name || item.item_name} is listed twice. Combine the lines.`);
        seen.add(String(item._id));
        const name = item.name || item.item_name || "";
        const onHand = Number(item.stock_qty) || 0;
        if (l.mode === "value") {
          const v = Number(l.value_change);
          if (!Number.isFinite(v) || v === 0) return bad(res, `Line ${n}: the value change can't be zero.`);
          if (Math.abs(v) > MAX_VALUE) return bad(res, `Line ${n}: value can't be more than ${formatCurrency(MAX_VALUE)}.`);
          if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return bad(res, `Line ${n}: value can have at most 2 decimal places.`);
          if (onHand <= 0) return bad(res, `Line ${n}: ${name} has no stock to revalue.`);
          lines.push({ item_ref: item._id, item_id: item.item_id, item_name: name, mode: "value", qty_change: 0, value_change: v, rate: null, qty: 0, value: v });
        } else {
          const q = Number(l.qty_change);
          if (!Number.isFinite(q) || q === 0) return bad(res, `Line ${n}: the quantity change can't be zero.`);
          if (Math.abs(q) > MAX_QTY) return bad(res, `Line ${n}: quantity can't be more than ${MAX_QTY.toLocaleString("en-IN")}.`);
          if (Math.abs(q * 10000 - Math.round(q * 10000)) > 1e-6) return bad(res, `Line ${n}: quantity can have at most 4 decimal places.`);
          if (q < 0 && -q > onHand + 1e-9) return bad(res, `Line ${n}: only ${stock.round4(onHand)} of ${name} in stock, so ${stock.round4(-q)} can't be taken out.`);
          const rate = l.rate === undefined || l.rate === null || l.rate === "" ? null : Number(l.rate);
          if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > MAX_VALUE)) return bad(res, `Line ${n}: unit cost must be a number of zero or more.`);
          lines.push({ item_ref: item._id, item_id: item.item_id, item_name: name, mode: "quantity", qty_change: q, value_change: 0, rate, qty: q, value: 0 });
        }
      }

      const adjustmentNumber = await commonHelper.generateUniqueId(InventoryAdjustment, "adjustment_number", 5, "ADJ");
      const adjId = new mongoose.Types.ObjectId();
      const movementLines = lines.map((l) => ({ item_ref: l.item_ref, item_id: l.item_id, item_name: l.item_name, qty: l.qty, rate: l.rate, value: l.value }));
      let journalId = "";
      try {
        await stock.syncSource({
          organization_id: org, admin_id: admin, source_type: "adjustment", source_id: String(adjId),
          source_number: adjustmentNumber, date, party_name: reason, lines: movementLines,
        });
        const booked = await StockMovement.find({ source_type: "adjustment", source_id: String(adjId), organization_id: org }, { item_ref: 1, value: 1 }).lean();
        const byItem = new Map(booked.map((m) => [String(m.item_ref), m.value]));
        for (const l of lines) l.value = stock.round2(byItem.get(String(l.item_ref)) || 0);
        const total = stock.round2(lines.reduce((s, l) => s + l.value, 0));
        if (Math.abs(total) >= 0.01) {
          const amount = Math.abs(total);
          const increase = total > 0;
          journalId = await commonHelper.generateUniqueId(mongoose.model("Journal"), "journal_id", 5, "JL");
          await mongoose.model("Journal").create({
            organization_id: org,
            admin_id: admin,
            journal_id: journalId,
            journal_date: date,
            journal_date_formatted: commonHelper.formatDateString(date),
            total_amount: amount,
            total_amount_formatted: formatCurrency(amount),
            type: "Inventory Adjustment",
            vendor_name: "",
            customer_name: "",
            reference_number: adjustmentNumber,
            notes: reason,
            posting_status: "posted",
            line_items: [
              { coa_account_id: inventoryAccount.account_id, coa_account_name: inventoryAccount.account_name, creditOrDebit: increase ? "Debit" : "Credit", amount, amount_formatted: formatCurrency(amount) },
              { coa_account_id: account.account_id, coa_account_name: account.account_name, creditOrDebit: increase ? "Credit" : "Debit", amount, amount_formatted: formatCurrency(amount) },
            ],
          });
        }
        const adj = await InventoryAdjustment.create({
          _id: adjId,
          organization_id: org,
          admin_id: admin,
          adjustment_number: adjustmentNumber,
          date,
          reason,
          reference_number: String(body.reference_number || "").trim().slice(0, 100),
          notes: String(body.notes || "").slice(0, 2000),
          account_id: account.account_id,
          account_name: account.account_name,
          lines,
          total_value: total,
          journal_id: journalId,
        });
        return res.status(ST_CODES.CREATED).json({ status: true, message: `Inventory adjustment ${adjustmentNumber} saved`, data: adj });
      } catch (error) {
        // Put the stock back the way it was: no movements, no journal.
        await stock.clearSource(org, "adjustment", String(adjId)).catch(() => {});
        if (journalId) await mongoose.model("Journal").deleteOne({ journal_id: journalId, organization_id: org }).catch(() => {});
        throw error;
      }
    } catch (error) {
      console.error("create adjustment error", error);
      return bad(res, "Couldn't save the adjustment. Nothing was changed.", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // DELETE /inventory/adjustments/:id: reverses its stock and journal.
  async deleteAdjustment(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Adjustment not found", ST_CODES.NOT_FOUND);
      const adj = await InventoryAdjustment.findOne({ _id: req.params.id, organization_id: org });
      if (!adj) return bad(res, "Adjustment not found", ST_CODES.NOT_FOUND);
      await stock.clearSource(org, "adjustment", String(adj._id));
      if (adj.journal_id) await mongoose.model("Journal").deleteOne({ journal_id: adj.journal_id, organization_id: org });
      await InventoryAdjustment.deleteOne({ _id: adj._id });
      return res.status(ST_CODES.OK).json({ status: true, message: `Adjustment ${adj.adjustment_number} deleted` });
    } catch (error) {
      console.error("delete adjustment error", error);
      return bad(res, "Couldn't delete the adjustment", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}

module.exports = new InventoryController();
