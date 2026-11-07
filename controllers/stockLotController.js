// Batch and serial tracking. An item is switched to "batch" or "serial"
// tracking, then its lots are registered as they arrive and issued as they
// leave. A lot register can never hold more than the item's stock on hand.
const mongoose = require("mongoose");
const ST_CODES = require("../helpers/statusCodeHelpers");
const stock = require("../helpers/stockHelper");
const StockLot = require("../model/stockLotSchema");

const MAX_QTY = 1e7;
const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const orgOf = (req) => String(req.query.org_id || req.query.organization_id || req.body?.org_id || req.body?.organization_id || "");
const decimals = (n, places) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) < 1e-6;
const tracked = (org) => ({ organization_id: org, track_inventory: true, item_type: { $ne: "service" } });
const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const DAY = 86400000;

const strictDate = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
};
const today = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};

// How much of an item the register already holds.
const registered = async (org, itemRef) => {
  const [agg] = await StockLot.aggregate([
    { $match: { organization_id: org, item_ref: new mongoose.Types.ObjectId(String(itemRef)) } },
    { $group: { _id: null, q: { $sum: "$qty" } } },
  ]);
  return stock.round4(agg?.q || 0);
};

const shape = (l, now = today()) => {
  const days = l.expiry_date ? Math.round((new Date(l.expiry_date) - now) / DAY) : null;
  return { ...l, days_to_expiry: days, expired: days !== null && days < 0 && l.qty > 0 };
};

