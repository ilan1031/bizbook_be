// Warehouses and stock transfers.
//
// Documents (bills, invoices, adjustments) do not name a warehouse, so all
// stock starts in the default warehouse. A transfer moves quantity out of one
// warehouse and into another. A non-default warehouse holds what transfers
// have put there; the default holds the rest of the item's stock on hand.
const mongoose = require("mongoose");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const stock = require("../helpers/stockHelper");
const Warehouse = require("../model/warehouseSchema");
const StockTransfer = require("../model/stockTransferSchema");

const MAX_QTY = 1e7;
const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const orgOf = (req) => String(req.query.org_id || req.query.organization_id || req.body?.org_id || req.body?.organization_id || "");
const decimals = (n, places) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) < 1e-6;
const tracked = (org) => ({ organization_id: org, track_inventory: true, item_type: { $ne: "service" } });
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

const strictDate = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
};

// The default warehouse of an organisation, created on first use.
const ensureDefault = async (org, adminId) => {
  let def = await Warehouse.findOne({ organization_id: org, is_default: true });
  if (!def) def = await Warehouse.create({ organization_id: org, admin_id: adminId, name: "Main Warehouse", code: "MAIN", is_default: true });
  return def;
};

// Net quantity transfers have put in each non-default warehouse: Map "wh|item" -> qty.
const transferNets = async (org, defaultId, excludeTransferId = null) => {
  const query = { organization_id: org };
  if (excludeTransferId) query._id = { $ne: excludeTransferId };
  const transfers = await StockTransfer.find(query, { from_warehouse_id: 1, to_warehouse_id: 1, lines: 1 }).lean();
  const nets = new Map();
  const add = (wh, item, q) => {
    if (String(wh) === String(defaultId)) return;
    const k = `${wh}|${item}`;
    nets.set(k, stock.round4((nets.get(k) || 0) + q));
  };
  for (const t of transfers) {
    for (const l of t.lines) {
      add(t.from_warehouse_id, l.item_ref, -l.qty);
      add(t.to_warehouse_id, l.item_ref, l.qty);
    }
  }
  return nets;
};

// Quantity of an item held in a warehouse.
const heldIn = (warehouseId, defaultId, itemRef, stockQty, nets) => {
  if (String(warehouseId) !== String(defaultId)) return nets.get(`${warehouseId}|${itemRef}`) || 0;
  let elsewhere = 0;
  for (const [k, q] of nets) if (k.endsWith(`|${itemRef}`)) elsewhere += q;
  return stock.round4((Number(stockQty) || 0) - elsewhere);
};

