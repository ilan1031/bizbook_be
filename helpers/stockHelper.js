// Stock ledger for tracked goods items.
//
// Every document that moves stock owns its movements (StockMovement
// source_type + source_id): opening stock, bill, invoice, credit note,
// vendor credit, inventory adjustment. Saving a document replaces its
// movements with the lines it has now (none while it is draft or void), so
// an edit is "reverse the old, apply the new", a void or delete is "apply
// nothing", and applying the same document twice never doubles stock.
//
// After every change the affected items are rebuilt in date order. That sets
// each movement's unit cost and balance, and the item's cached stock on hand
// (stock_qty), stock value (stock_value) and average cost (avg_cost).
//
// Valuation: weighted average cost, or FIFO / LIFO (cost layers, oldest or
// newest sold first) when the item's valuation method says so. An oversold item keeps
// a negative quantity but its value is held at zero.
const mongoose = require("mongoose");
const StockMovement = require("../model/StockMovement");
const InventorySettings = require("../model/InventorySettings");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const orgKey = (v) => String(v ?? "");
const itemModel = () => mongoose.model("Item");
const docDate = (d) => {
  const x = d ? new Date(d) : new Date();
  return Number.isNaN(x.getTime()) ? new Date() : x;
};
const isLive = (status) => !["draft", "void"].includes(String(status || "").toLowerCase());
const isTracked = (item) => Boolean(item && item.track_inventory && (item.item_type || "goods") !== "service");