class StockLotController {
  // GET /inventory/batches?org_id=&item=&status=in_stock|used|all&expiring=days&search=&kind=
  async list(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const q = { organization_id: org };
      if (mongoose.isValidObjectId(req.query.item)) q.item_ref = req.query.item;
      if (req.query.kind === "batch" || req.query.kind === "serial") q.kind = req.query.kind;
      const status = req.query.status || "in_stock";
      if (status === "in_stock") q.qty = { $gt: 0 };
      else if (status === "used") q.qty = { $lte: 0 };
      const days = parseInt(req.query.expiring);
      if (Number.isFinite(days) && days >= 0) {
        q.expiry_date = { $ne: null, $lte: new Date(today().getTime() + days * DAY) };
        q.qty = { $gt: 0 };
      }
      const search = clean(req.query.search, 60);
      if (search) q.number = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const rows = await StockLot.find(q).sort({ expiry_date: 1, received_on: -1, _id: -1 }).limit(1000).lean();
      res.status(ST_CODES.OK).json({ status: true, data: rows.map((r) => shape(r)) });
    } catch (error) {
      console.error("lot list error", error);
      return bad(res, "Couldn't load batches", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/batches/lookups?org_id=  stock items with their tracking and register totals.
  async lookups(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const items = await mongoose.model("Item").find(tracked(org), { name: 1, item_name: 1, unit: 1, stock_qty: 1, tracking: 1 }).sort({ name: 1 }).limit(1000).lean();
      const sums = await StockLot.aggregate([{ $match: { organization_id: org } }, { $group: { _id: "$item_ref", q: { $sum: "$qty" } } }]);
      const bySum = new Map(sums.map((s) => [String(s._id), stock.round4(s.q)]));
      res.status(ST_CODES.OK).json({
        status: true,
        data: items.map((it) => {
          const reg = bySum.get(String(it._id)) || 0;
          return { _id: it._id, name: it.name || it.item_name || "", unit: it.unit || "", tracking: it.tracking || "none", stock_qty: Number(it.stock_qty) || 0, registered: reg, unassigned: stock.round4(Math.max((Number(it.stock_qty) || 0) - reg, 0)) };
        }),
      });
    } catch (error) {
      console.error("lot lookups error", error);
      return bad(res, "Couldn't load the options", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // PATCH /inventory/batches/tracking/:itemId  { org_id, tracking: none|batch|serial }
  async setTracking(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const tracking = req.body?.tracking;
      if (!["none", "batch", "serial"].includes(tracking)) return bad(res, "Choose none, batch or serial");
      if (!mongoose.isValidObjectId(req.params.itemId)) return bad(res, "Item not found", ST_CODES.NOT_FOUND);
      const item = await mongoose.model("Item").findOne({ _id: req.params.itemId, ...tracked(org) }).lean();
      if (!item) return bad(res, "Item not found", ST_CODES.NOT_FOUND);
      const current = item.tracking || "none";
      if (current !== tracking && (await StockLot.exists({ organization_id: org, item_ref: item._id }))) {
        return bad(res, "This item already has batches or serial numbers registered, so its tracking can't change.");
      }
      await mongoose.model("Item").updateOne({ _id: item._id }, { $set: { tracking } });
      res.status(ST_CODES.OK).json({ status: true, data: { _id: item._id, tracking } });
    } catch (error) {
      console.error("lot tracking error", error);
      return bad(res, "Couldn't save", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /inventory/batches
  //   batch:  { org_id, item_ref, number, qty, received_on?, mfg_date?, expiry_date?, note? }
  //   serial: { org_id, item_ref, numbers: ["SN1", ...], received_on?, note? }
  async receive(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.body?.item_ref)) return bad(res, "Choose an item");
      const item = await mongoose.model("Item").findOne({ _id: req.body.item_ref, ...tracked(org) }).lean();
      if (!item) return bad(res, "Item not found", ST_CODES.NOT_FOUND);
      const kind = item.tracking;
      if (kind !== "batch" && kind !== "serial") return bad(res, "Switch this item to batch or serial tracking first");
      const received_on = req.body.received_on ? strictDate(req.body.received_on) : today();
      if (!received_on) return bad(res, "Enter a valid received date");
      let mfg = null;
      let expiry = null;
      if (req.body.mfg_date) mfg = strictDate(req.body.mfg_date);
      if (req.body.expiry_date) expiry = strictDate(req.body.expiry_date);
      if ((req.body.mfg_date && !mfg) || (req.body.expiry_date && !expiry)) return bad(res, "Enter valid dates");
      if (mfg && expiry && expiry < mfg) return bad(res, "The expiry date is before the manufacture date");

      let numbers;
      let each;
      if (kind === "serial") {
        const raw = Array.isArray(req.body.numbers) ? req.body.numbers : String(req.body.numbers || "").split(/[\n,]+/);
        numbers = raw.map((n) => clean(n, 60)).filter(Boolean);
        if (!numbers.length) return bad(res, "Enter at least one serial number");
        if (numbers.length > 500) return bad(res, "Add up to 500 serial numbers at a time");
        if (new Set(numbers.map((n) => n.toLowerCase())).size !== numbers.length) return bad(res, "The same serial number appears twice");
        each = 1;
      } else {
        const number = clean(req.body.number, 60);
        if (!number) return bad(res, "Enter a batch number");
        const q = Number(req.body.qty);
        if (!Number.isFinite(q) || q <= 0 || q > MAX_QTY) return bad(res, "The quantity must be more than zero");
        if (!decimals(q, 4)) return bad(res, "Quantities can have at most 4 decimal places");
        numbers = [number];
        each = q;
      }
      const total = stock.round4(each * numbers.length);
      const held = await registered(org, item._id);
      const onHand = Number(item.stock_qty) || 0;
      if (held + total > onHand + 1e-9) {
        return bad(res, `Only ${stock.round4(Math.max(onHand - held, 0))} of ${item.name || item.item_name} is in stock and not yet in a batch or serial list. Receive the goods on a bill first.`);
      }
      const clash = await StockLot.find({ organization_id: org, item_ref: item._id, number: { $in: numbers } }, { number: 1 }).lean();
      if (clash.length) return bad(res, `Already registered: ${clash.map((c) => c.number).join(", ")}`);
      const docs = await StockLot.insertMany(
        numbers.map((number) => ({
          organization_id: org, admin_id: res.locals?.user_id, item_ref: item._id, item_name: item.name || item.item_name || "", kind, number,
          received_qty: each, qty: each, mfg_date: mfg, expiry_date: expiry, received_on, note: clean(req.body.note, 300),
        }))
      );
      res.status(ST_CODES.CREATED || 201).json({ status: true, message: kind === "serial" ? `${docs.length} serial number(s) registered` : "Batch registered", data: docs });
    } catch (error) {
      console.error("lot receive error", error);
      return bad(res, "Couldn't register the stock", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /inventory/batches/:id/issue  { org_id, qty?, date?, reference? }
  async issue(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      const lot = await StockLot.findOne({ _id: req.params.id, organization_id: org });
      if (!lot) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      const q = lot.kind === "serial" ? 1 : Number(req.body?.qty);
      if (!Number.isFinite(q) || q <= 0) return bad(res, "The quantity must be more than zero");
      if (!decimals(q, 4)) return bad(res, "Quantities can have at most 4 decimal places");
      if (q > lot.qty + 1e-9) return bad(res, lot.kind === "serial" ? "This serial number has already been used" : `Only ${lot.qty} left in this batch`);
      const date = req.body?.date ? strictDate(req.body.date) : today();
      if (!date) return bad(res, "Enter a valid date");
      lot.qty = stock.round4(lot.qty - q);
      lot.issues.push({ date, qty: q, reference: clean(req.body?.reference, 80) });
      await lot.save();
      res.status(ST_CODES.OK).json({ status: true, data: shape(lot.toObject()) });
    } catch (error) {
      console.error("lot issue error", error);
      return bad(res, "Couldn't save", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // DELETE /inventory/batches/:id  only while nothing has been issued from it.
  async remove(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      const lot = await StockLot.findOne({ _id: req.params.id, organization_id: org });
      if (!lot) return bad(res, "Not found", ST_CODES.NOT_FOUND);
      if (lot.issues.length) return bad(res, "Stock has already been issued from this, so it can't be removed.");
      await lot.deleteOne();
      res.status(ST_CODES.OK).json({ status: true, message: "Removed" });
    } catch (error) {
      console.error("lot remove error", error);
      return bad(res, "Couldn't remove", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}

module.exports = new StockLotController();
