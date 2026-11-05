// Inventory QA fixes (INV-FLOW-1 to 10): delete guard for items in use, the
// item lookup by id, bill import numbering and stock, the books for stock
// (COGS / Inventory Asset), the item's inventory account, valuation and
// summary agreeing on future-dated documents, oversold value and the bill
// status response.
//
// Runs against its own throwaway database (TEST_DB_URL + "_inv_fixes").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_inv_fixes$2");
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "1";
process.env.SUPERADMIN_EMAIL = "superadmin@test.local";
process.env.SUPERADMIN_PASSWORD = "Super@1234";
process.env.SUPERADMIN_MOBILE = "9000000001";
process.env.LOGIN_OTP_ENABLED = "false";
process.env.EMAIL_USER = "";
process.env.EMAIL_PASS = "";
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";

const mongoose = require("mongoose");
const request = require("supertest");

const realLog = console.log;
console.log = () => {};

let app;
let saToken;
let orgA;
let customer;
let vendor;
const SA_IP = "203.0.113.61";

const call = (method, url, { body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", SA_IP).set("Authorization", `Bearer ${saToken}`);
  return body === undefined ? r : r.send(body);
};
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const itemNamed = (org, name) => mongoose.model("Item").findOne({ organization_id: String(org), name }).lean();
const stockOf = async (item) => {
  const it = await mongoose.model("Item").findById(item._id).lean();
  return { qty: money(it.stock_qty), value: money(it.stock_value) };
};
const movementsOf = (item) => mongoose.model("Stock_movement").find({ item_ref: item._id }).lean();
const journalOf = (journal_id) => mongoose.model("Journal").findOne({ journal_id }).lean();
const sumSide = (lines, side) => money(lines.filter((l) => l.creditOrDebit === side).reduce((s, l) => s + Number(l.amount || 0), 0));

const newOrg = async (name) => {
  const o = await call("post", "/api/v1/org/create-organisation", { body: { organizationName: name, country: "India", state: "Tamil Nadu", industry_name: "Retail" } });
  assert.ok(o.status < 300, o.text);
  return String(o.body.data?.organization_id || o.body.organization_id);
};
const newContact = async (org, type, name) => {
  const r = await call("post", "/api/v1/contact", {
    body: {
      organization_id: org,
      contact_type: type,
      contact_name: name,
      company_name: name,
      place_of_contact: "Tamil Nadu",
      contact_persons: [{ first_name: name, email: `${name.replace(/\W/g, "").toLowerCase()}@fix.test`, is_primary_contact: true }],
    },
  });
  assert.ok(r.status < 300, r.text);
  return r.body.data.contact_id;
};
const newItem = async (org, body) => {
  const r = await call("post", "/api/v1/items/newitems", {
    body: {
      organization_id: org,
      item_type: "goods",
      can_be_sold: true,
      can_be_purchased: true,
      track_inventory: true,
      valuation_method: "average",
      ...body,
      item_name: body.name,
    },
  });
  assert.ok(r.status < 300, r.text);
  return itemNamed(org, body.name);
};
const line = (item, quantity, rate = 100) => ({ item_id: item.item_id, name: item.name, quantity, rate, gst_rate: 0 });
const newInvoice = (org, lines, status = "sent", date = "2026-11-03") =>
  call("post", `/api/v1/invoices?org_id=${org}`, {
    body: {
      organization_id: org,
      customer_id: customer,
      customer_name: "Fix Customer",
      date,
      due_date: date > "2026-11-05" ? date : "2026-12-03",
      status,
      status_formatted: status,
      place_of_supply: "Tamil Nadu",
      line_items: lines,
    },
  });
const newBill = (org, lines, status = 0, billDate = "2026-11-01") =>
  call("post", `/api/v1/bills/create-bills?org_id=${org}`, {
    body: {
      status,
      vendor_id: vendor,
      vendorName: "Fix Supplies",
      billDate,
      dueDate: "2026-12-01",
      items: lines.map((l) => ({ ...l, item_name: l.name, amount: l.quantity * l.rate })),
    },
  });

test.before(async () => {
  const conn = await mongoose.createConnection(process.env.DB_Coll).asPromise();
  await conn.dropDatabase();
  await conn.close();
  app = require("../../app");
  for (let i = 0; i < 100 && mongoose.connection.readyState !== 1; i++) await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 50; i++) {
    if (await mongoose.model("user").exists({ role: "superadmin" })) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const l = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", SA_IP).send({ email: "superadmin@test.local", password: "Super@1234" });
  assert.equal(l.status, 200, l.text);
  saToken = l.body.token;
  orgA = await newOrg("Fixes A");
  customer = await newContact(orgA, "Customer", "Fix Customer");
  const vendorContact = await newContact(orgA, "Vendor", "Fix Supplies");
  vendor = String((await mongoose.model("Contact").findOne({ contact_id: vendorContact }).lean())._id);
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

// INV-FLOW-2: an item on a document can't be deleted, and its history stays.
test("INV-FLOW-2: an item used on an invoice is refused and keeps its stock history", async () => {
  const used = await newItem(orgA, { name: "Used On Invoice", opening_stock: 5, opening_stock_rate: 10 });
  const inv = await newInvoice(orgA, [line(used, 1, 10)]);
  assert.equal(inv.status, 201, inv.text);
  const before = (await movementsOf(used)).length;
  assert.ok(before >= 2);

  const del = await call("delete", `/api/v1/items/${used.item_id}?organization_id=${orgA}`);
  assert.equal(del.status, 400, del.text);
  assert.equal(del.body.status, false);
  assert.match(del.body.message, /in use on invoices/);
  assert.ok(await mongoose.model("Item").exists({ _id: used._id }), "item still exists");
  assert.equal((await movementsOf(used)).length, before, "stock history kept");
});

test("INV-FLOW-2: an unused item is deleted and its stock history goes with it", async () => {
  const spare = await newItem(orgA, { name: "Spare Item", opening_stock: 2, opening_stock_rate: 5 });
  assert.ok((await movementsOf(spare)).length >= 1);
  const del = await call("delete", `/api/v1/items/${spare.item_id}?organization_id=${orgA}`);
  assert.equal(del.status, 200, del.text);
  assert.equal(await mongoose.model("Item").exists({ _id: spare._id }), null);
  assert.equal((await movementsOf(spare)).length, 0);
});

// INV-FLOW-3: the item page can load any item by id, not only the 10 newest.
test("INV-FLOW-3: an item older than the 10 newest loads by item_id, scoped to the organisation", async () => {
  const old = await newItem(orgA, { name: "Old Tracked Item", opening_stock: 4, opening_stock_rate: 20 });
  for (let i = 1; i <= 11; i++) await newItem(orgA, { name: `Newer Item ${i}` });

  const r = await call("get", `/api/v1/item/getitems?organization_id=${orgA}&item_id=${old.item_id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].name, "Old Tracked Item");
  assert.equal(r.body.data[0].track_inventory, true);

  const byObjectId = await call("get", `/api/v1/item/getitems?organization_id=${orgA}&item_id=${String(old._id)}`);
  assert.equal(byObjectId.body.data[0]?.item_id, old.item_id);

  const otherOrg = await newOrg("Fixes Other");
  const hidden = await call("get", `/api/v1/item/getitems?organization_id=${otherOrg}&item_id=${old.item_id}`);
  assert.equal(hidden.body.data.length, 0, "another organisation's query finds nothing");
});

// INV-FLOW-4 and INV-FLOW-5: imported bills get their own numbers and move stock.
test("INV-FLOW-4/5: imported bills are numbered per organisation and move stock in", async () => {
  const pen = await newItem(orgA, { name: "Import Pen", opening_stock: 3, opening_stock_rate: 40 });
  const row = (billNumber, quantity) => ({
    name: "Import Pen",
    vendor_name: "Fix Supplies",
    gst_no: "",
    billNumber,
    orderNumber: "",
    billDate: "2026-11-01",
    due_date: "2026-12-01",
    quantity,
    item_total: 50,
    subtotal: 50 * quantity,
    total: 50 * quantity,
    taxAmount: 0,
    adjustment: 0,
    payment_made: 0,
    due_amt: 50 * quantity,
    commission: 0,
    taxCategory: "",
    notes: "",
    source_of_supply: "Tamil Nadu",
    destination_of_supply: "Tamil Nadu",
    paymentTerms: "",
    reference_number: "",
    exchange_rate: 1,
  });
  const imp = await call("post", `/api/v1/import/import-bills?org_id=${orgA}`, { body: [row("IMP-1", 5), row("IMP-2", 2)] });
  assert.equal(imp.status, 200, imp.text);

  const bills = await mongoose.model("PO_bill").find({ billNumber: { $in: ["IMP-1", "IMP-2"] } }).lean();
  assert.equal(bills.length, 2);
  assert.notEqual(bills[0].bill_number, bills[1].bill_number, "each bill gets its own number");
  for (const b of bills) assert.match(b.bill_number, /^BL-/);

  // 3 opening + 5 + 2 imported
  assert.equal((await stockOf(pen)).qty, 10);
  for (const b of bills) {
    const rows = await mongoose.model("Stock_movement").find({ source_type: "bill", source_id: String(b._id) }).lean();
    assert.equal(rows.length, 1, `bill ${b.billNumber} has a stock history row`);
  }
});

// INV-FLOW-1 (automatic posting): a sale posts COGS / Inventory Asset at cost;
// a tracked bill line debits Inventory Asset; both journals balance.
test("INV-FLOW-1: a sale posts Cost of Goods Sold at the item's cost, a tracked bill debits Inventory Asset", async () => {
  const gadget = await newItem(orgA, { name: "Costed Gadget", opening_stock: 10, opening_stock_rate: 50 });

  const bill = await newBill(orgA, [line(gadget, 2, 70)]);
  assert.equal(bill.status, 201, bill.text);
  const billDoc = await mongoose.model("PO_bill").findOne({ items: { $elemMatch: { item_id: gadget.item_id } } }).sort({ _id: -1 }).lean();
  const billJournal = await journalOf(billDoc.journal_id);
  assert.equal(sumSide(billJournal.line_items, "Debit"), sumSide(billJournal.line_items, "Credit"), "bill journal balances");
  const invDebit = billJournal.line_items.find((l) => l.coa_account_id === "AC_084" && l.creditOrDebit === "Debit");
  assert.ok(invDebit, "tracked bill line debits Inventory Asset");
  assert.equal(money(invDebit.amount), 140);
  assert.ok(!billJournal.line_items.some((l) => l.coa_account_id === gadget.account_id && l.creditOrDebit === "Debit" && l.amount === 140), "not debited to an expense account");

  // Average cost after the bill: (10 @ 50 + 2 @ 70) / 12 = 53.33; 3 sold.
  const inv = await newInvoice(orgA, [line(gadget, 3, 100)]);
  assert.equal(inv.status, 201, inv.text);
  const sale = await journalOf(inv.body.data.journal_id);
  assert.equal(sumSide(sale.line_items, "Debit"), sumSide(sale.line_items, "Credit"), "sale journal balances");
  const cogs = sale.line_items.filter((l) => l.stock_line && l.coa_account_id === "AC_078" && l.creditOrDebit === "Debit");
  const ia = sale.line_items.filter((l) => l.stock_line && l.coa_account_id === "AC_084" && l.creditOrDebit === "Credit");
  assert.equal(cogs.length, 1);
  assert.equal(ia.length, 1);
  assert.ok(Math.abs(cogs[0].amount - 160) < 0.01, `COGS ${cogs[0].amount}`);
  assert.equal(money(ia[0].amount), money(cogs[0].amount));
  assert.ok(sale.line_items.some((l) => l.coa_account_id === "AC_046"), "sales revenue unchanged");

  // Saving the same posting again doesn't double the cost lines.
  const { applyStockCost } = require("../../helpers/stockHelper");
  await applyStockCost("invoice", inv.body.data._id, orgA);
  const again = await journalOf(inv.body.data.journal_id);
  assert.equal(again.line_items.filter((l) => l.stock_line).length, 2);
});

test("INV-FLOW-1: a draft sale posts no cost lines", async () => {
  const gadget = await itemNamed(orgA, "Costed Gadget");
  const draft = await newInvoice(orgA, [line(gadget, 1, 100)], "draft");
  assert.equal(draft.status, 201, draft.text);
  const j = await journalOf(draft.body.data.journal_id);
  assert.equal(j.line_items.filter((l) => l.stock_line).length, 0);
});

// INV-FLOW-7: the Inventory Account chosen on the item form is stored and read back.
test("INV-FLOW-7: the item's Inventory Account is stored and shown when the item is read", async () => {
  const item = await newItem(orgA, { name: "Account Item", inventory_account_id: "inventory-asset", inventory_account_name: "Inventory Asset" });
  assert.equal(item.inventory_account_id, "inventory-asset");
  const r = await call("get", `/api/v1/item/singleitems/${item.item_id}?organization_id=${orgA}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.item_details.inventory_account_id, "inventory-asset");
  assert.equal(r.body.data.item_details.valuation_method, "average");
});

// INV-FLOW-8: summary and valuation agree for a document dated after today.
test("INV-FLOW-8: the stock summary and the valuation (today) agree with a future-dated sale", async () => {
  const future = await newItem(orgA, { name: "Future Dated", opening_stock: 5, opening_stock_rate: 10 });
  const inv = await newInvoice(orgA, [line(future, 1, 10)], "sent", "2099-12-20");
  assert.equal(inv.status, 201, inv.text);

  const summary = await call("get", `/api/v1/inventory/summary?org_id=${orgA}&limit=5000`);
  const row = summary.body.data.find((r) => r.name === "Future Dated");
  const valuation = await call("get", `/api/v1/inventory/valuation?org_id=${orgA}`);
  const v = valuation.body.data.find((r) => r.name === "Future Dated");
  assert.equal(row.stock_qty, v.qty);
});

// INV-FLOW-9: an oversold item shows a negative quantity and no negative value.
test("INV-FLOW-9: an oversold item keeps a negative quantity and a value of zero", async () => {
  const over = await newItem(orgA, { name: "Oversold Item", opening_stock: 2, opening_stock_rate: 5 });
  const sold = await newInvoice(orgA, [line(over, 3, 20)]);
  assert.equal(sold.status, 201, sold.text);
  assert.deepEqual(await stockOf(over), { qty: -1, value: 0 });
  const summary = await call("get", `/api/v1/inventory/summary?org_id=${orgA}&limit=5000`);
  assert.equal(summary.body.data.find((r) => r.name === "Oversold Item").stock_value, 0);
});

// INV-FLOW-10: a refused bill transition says so in the body.
test("INV-FLOW-10: voiding a void bill answers 400 with success false", async () => {
  const pen = await itemNamed(orgA, "Import Pen");
  const b = await newBill(orgA, [line(pen, 1, 30)]);
  assert.equal(b.status, 201, b.text);
  const billDoc = await mongoose.model("PO_bill").findOne({ items: { $elemMatch: { item_id: pen.item_id } } }).sort({ _id: -1 }).lean();
  const first = await call("post", `/api/v1/bills/update-status-void?org_id=${orgA}&bill_id=${billDoc.bill_number}&status=void`);
  assert.equal(first.status, 200, first.text);
  const second = await call("post", `/api/v1/bills/update-status-void?org_id=${orgA}&bill_id=${billDoc.bill_number}&status=void`);
  assert.equal(second.status, 400, second.text);
  assert.equal(second.body.success, false);
});

// INV-FLOW-6: LIFO is costed as LIFO (newest layers sold first) and reported as LIFO.
test("INV-FLOW-6: a LIFO item sells the newest layers first and is reported as LIFO", async () => {
  const lifo = await newItem(orgA, { name: "Lifo Item", valuation_method: "lifo", opening_stock: 10, opening_stock_rate: 100 });
  const bill = await newBill(orgA, [line(lifo, 10, 200)]);
  assert.equal(bill.status, 201, bill.text);
  const sold = await newInvoice(orgA, [line(lifo, 15, 300)]);
  assert.equal(sold.status, 201, sold.text);
  // Sold: 10 @ 200 + 5 @ 100 = 2500; left 5 @ 100 = 500.
  assert.deepEqual(await stockOf(lifo), { qty: 5, value: 500 });
  const summary = await call("get", `/api/v1/inventory/summary?org_id=${orgA}&limit=5000`);
  assert.equal(summary.body.data.find((r) => r.name === "Lifo Item").valuation_method, "lifo");
});