// Items of an organisation by item code or Mongo id (documents carry either).
const findItems = async (orgId, keys) => {
  const ids = [...new Set(keys.map((k) => String(k || "")).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const oids = ids.filter((k) => mongoose.isValidObjectId(k)).map((k) => new mongoose.Types.ObjectId(k));
  const docs = await itemModel()
    .find({ organization_id: orgKey(orgId), $or: [{ item_id: { $in: ids } }, ...(oids.length ? [{ _id: { $in: oids } }] : [])] })
    .lean();
  for (const d of docs) {
    map.set(String(d.item_id), d);
    map.set(String(d._id), d);
  }
  return map;
};

// Stock lines of a document: tracked goods only, quantity signed by `sign`.
const trackedLines = async (orgId, rawLines, sign, rateOf = () => null) => {
  const lines = (Array.isArray(rawLines) ? rawLines : []).filter((l) => l && l.item_id);
  const items = await findItems(orgId, lines.map((l) => l.item_id));
  const out = [];
  for (const l of lines) {
    const item = items.get(String(l.item_id));
    if (!isTracked(item)) continue;
    const qty = round4(Math.abs(Number(l.quantity) || 0));
    if (!qty) continue;
    out.push({ item_ref: item._id, item_id: item.item_id, item_name: item.name || item.item_name || "", qty: sign * qty, rate: rateOf(l) });
  }
  return out;
};

// Replaces the movements of one source document and rebuilds the items.
// lines: [{ item_ref, item_id, item_name, qty, rate, value }]
const syncSource = async ({ organization_id, admin_id, source_type, source_id, source_number, date, party_name, lines, sort_rank = 1 }) => {
  const org = orgKey(organization_id);
  const sid = String(source_id);
  const previous = await StockMovement.find({ organization_id: org, source_type, source_id: sid }, { item_ref: 1 }).lean();
  await StockMovement.deleteMany({ organization_id: org, source_type, source_id: sid });
  if (lines.length) {
    await StockMovement.insertMany(
      lines.map((l) => ({
        organization_id: org,
        admin_id,
        item_ref: l.item_ref,
        item_id: l.item_id || "",
        item_name: l.item_name || "",
        date: docDate(date),
        sort_rank,
        qty: l.qty,
        rate_input: l.rate == null || l.rate === "" ? null : Number(l.rate),
        value: l.qty === 0 ? Number(l.value) || 0 : 0,
        source_type,
        source_id: sid,
        source_number: String(source_number || ""),
        party_name: String(party_name || ""),
      }))
    );
  }
  const affected = new Set([...previous, ...lines].map((x) => String(x.item_ref)));
  for (const id of affected) await rebuildItem(id);
  // The document itself may now hold no movement (void, draft, delete): its cost lines follow.
  await applyStockCost(source_type, sid, org);
};

// Opening stock is recorded from the item form: one movement dated before any
// document (documents can be backdated before the item was created), so it is
// always the first movement of the item.
const OPENING_DATE = new Date("1900-01-01T00:00:00Z");
const insertOpening = (item) =>
  StockMovement.create({
    organization_id: orgKey(item.organization_id),
    admin_id: item.admin_id,
    item_ref: item._id,
    item_id: item.item_id || "",
    item_name: item.name || item.item_name || "",
    date: OPENING_DATE,
    sort_rank: 0,
    qty: round4(item.opening_stock),
    rate_input: Number(item.opening_stock_rate) || Number(item.purchase_rate) || 0,
    source_type: "opening",
    source_id: String(item._id),
    source_number: "Opening stock",
  });

// Brings an item's opening movement in line with its form fields.
const refreshItem = async (itemDoc) => {
  const item = itemDoc.toObject ? itemDoc.toObject() : itemDoc;
  await StockMovement.deleteMany({ item_ref: item._id, source_type: "opening" });
  if (isTracked(item) && Number(item.opening_stock) > 0) await insertOpening(item);
  await rebuildItem(item._id);
};

// ---- Books: the stock side of the journals -------------------------------
// Bill lines for tracked goods debit Inventory Asset (see purchaseHelper).
// Sales, credit notes and vendor credits carry the cost of the stock they
// moved as marker lines (stock_line) in their own journal, rewritten from the
// ledger whenever it changes. Opening stock has its own journal per item.
const STOCK_DOC_MODEL = { invoice: "Invoice", credit_note: "Credit_note", vendor_credit: "Vendor_credit" };
const STOCK_ACCOUNT = ["AC_084", "Inventory Asset"];
const COGS_ACCOUNT = ["AC_078", "Cost of Goods Sold"];
const OPENING_OFFSET_ACCOUNT = ["AC_043", "Opening Balance Offset"];
const journalLine = ([id, name], side, amount, stock = false) => ({
  coa_account_id: id,
  coa_account_name: name,
  creditOrDebit: side,
  amount: round2(amount),
  amount_formatted: `₹${round2(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  stock_line: stock,
});

// Rewrites the cost lines of a sale, credit note or vendor credit from its
// ledger value V (negative when stock leaves): out = Dr Cost of Goods Sold,
// Cr Inventory Asset; in = the reverse. Other journal lines are untouched.
const applyStockCost = async (source_type, source_id, organization_id) => {
  const modelName = STOCK_DOC_MODEL[source_type];
  if (!modelName || !mongoose.modelNames().includes(modelName)) return;
  const doc = await mongoose.model(modelName).findById(source_id, { journal_id: 1, organization_id: 1 }).lean();
  if (!doc || !doc.journal_id) return;
  const org = orgKey(doc.organization_id || organization_id);
  const [agg] = await StockMovement.aggregate([
    { $match: { organization_id: org, source_type, source_id: String(source_id) } },
    { $group: { _id: null, v: { $sum: "$value" } } },
  ]);
  const v = round2(agg?.v || 0);
  const lines = [];
  if (v < 0) lines.push(journalLine(COGS_ACCOUNT, "Debit", -v, true), journalLine(STOCK_ACCOUNT, "Credit", -v, true));
  else if (v > 0) lines.push(journalLine(STOCK_ACCOUNT, "Debit", v, true), journalLine(COGS_ACCOUNT, "Credit", v, true));
  const Journal = mongoose.model("Journal");
  const journal = await Journal.findOne({ journal_id: doc.journal_id, organization_id: org }, { line_items: 1 }).lean();
  if (!journal) return;
  const kept = (journal.line_items || []).filter((l) => !l.stock_line);
  await Journal.updateOne({ journal_id: doc.journal_id, organization_id: org }, { $set: { line_items: [...kept, ...lines] } });
};

// Books the item's opening stock: Dr Inventory Asset / Cr Opening Balance Offset
// for the value of its opening movement. Removed when the item is not tracked
// or has no opening value.
const applyOpeningJournal = async (item) => {
  const Journal = mongoose.model("Journal");
  const current = await itemModel().findById(item._id, { opening_journal_id: 1 }).lean();
  const existing = current?.opening_journal_id || "";
  const org = orgKey(item.organization_id);
  const [agg] = await StockMovement.aggregate([
    { $match: { item_ref: item._id, source_type: "opening" } },
    { $group: { _id: null, v: { $sum: "$value" } } },
  ]);
  const amount = round2(agg?.v || 0);
  if (!isTracked(item) || amount <= 0) {
    if (existing) {
      await Journal.deleteOne({ journal_id: existing, organization_id: org });
      await itemModel().updateOne({ _id: item._id }, { $set: { opening_journal_id: "" } });
    }
    return;
  }
  const lines = [journalLine(STOCK_ACCOUNT, "Debit", amount), journalLine(OPENING_OFFSET_ACCOUNT, "Credit", amount)];
  if (existing && (await Journal.exists({ journal_id: existing, organization_id: org }))) {
    await Journal.updateOne({ journal_id: existing, organization_id: org }, { $set: { line_items: lines, total_amount: amount } });
    return;
  }
  const commonHelper = require("./commonHelpers");
  const journal_id = await commonHelper.generateUniqueId(Journal, "journal_id", 5, "JL");
  const when = item.createdAt || new Date();
  await Journal.create({
    organization_id: org,
    admin_id: item.admin_id,
    journal_id,
    journal_date: when,
    journal_date_formatted: commonHelper.formatDateString(when),
    total_amount: amount,
    total_amount_formatted: `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    type: "Opening Stock",
    customer_name: "",
    line_items: lines,
    posting_status: "posted",
  });
  await itemModel().updateOne({ _id: item._id }, { $set: { opening_journal_id: journal_id } });
};

// Recomputes an item's ledger from its movements and stores the balances.
const rebuildItem = async (itemRef) => {
  const item = await itemModel().findById(itemRef).lean();
  if (!item) return;
  if (!isTracked(item)) {
    await itemModel().updateOne({ _id: item._id }, { $set: { stock_qty: 0, stock_value: 0, avg_cost: 0 } });
    await applyOpeningJournal(item);
    return;
  }
  // Items that had opening stock before it was recorded get the movement now.
  if (Number(item.opening_stock) > 0 && !(await StockMovement.exists({ item_ref: item._id, source_type: "opening" }))) {
    await insertOpening(item);
  }
  const method = String(item.valuation_method || "").toLowerCase();
  const layered = method === "fifo" || method === "lifo"; // cost layers
  const newestFirst = method === "lifo"; // LIFO sells the newest layer first
  const movs = await StockMovement.find({ item_ref: item._id }).sort({ date: 1, sort_rank: 1, _id: 1 }).lean();

  let qty = 0;
  let value = 0;
  let unit = 0; // last known unit cost (kept while stock is zero)
  const layers = []; // FIFO / LIFO: [{ qty, unit }] oldest first
  const ops = [];
  const layerValue = () => layers.reduce((s, l) => s + l.qty * l.unit, 0);

  for (const m of movs) {
    const q = Number(m.qty) || 0;
    let rate = unit;
    let movementValue = 0;
    const before = value;
    if (q > 0) {
      const cost = m.rate_input == null ? unit : Number(m.rate_input);
      const prev = qty;
      qty = round4(prev + q);
      // Units sold beyond stock are covered by the receipt first; only the rest is stock.
      const kept = prev < 0 ? Math.max(qty, 0) : q;
      if (layered && kept > 0) layers.push({ qty: kept, unit: cost });
      rate = cost;
      value = round2(value + kept * cost);
    } else if (q < 0) {
      const need = -q;
      let cost = 0;
      if (layered) {
        let left = need;
        while (left > 1e-9 && layers.length) {
          const i = newestFirst ? layers.length - 1 : 0;
          const take = Math.min(layers[i].qty, left);
          cost += take * layers[i].unit;
          layers[i].qty = round4(layers[i].qty - take);
          left = round4(left - take);
          if (layers[i].qty <= 1e-9) layers.splice(i, 1);
        }
        if (left > 1e-9) cost += left * unit; // sold beyond recorded stock
      } else {
        cost = need * unit;
      }
      rate = need ? round2(cost) / need : unit;
      value = round2(value - cost);
      qty = round4(qty - need);
      // Oversold: quantity stays negative, the value is held at zero.
      if (qty <= 0) value = 0;
    } else if (m.value) {
      // Value-only change from an adjustment.
      const delta = Number(m.value) || 0;
      if (layered && layers.length && qty > 0) {
        const total = layerValue();
        const target = total + delta;
        for (const l of layers) l.unit = total > 0 ? (l.unit * target) / total : target / qty;
        value = round2(layerValue());
      } else {
        value = round2(value + delta);
      }
    }
    movementValue = round2(value - before);
    if (qty > 0) unit = value / qty;
    ops.push({
      updateOne: {
        filter: { _id: m._id },
        update: {
          $set: {
            rate: round2(rate),
            value: movementValue,
            running_qty: qty,
            running_value: value,
            unit_cost: round2(unit),
          },
        },
      },
    });
  }
  if (ops.length) await StockMovement.bulkWrite(ops);
  await itemModel().updateOne(
    { _id: item._id },
    { $set: { stock_qty: qty, stock_value: round2(value), avg_cost: round2(unit) } }
  );
  // A change can move the cost of documents dated later, so their cost lines follow.
  const sources = new Map();
  for (const m of movs) {
    if (STOCK_DOC_MODEL[m.source_type]) sources.set(`${m.source_type}:${m.source_id}`, m);
  }
  for (const m of sources.values()) await applyStockCost(m.source_type, m.source_id, m.organization_id);
  await applyOpeningJournal(item);
};

// Items that had opening stock before it was recorded: rebuilding them adds
// the movement. Called before reading stock figures for an organisation.
const backfillOpening = async (orgId) => {
  const org = orgKey(orgId);
  const have = new Set((await StockMovement.distinct("item_ref", { organization_id: org, source_type: "opening" })).map(String));
  const items = await itemModel().find({ organization_id: org, track_inventory: true, opening_stock: { $gt: 0 } }, { _id: 1 }).lean();
  for (const it of items) if (!have.has(String(it._id))) await rebuildItem(it._id);
};

const syncInvoice = async (inv) =>
  syncSource({
    organization_id: inv.organization_id,
    admin_id: inv.admin_id,
    source_type: "invoice",
    source_id: String(inv._id),
    source_number: inv.invoice_number,
    date: inv.date,
    party_name: inv.customer_name,
    lines: isLive(inv.status) ? await trackedLines(inv.organization_id, inv.line_items, -1) : [],
  });

const syncBill = async (bill) =>
  syncSource({
    organization_id: bill.organization_id,
    admin_id: bill.admin_id,
    source_type: "bill",
    source_id: String(bill._id),
    source_number: bill.bill_number,
    date: bill.billDate || bill.createdAt,
    party_name: bill.vendorName,
    lines: isLive(bill.status_type) ? await trackedLines(bill.organization_id, bill.items, 1, (l) => Number(l.rate) || 0) : [],
  });

// Sales credit notes bring goods back in (valued at current cost); vendor
// credits send them back out (valued at current cost).
const syncCredit = async (credit, kind) => {
  const sales = kind === "credit_note";
  return syncSource({
    organization_id: credit.organization_id,
    admin_id: credit.admin_id,
    source_type: kind,
    source_id: String(credit._id),
    source_number: credit.credit_number,
    date: credit.date,
    party_name: credit.contact_name,
    lines: isLive(credit.status) ? await trackedLines(credit.organization_id, credit.line_items, sales ? 1 : -1) : [],
  });
};

const clearSource = (organization_id, source_type, source_id) =>
  syncSource({ organization_id, admin_id: null, source_type, source_id, source_number: "", date: new Date(), party_name: "", lines: [] });

const sellPolicy = async (orgId) => {
  const s = await InventorySettings.findOne({ organization_id: orgKey(orgId) }).lean();
  return s?.sell_policy === "block" ? "block" : "warn";
};

// Checks an invoice's stock lines against what is on hand. Returns
// { blocked: message | null, warnings: [] }. An invoice being edited doesn't
// count its own stock against itself.
const checkInvoiceStock = async (orgId, inv) => {
  const org = orgKey(orgId);
  const none = { blocked: null, warnings: [] };
  if (!isLive(inv.status)) return none;
  await backfillOpening(org);
  const lines = await trackedLines(org, inv.line_items, -1);
  if (!lines.length) return none;
  const wanted = new Map();
  for (const l of lines) {
    const k = String(l.item_ref);
    const cur = wanted.get(k) || { item_ref: l.item_ref, item_name: l.item_name, qty: 0 };
    cur.qty = round4(cur.qty - l.qty);
    wanted.set(k, cur);
  }
  const short = [];
  for (const w of wanted.values()) {
    const item = await itemModel().findById(w.item_ref, { stock_qty: 1 }).lean();
    let onHand = Number(item?.stock_qty) || 0;
    if (inv._id) {
      const prior = await StockMovement.aggregate([
        { $match: { organization_id: org, item_ref: w.item_ref, source_type: "invoice", source_id: String(inv._id) } },
        { $group: { _id: null, qty: { $sum: "$qty" } } },
      ]);
      onHand -= Number(prior[0]?.qty) || 0;
    }
    if (w.qty > onHand + 1e-9) short.push({ item_name: w.item_name, on_hand: round4(Math.max(onHand, 0)), requested: w.qty });
  }
  if (!short.length) return none;
  if ((await sellPolicy(org)) === "block") {
    const list = short.map((s) => `${s.item_name}: ${s.on_hand} on hand, ${s.requested} requested`).join("; ");
    return {
      blocked: `Not enough stock to sell. ${list}. Reduce the quantity, or allow selling beyond stock in Inventory settings.`,
      warnings: [],
    };
  }
  return {
    blocked: null,
    warnings: short.map((s) => `Only ${s.on_hand} of ${s.item_name} in stock; ${s.requested} sold, so stock goes negative.`),
  };
};

// Tracked items at or below their reorder level (out of stock included).
const lowStock = (orgId) =>
  itemModel()
    .find(
      { organization_id: orgKey(orgId), track_inventory: true, reorder_level: { $gt: 0 }, $expr: { $lte: ["$stock_qty", "$reorder_level"] } },
      { name: 1, item_name: 1, item_id: 1, stock_qty: 1, reorder_level: 1 }
    )
    .lean();

// Input checks for stock fields on the item form. Returns a message or null.
const stockFieldError = (data) => {
  for (const [field, label] of [["opening_stock", "Opening stock"], ["opening_stock_rate", "Opening stock rate"], ["reorder_level", "Reorder level"]]) {
    const v = data[field];
    if (v === undefined || v === null || v === "") continue;
    if (!Number.isFinite(Number(v)) || Number(v) < 0) return `${label} must be a number of zero or more.`;
    if (Number(v) > 1e9) return `${label} is too large.`;
  }
  return null;
};

module.exports = {
  round2,
  round4,
  isTracked,
  isLive,
  findItems,
  trackedLines,
  syncSource,
  rebuildItem,
  refreshItem,
  backfillOpening,
  syncInvoice,
  syncBill,
  syncCredit,
  applyStockCost,
  clearSource,
  sellPolicy,
  checkInvoiceStock,
  lowStock,
  stockFieldError,
};