class WarehouseController {
  // GET /inventory/warehouses?org_id=
  async list(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const def = await ensureDefault(org, res.locals?.user_id);
      const [warehouses, items, nets] = await Promise.all([
        Warehouse.find({ organization_id: org }).sort({ is_default: -1, name: 1 }).lean(),
        mongoose.model("Item").find(tracked(org), { stock_qty: 1, avg_cost: 1 }).lean(),
        transferNets(org, def._id),
      ]);
      const rows = warehouses.map((w) => {
        let units = 0;
        let value = 0;
        let lines = 0;
        for (const it of items) {
          const q = heldIn(w._id, def._id, it._id, it.stock_qty, nets);
          if (q > 0) {
            units += q;
            value += q * (Number(it.avg_cost) || 0);
            lines += 1;
          }
        }
        return { ...w, items: lines, units: stock.round4(units), value: stock.round2(value) };
      });
      res.status(ST_CODES.OK).json({ status: true, data: rows });
    } catch (error) {
      console.error("warehouse list error", error);
      return bad(res, "Couldn't load warehouses", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /inventory/warehouses  { org_id, name, code?, address? }
  async create(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const name = clean(req.body?.name, 80);
      if (!name) return bad(res, "Give the warehouse a name");
      await ensureDefault(org, res.locals?.user_id);
      if (await Warehouse.exists({ organization_id: org, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) {
        return bad(res, "A warehouse with this name already exists");
      }
      const w = await Warehouse.create({ organization_id: org, admin_id: res.locals?.user_id, name, code: clean(req.body?.code, 20), address: clean(req.body?.address, 300) });
      res.status(ST_CODES.CREATED || 201).json({ status: true, data: w });
    } catch (error) {
      console.error("warehouse create error", error);
      return bad(res, "Couldn't add the warehouse", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // PATCH /inventory/warehouses/:id  { org_id, name?, code?, address?, active? }
  async update(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Warehouse not found", ST_CODES.NOT_FOUND);
      const w = await Warehouse.findOne({ _id: req.params.id, organization_id: org });
      if (!w) return bad(res, "Warehouse not found", ST_CODES.NOT_FOUND);
      if (req.body?.name !== undefined) {
        const name = clean(req.body.name, 80);
        if (!name) return bad(res, "Give the warehouse a name");
        w.name = name;
      }
      if (req.body?.code !== undefined) w.code = clean(req.body.code, 20);
      if (req.body?.address !== undefined) w.address = clean(req.body.address, 300);
      if (req.body?.active !== undefined) {
        if (!req.body.active && w.is_default) return bad(res, "The default warehouse can't be switched off");
        w.active = Boolean(req.body.active);
      }
      await w.save();
      res.status(ST_CODES.OK).json({ status: true, data: w });
    } catch (error) {
      console.error("warehouse update error", error);
      return bad(res, "Couldn't save the warehouse", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // DELETE /inventory/warehouses/:id  only when it never held or moved stock.
  async remove(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Warehouse not found", ST_CODES.NOT_FOUND);
      const w = await Warehouse.findOne({ _id: req.params.id, organization_id: org });
      if (!w) return bad(res, "Warehouse not found", ST_CODES.NOT_FOUND);
      if (w.is_default) return bad(res, "The default warehouse can't be removed");
      if (await StockTransfer.exists({ organization_id: org, $or: [{ from_warehouse_id: w._id }, { to_warehouse_id: w._id }] })) {
        return bad(res, "This warehouse has stock transfers, so it can't be removed. Switch it off instead.");
      }
      await w.deleteOne();
      res.status(ST_CODES.OK).json({ status: true, message: "Warehouse removed" });
    } catch (error) {
      console.error("warehouse remove error", error);
      return bad(res, "Couldn't remove the warehouse", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/warehouses/:id/stock?org_id=  items held in one warehouse.
  async stockIn(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Warehouse not found", ST_CODES.NOT_FOUND);
      const w = await Warehouse.findOne({ _id: req.params.id, organization_id: org }).lean();
      if (!w) return bad(res, "Warehouse not found", ST_CODES.NOT_FOUND);
      const def = await ensureDefault(org, res.locals?.user_id);
      const [items, nets] = await Promise.all([
        mongoose.model("Item").find(tracked(org), { item_id: 1, name: 1, item_name: 1, sku: 1, unit: 1, stock_qty: 1, avg_cost: 1 }).sort({ name: 1 }).lean(),
        transferNets(org, def._id),
      ]);
      const rows = items
        .map((it) => ({ _id: it._id, item_id: it.item_id, name: it.name || it.item_name || "", sku: it.sku || "", unit: it.unit || "", qty: heldIn(w._id, def._id, it._id, it.stock_qty, nets), unit_cost: stock.round2(it.avg_cost) }))
        .filter((r) => r.qty !== 0)
        .map((r) => ({ ...r, value: stock.round2(Math.max(r.qty, 0) * r.unit_cost) }));
      res.status(ST_CODES.OK).json({ status: true, data: rows, warehouse: w });
    } catch (error) {
      console.error("warehouse stock error", error);
      return bad(res, "Couldn't load the stock", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/transfers/lookups?org_id=  active warehouses and stock items.
  async lookups(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const def = await ensureDefault(org, res.locals?.user_id);
      const [warehouses, items, nets] = await Promise.all([
        Warehouse.find({ organization_id: org, active: true }).sort({ is_default: -1, name: 1 }).lean(),
        mongoose.model("Item").find(tracked(org), { item_id: 1, name: 1, item_name: 1, unit: 1, stock_qty: 1 }).sort({ name: 1 }).limit(1000).lean(),
        transferNets(org, def._id),
      ]);
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          warehouses,
          items: items.map((it) => ({
            _id: it._id, name: it.name || it.item_name || "", unit: it.unit || "",
            held: Object.fromEntries(warehouses.map((w) => [String(w._id), heldIn(w._id, def._id, it._id, it.stock_qty, nets)])),
          })),
        },
      });
    } catch (error) {
      console.error("transfer lookups error", error);
      return bad(res, "Couldn't load the options", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /inventory/transfers?org_id=
  async transfers(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const [list, warehouses] = await Promise.all([
        StockTransfer.find({ organization_id: org }).sort({ date: -1, _id: -1 }).limit(500).lean(),
        Warehouse.find({ organization_id: org }, { name: 1 }).lean(),
      ]);
      const names = new Map(warehouses.map((w) => [String(w._id), w.name]));
      res.status(ST_CODES.OK).json({
        status: true,
        data: list.map((t) => ({ ...t, from_name: names.get(String(t.from_warehouse_id)) || "", to_name: names.get(String(t.to_warehouse_id)) || "" })),
      });
    } catch (error) {
      console.error("transfer list error", error);
      return bad(res, "Couldn't load transfers", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /inventory/transfers  { org_id, date, from_warehouse_id, to_warehouse_id, note?, lines: [{ item_ref, qty }] }
  async transferCreate(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const { from_warehouse_id: fromId, to_warehouse_id: toId } = req.body || {};
      const date = strictDate(req.body?.date);
      if (!date) return bad(res, "Enter a valid date");
      if (!mongoose.isValidObjectId(fromId) || !mongoose.isValidObjectId(toId)) return bad(res, "Choose where the stock moves from and to");
      if (String(fromId) === String(toId)) return bad(res, "Choose two different warehouses");
      const def = await ensureDefault(org, res.locals?.user_id);
      const [from, to] = await Promise.all([Warehouse.findOne({ _id: fromId, organization_id: org }).lean(), Warehouse.findOne({ _id: toId, organization_id: org }).lean()]);
      if (!from || !to) return bad(res, "Warehouse not found", ST_CODES.NOT_FOUND);
      if (!to.active) return bad(res, "The receiving warehouse is switched off");

      const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
      if (!raw.length) return bad(res, "Add at least one item to move");
      if (raw.length > 200) return bad(res, "Too many lines");
      const wanted = new Map();
      for (const l of raw) {
        if (!mongoose.isValidObjectId(l?.item_ref)) return bad(res, "Choose an item on every line");
        const q = Number(l.qty);
        if (!Number.isFinite(q) || q <= 0 || q > MAX_QTY) return bad(res, "Each quantity must be more than zero");
        if (!decimals(q, 4)) return bad(res, "Quantities can have at most 4 decimal places");
        wanted.set(String(l.item_ref), stock.round4((wanted.get(String(l.item_ref)) || 0) + q));
      }
      const items = await mongoose.model("Item").find({ ...tracked(org), _id: { $in: [...wanted.keys()] } }).lean();
      if (items.length !== wanted.size) return bad(res, "Only items whose stock you track can be moved");

      const nets = await transferNets(org, def._id);
      for (const it of items) {
        const have = heldIn(from._id, def._id, it._id, it.stock_qty, nets);
        if (wanted.get(String(it._id)) > have + 1e-9) {
          return bad(res, `${it.name || it.item_name}: only ${Math.max(have, 0)} in ${from.name}, ${wanted.get(String(it._id))} requested`);
        }
      }
      const transfer_number = await commonHelper.generateUniqueId(StockTransfer, "transfer_number", 5, "ST");
      const t = await StockTransfer.create({
        organization_id: org, admin_id: res.locals?.user_id, transfer_number, date,
        from_warehouse_id: from._id, to_warehouse_id: to._id, note: clean(req.body?.note, 300),
        lines: items.map((it) => ({ item_ref: it._id, item_id: it.item_id || "", item_name: it.name || it.item_name || "", qty: wanted.get(String(it._id)) })),
      });
      res.status(ST_CODES.CREATED || 201).json({ status: true, message: `Transfer ${transfer_number} saved`, data: t });
    } catch (error) {
      console.error("transfer create error", error);
      return bad(res, "Couldn't save the transfer", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // DELETE /inventory/transfers/:id  only if nothing moved on from the receiving warehouse.
  async transferRemove(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Transfer not found", ST_CODES.NOT_FOUND);
      const t = await StockTransfer.findOne({ _id: req.params.id, organization_id: org });
      if (!t) return bad(res, "Transfer not found", ST_CODES.NOT_FOUND);
      const def = await ensureDefault(org, res.locals?.user_id);
      const nets = await transferNets(org, def._id, t._id);
      const items = await mongoose.model("Item").find({ _id: { $in: t.lines.map((l) => l.item_ref) } }, { stock_qty: 1, name: 1 }).lean();
      const byId = new Map(items.map((i) => [String(i._id), i]));
      // Without this transfer, the receiving warehouse must not end up short.
      for (const l of t.lines) {
        const it = byId.get(String(l.item_ref));
        const left = heldIn(t.to_warehouse_id, def._id, l.item_ref, it?.stock_qty, nets);
        if (left < -1e-9) return bad(res, `Stock from this transfer has already moved on (${l.item_name}). Remove the later transfers first.`);
      }
      await t.deleteOne();
      res.status(ST_CODES.OK).json({ status: true, message: "Transfer removed" });
    } catch (error) {
      console.error("transfer remove error", error);
      return bad(res, "Couldn't remove the transfer", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}

module.exports = new WarehouseController();
