// Inventory planning: reorder levels and quantities (with the list of what to
// buy), and landed cost (freight, duty and handling added to the value of the
// stock a bill brought in).
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const stock = require("../helpers/stockHelper");
const { getAccountsMap, toPaise, fromPaise } = require("../helpers/accountingHelper");
const inventory = require("./inventoryController");
const LandedCost = require("../model/landedCostSchema");

const MAX_QTY = 1e7;
const MAX_VALUE = 1e10;
const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const orgOf = (req) => String(req.query.org_id || req.query.organization_id || req.body?.org_id || req.body?.organization_id || "");
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tracked = (org) => ({ organization_id: org, track_inventory: true, item_type: { $ne: "service" } });
const decimals = (n, places) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) < 1e-6;

const strictDate = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
};

// What to order for an item at or below its reorder level: its reorder
// quantity, or enough to reach twice the reorder level when none is set.
const suggestedQty = (it) => {
  const level = Number(it.reorder_level) || 0;
  const stockQty = Number(it.stock_qty) || 0;
  if (!(level > 0) || stockQty > level) return 0;
  const fixed = Number(it.reorder_quantity) || 0;
  return stock.round4(fixed > 0 ? fixed : Math.max(level * 2 - stockQty, 0));
};

// Runs one of the inventory controller's handlers in-process and returns what it answered.
const runHandler = async (handler, { query = {}, body = {}, params = {}, userId }) => {
  let status = 200;
  let payload = null;
  const res = { locals: { user_id: userId }, status(code) { status = code; return this; }, json(p) { payload = p; return this; }, send(p) { payload = p; return this; } };
  await handler.call(inventory, { query, body, params }, res);
  return { status, payload };
};

class InventoryPlanningController {
  // GET /inventory/reorder?org_id=&filter=needs|all&search=&page=&limit=
  async reorderList(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const query = tracked(org);
      const search = String(req.query.search || "").trim().slice(0, 100);
      if (search) {
        const re = new RegExp(escapeRe(search), "i");
        query.$or = [{ name: re }, { item_name: re }, { sku: re }];
      }
      if (req.query.filter === "needs") {
        query.reorder_level = { $gt: 0 };
        query.$expr = { $lte: ["$stock_qty", "$reorder_level"] };
      }
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
      const Item = mongoose.model("Item");
      const [items, total, needsAll] = await Promise.all([
        Item.find(query, { item_id: 1, name: 1, item_name: 1, sku: 1, unit: 1, stock_qty: 1, avg_cost: 1, purchase_rate: 1, reorder_level: 1, reorder_quantity: 1 })
          .sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Item.countDocuments(query),
        Item.find({ ...tracked(org), reorder_level: { $gt: 0 }, $expr: { $lte: ["$stock_qty", "$reorder_level"] } }, { stock_qty: 1, avg_cost: 1, purchase_rate: 1, reorder_level: 1, reorder_quantity: 1 }).lean(),
      ]);
      const unitCost = (it) => Number(it.avg_cost) || Number(it.purchase_rate) || 0;
      const rows = items.map((it) => {
        const qty = suggestedQty(it);
        return {
          _id: it._id, item_id: it.item_id, name: it.name || it.item_name || "", sku: it.sku || "", unit: it.unit || "",
          stock_qty: Number(it.stock_qty) || 0, reorder_level: Number(it.reorder_level) || 0, reorder_quantity: Number(it.reorder_quantity) || 0,
          needs_reorder: qty > 0 || (Number(it.reorder_level) > 0 && Number(it.stock_qty) <= Number(it.reorder_level)),
          suggested_qty: qty, unit_cost: stock.round2(unitCost(it)), estimated_cost: stock.round2(qty * unitCost(it)),
        };
      });
      res.status(ST_CODES.OK).json({
        status: true,
        data: rows,
        totals: { needs_reorder: needsAll.length, estimated_cost: stock.round2(needsAll.reduce((t, it) => t + suggestedQty(it) * unitCost(it), 0)) },
        pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalRecords: total, recordsPerPage: limit },
      });
    } catch (error) {
      console.error("reorder list error", error);
      return bad(res, "Couldn't load the reorder list", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // PATCH /inventory/reorder/:id  { org_id, reorder_level?, reorder_quantity? }
  async reorderUpdate(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Item not found", ST_CODES.NOT_FOUND);
      const set = {};
      for (const key of ["reorder_level", "reorder_quantity"]) {
        if (req.body?.[key] === undefined) continue;
        const n = Number(req.body[key] === "" ? 0 : req.body[key]);
        if (!Number.isFinite(n) || n < 0 || n > MAX_QTY) return bad(res, `${key === "reorder_level" ? "The reorder level" : "The reorder quantity"} must be a number of zero or more`);
        if (!decimals(n, 4)) return bad(res, "Quantities can have at most 4 decimal places");
        set[key] = n;
      }
      if (!Object.keys(set).length) return bad(res, "Nothing to change");
      const item = await mongoose.model("Item").findOneAndUpdate({ _id: req.params.id, ...tracked(org) }, { $set: set }, { new: true }).lean();
      if (!item) return bad(res, "Item not found", ST_CODES.NOT_FOUND);
      res.status(ST_CODES.OK).json({ status: true, data: { _id: item._id, reorder_level: item.reorder_level || 0, reorder_quantity: item.reorder_quantity || 0, suggested_qty: suggestedQty(item) } });
    } catch (error) {
      console.error("reorder update error", error);
      return bad(res, "Couldn't save", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/landed-cost/lookups?org_id=  recent bills and the accounts a cost can come from.
  async landedLookups(req, res) {
    try {
      const org = orgOf(req);
      const admin_id = res.locals.user_id;
      if (!org) return bad(res, "Organization ID is required");
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID must be a number");
      const bills = await mongoose.model("PO_bill").find({ organization_id: Number(org), admin_id, status_type: { $nin: ["DRAFT", "VOID"] } })
        .select("bill_number billDate total vendor_id items").sort({ billDate: -1 }).limit(200).lean();
      const vendors = await mongoose.model("Contact").find({ _id: { $in: bills.map((b) => b.vendor_id).filter(Boolean) } }).select("contact_name").lean();
      const names = new Map(vendors.map((v) => [String(v._id), v.contact_name]));
      const accounts = [...(await getAccountsMap(org, admin_id)).values()]
        .filter((a) => a.is_active !== false && ["accounts_payable", "other_current_liability", "bank", "cash", "credit_card"].includes(a.account_type))
        .map((a) => ({ account_id: a.account_id, account_name: a.account_name })).sort((x, y) => x.account_name.localeCompare(y.account_name));
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          bills: bills.filter((b) => (b.items || []).some((i) => i.item_id)).map((b) => ({ bill_number: b.bill_number, date: dayjs(b.billDate).format("YYYY-MM-DD"), total: b.total || 0, vendor_name: names.get(String(b.vendor_id)) || "" })),
          accounts,
        },
      });
    } catch (error) {
      console.error("landed cost lookups error", error);
      return bad(res, "Couldn't load the bills", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  async landedList(req, res) {
    try {
      const org = orgOf(req);
      const admin_id = res.locals.user_id;
      if (!org) return bad(res, "Organization ID is required");
      const rows = await LandedCost.find({ organization_id: org, admin_id }).sort({ date: -1, createdAt: -1 }).limit(500).lean();
      res.status(ST_CODES.OK).json({ status: true, data: rows.map((r) => ({ ...r, date: dayjs(r.date).format("YYYY-MM-DD") })) });
    } catch (error) {
      console.error("landed cost list error", error);
      return bad(res, "Couldn't load landed costs", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /inventory/landed-cost  { org_id, bill_number, date, account_id, allocation, charges: [{description, amount}], dry_run? }
  async landedCreate(req, res) {
    try {
      const org = orgOf(req);
      const admin_id = res.locals.user_id;
      if (!org) return bad(res, "Organization ID is required");
      if (!/^\d+$/.test(org)) return bad(res, "Organization ID must be a number");
      const body = req.body || {};
      const date = strictDate(body.date);
      if (!date) return bad(res, "Enter a valid date.");
      const allocation = body.allocation === "qty" ? "qty" : "value";
      const rawCharges = Array.isArray(body.charges) ? body.charges : [];
      if (!rawCharges.length) return bad(res, "Add at least one cost, such as freight.");
      if (rawCharges.length > 20) return bad(res, "At most 20 costs at a time.");
      const charges = [];
      let totalPaise = 0;
      for (const [i, c] of rawCharges.entries()) {
        const amount = Number(c?.amount);
        if (!Number.isFinite(amount) || amount <= 0) return bad(res, `Cost ${i + 1}: the amount must be more than zero.`);
        if (amount > MAX_VALUE) return bad(res, `Cost ${i + 1}: that amount is too large.`);
        if (!decimals(amount, 2)) return bad(res, `Cost ${i + 1}: the amount can have at most 2 decimal places.`);
        charges.push({ description: String(c.description || "").trim().slice(0, 100), amount });
        totalPaise += toPaise(amount);
      }

      const bill = await mongoose.model("PO_bill").findOne({ organization_id: Number(org), admin_id, bill_number: String(body.bill_number || "") }).lean();
      if (!bill) return bad(res, "Choose one of your bills.", ST_CODES.NOT_FOUND);
      if (["DRAFT", "VOID"].includes(String(bill.status_type || "").toUpperCase())) return bad(res, "A draft or void bill brought in no stock.");
      const items = await stock.findItems(org, (bill.items || []).map((l) => l.item_id));
      // One entry per stock item on the bill.
      const perItem = new Map();
      for (const l of bill.items || []) {
        const item = items.get(String(l.item_id || ""));
        if (!stock.isTracked(item)) continue;
        const key = String(item._id);
        const row = perItem.get(key) || { item_id: item.item_id, item_name: item.name || item.item_name || "", qty: 0, base: 0 };
        row.qty += Number(l.quantity) || 0;
        row.base += Number(l.item_total) || (Number(l.quantity) || 0) * (Number(l.rate) || 0);
        perItem.set(key, row);
      }
      const rows = [...perItem.values()];
      if (!rows.length) return bad(res, "That bill has no stock items to add the cost to.");

      // Share the total out in whole paise; the leftover paise go to the largest share.
      const weight = (r) => (allocation === "qty" || rows.every((x) => x.base <= 0) ? r.qty : r.base);
      const totalWeight = rows.reduce((t, r) => t + Math.max(weight(r), 0), 0);
      if (!(totalWeight > 0)) return bad(res, "The bill's stock lines have no quantity or value to share the cost by.");
      const shares = rows.map((r) => Math.floor((totalPaise * Math.max(weight(r), 0)) / totalWeight));
      let left = totalPaise - shares.reduce((t, n) => t + n, 0);
      const order = rows.map((_, i) => i).sort((a, b) => weight(rows[b]) - weight(rows[a]));
      for (let k = 0; left > 0; k = (k + 1) % order.length, left--) shares[order[k]] += 1;
      const lines = rows.map((r, i) => ({ item_id: r.item_id, item_name: r.item_name, qty: stock.round4(r.qty), base: stock.round2(r.base), amount: fromPaise(shares[i]) })).filter((l) => l.amount > 0);

      if (body.dry_run) return res.status(ST_CODES.OK).json({ status: true, data: { total: fromPaise(totalPaise), allocation, lines } });

      const accounts = await getAccountsMap(org, admin_id);
      const account = accounts.get(String(body.account_id || ""));
      if (!account || account.is_active === false || !["accounts_payable", "other_current_liability", "bank", "cash", "credit_card"].includes(account.account_type)) return bad(res, "Choose the account the cost was paid from or is owed to.");

      const number = await commonHelper.generateUniqueId(LandedCost, "landed_cost_number", 4, "LC");
      const reason = `Landed cost on bill ${bill.bill_number}`;
      const made = await runHandler(inventory.createAdjustment, {
        query: { org_id: org },
        body: {
          date: body.date, reason, reference_number: number, account_id: account.account_id,
          notes: charges.map((c) => `${c.description || "Cost"}: ${c.amount}`).join("; "),
          line_items: lines.map((l) => ({ item_id: l.item_id, mode: "value", value_change: l.amount })),
        },
        userId: admin_id,
      });
      if (made.status !== ST_CODES.CREATED) {
        const msg = String(made.payload?.message || "");
        const noStock = msg.match(/Line (\d+): (.+) has no stock to revalue/);
        if (noStock) return bad(res, `${lines[Number(noStock[1]) - 1]?.item_name || noStock[2]} has no stock left to add the cost to. Book that part of the cost as an expense instead.`);
        return res.status(made.status).json(made.payload || { status: false, message: "Couldn't book the landed cost" });
      }
      const adjustment = made.payload.data;
      try {
        const vendor = bill.vendor_id ? await mongoose.model("Contact").findById(bill.vendor_id).select("contact_name").lean() : null;
        const doc = await LandedCost.create({
          organization_id: org, admin_id, landed_cost_number: number, bill_number: bill.bill_number, vendor_name: vendor?.contact_name || "", date, allocation, charges, total: fromPaise(totalPaise),
          account_id: account.account_id, account_name: account.account_name, lines, adjustment_id: String(adjustment._id), adjustment_number: adjustment.adjustment_number, created_by_id: String(res.locals.actor_id || admin_id),
        });
        return res.status(ST_CODES.CREATED).json({ status: true, message: `Landed cost ${number} booked`, data: { ...doc.toObject(), date: dayjs(date).format("YYYY-MM-DD") } });
      } catch (error) {
        await runHandler(inventory.deleteAdjustment, { query: { org_id: org }, params: { id: String(adjustment._id) }, userId: admin_id }).catch(() => {});
        throw error;
      }
    } catch (error) {
      console.error("landed cost create error", error);
      return bad(res, "Couldn't book the landed cost. Nothing was changed.", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // DELETE /inventory/landed-cost/:id?org_id=  takes the cost back out of the stock value.
  async landedRemove(req, res) {
    try {
      const org = orgOf(req);
      const admin_id = res.locals.user_id;
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Landed cost not found", ST_CODES.NOT_FOUND);
      const doc = await LandedCost.findOne({ _id: req.params.id, organization_id: org, admin_id });
      if (!doc) return bad(res, "Landed cost not found", ST_CODES.NOT_FOUND);
      const done = await runHandler(inventory.deleteAdjustment, { query: { org_id: org }, params: { id: doc.adjustment_id }, userId: admin_id });
      if (done.status >= 500) return bad(res, "Couldn't take the cost back out. Nothing was changed.", ST_CODES.INTERNAL_SERVER_ERROR);
      await doc.deleteOne();
      res.status(ST_CODES.OK).json({ status: true, message: `Landed cost ${doc.landed_cost_number} removed` });
    } catch (error) {
      console.error("landed cost delete error", error);
      return bad(res, "Couldn't remove the landed cost", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}

module.exports = new InventoryPlanningController();
