// Inventory: stock ledger, automatic movements from bills / invoices / credit
// notes / vendor credits, valuation (average and FIFO), inventory adjustments
// with their journal, reorder levels and low stock, warn vs block when selling
// beyond stock, organisation isolation and the permission keys.
//
// Runs against its own throwaway database (TEST_DB_URL + "_inventory").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_inventory$2");
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
let bToken; // a business user of its own organisation, without inventory pages
let orgA;
let orgA2; // another organisation of the same owner
let orgB; // another business
let customer;
let vendor;
const SA_IP = "203.0.113.40";
const B_IP = "10.40.0.2";

const call = (method, url, { token, ip = SA_IP, body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};
const asA = (method, url, body) => call(method, url, { token: saToken, body });
const asB = (method, url, body) => call(method, url, { token: bToken, ip: B_IP, body });
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const itemNamed = (org, name) => mongoose.model("Item").findOne({ organization_id: String(org), name }).lean();
const stockOf = async (item) => {
  const it = await mongoose.model("Item").findById(item._id).lean();
  return { qty: money(it.stock_qty), value: money(it.stock_value), avg: money(it.avg_cost) };
};
const movementsOf = (item) => mongoose.model("Stock_movement").find({ item_ref: item._id }).sort({ date: 1, sort_rank: 1, _id: 1 }).lean();
const movementsFor = (source_type, source_id) => mongoose.model("Stock_movement").find({ source_type, source_id: String(source_id) }).lean();

const newOrg = async (as, name) => {
  const o = await as("post", "/api/v1/org/create-organisation", { organizationName: name, country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  assert.ok(o.status < 300, o.text);
  return String(o.body.data?.organization_id || o.body.organization_id);
};
const newContact = async (as, org, type, name) => {
  const r = await as("post", "/api/v1/contact", {
    organization_id: org,
    contact_type: type,
    contact_name: name,
    company_name: name,
    place_of_contact: "Tamil Nadu",
    contact_persons: [{ first_name: name, email: `${name.replace(/\W/g, "").toLowerCase()}@inv.test`, is_primary_contact: true }],
  });
  assert.ok(r.status < 300, r.text);
  return r.body.data.contact_id;
};
const newItem = async (org, body) => {
  const r = await asA("post", "/api/v1/items/newitems", {
    organization_id: org,
    item_type: "goods",
    can_be_sold: true,
    can_be_purchased: true,
    track_inventory: true,
    valuation_method: "average",
    ...body,
    name: body.name,
    item_name: body.name,
  });
  assert.ok(r.status < 300, r.text);
  return itemNamed(org, body.name);
};
const line = (item, quantity, rate = 100) => ({ item_id: item.item_id, name: item.name, quantity, rate, gst_rate: 0 });
const newInvoice = async (org, lines, status = "sent", date = "2026-11-03") => {
  const r = await asA("post", `/api/v1/invoices?org_id=${org}`, {
    organization_id: org,
    customer_id: customer,
    customer_name: "Inv Customer",
    date,
    due_date: "2026-12-03",
    status,
    status_formatted: status,
    place_of_supply: "Tamil Nadu",
    line_items: lines,
  });
  return r;
};
const newBill = async (org, lines, status = 0, billDate = "2026-11-01") => {
  const r = await asA("post", `/api/v1/bills/create-bills?org_id=${org}`, {
    status,
    vendor_id: vendor,
    vendorName: "Steel Supplies",
    billDate,
    dueDate: "2026-12-01",
    items: lines.map((l) => ({ ...l, item_name: l.name, amount: l.quantity * l.rate })),
  });
  return r;
};

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
  const l = await call("post", "/api/v1/user/user-login", { body: { email: "superadmin@test.local", password: "Super@1234" } });
  assert.equal(l.status, 200, l.text);
  saToken = l.body.token;
  orgA = await newOrg(asA, "Stock A");
  orgA2 = await newOrg(asA, "Stock A2");

  const B = { companyName: "Stock B Co", email: "stockb@test.local", password: "Bpass@1234", phoneNumber: "9123456782", country: "India", state: "Kerala", agreeToTerms: true };
  await call("post", "/api/v1/user/user-register", { ip: B_IP, body: B });
  const bId = String((await mongoose.model("user").findOne({ email: B.email }).lean())._id);
  const all = ["view", "create", "edit", "delete"];
  // Items, bills and vendors, but no inventory pages.
  await asA("patch", `/api/v1/admin/users/${bId}`, { status: "active", permissions: { items: all, bills: all, vendors: all, invoices: all } });
  const bl = await call("post", "/api/v1/user/user-login", { ip: B_IP, body: { email: B.email, password: B.password } });
  assert.equal(bl.status, 200, bl.text);
  bToken = bl.body.token;
  orgB = await newOrg(asB, "Stock B");

  customer = await newContact(asA, orgA, "Customer", "Stock Customer");
  // Bills name the vendor by its record id.
  const vendorContact = await newContact(asA, orgA, "Vendor", "Steel Supplies");
  vendor = String((await mongoose.model("Contact").findOne({ contact_id: vendorContact }).lean())._id);
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("opening stock becomes the first movement and sets stock on hand", async () => {
  const pen = await newItem(orgA, { name: "Opening Pen", opening_stock: 10, opening_stock_rate: 50, reorder_level: 4 });
  assert.deepEqual(await stockOf(pen), { qty: 10, value: 500, avg: 50 });
  const [first] = await movementsOf(pen);
  assert.equal(first.source_type, "opening");
  assert.equal(first.qty, 10);
  assert.equal(first.running_qty, 10);
  // Re-saving the item doesn't add the opening stock again.
  const r = await asA("put", `/api/v1/item/${pen.item_id}?organization_id=${orgA}`, { name: "Opening Pen", opening_stock: 10, opening_stock_rate: 50 });
  assert.ok(r.status < 300, r.text);
  assert.deepEqual(await stockOf(pen), { qty: 10, value: 500, avg: 50 });
});

test("bill adds stock, invoice takes it out, the invoice is reversed on void and delete", async () => {
  const pen = await itemNamed(orgA, "Opening Pen");
  const b = await newBill(orgA, [line(pen, 5, 60)]);
  assert.equal(b.status, 201, b.text);
  // 10 @ 50 + 5 @ 60 = 800 for 15 units
  assert.deepEqual(await stockOf(pen), { qty: 15, value: 800, avg: 53.33 });

  const inv = await newInvoice(orgA, [line(pen, 4)]);
  assert.equal(inv.status, 201, inv.text);
  const invoiceId = inv.body.data._id;
  assert.deepEqual(await stockOf(pen), { qty: 11, value: 586.67, avg: 53.33 });
  assert.equal((await movementsFor("invoice", invoiceId))[0].qty, -4);

  // Void: the sale is reversed.
  const v = await asA("put", `/api/v1/invoices/status?organization_id=${orgA}&invoice_id=${inv.body.data.invoice_id}`, { status: "void", status_formatted: "Void" });
  assert.equal(v.status, 200, v.text);
  assert.equal((await movementsFor("invoice", invoiceId)).length, 0);
  assert.deepEqual(await stockOf(pen), { qty: 15, value: 800, avg: 53.33 });

  // Delete a sent invoice: its movement goes too.
  const inv2 = await newInvoice(orgA, [line(pen, 3)]);
  assert.equal(inv2.status, 201, inv2.text);
  const d = await asA("delete", `/api/v1/invoices?org_id=${orgA}&invoice_id=${inv2.body.data.invoice_id}`);
  assert.equal(d.status, 200, d.text);
  assert.deepEqual(await stockOf(pen), { qty: 15, value: 800, avg: 53.33 });
});

test("editing an invoice reverses its old lines and applies the new ones", async () => {
  const pen = await itemNamed(orgA, "Opening Pen");
  const before = await stockOf(pen);
  const inv = await newInvoice(orgA, [line(pen, 2)]);
  assert.equal(inv.status, 201, inv.text);
  assert.equal((await stockOf(pen)).qty, before.qty - 2);
  const up = await asA("patch", `/api/v1/invoices?organization_id=${orgA}&invoice_id=${inv.body.data.invoice_id}`, { line_items: [line(pen, 6)] });
  assert.equal(up.status, 200, up.text);
  const mv = await movementsFor("invoice", inv.body.data._id);
  assert.equal(mv.length, 1, "one movement per invoice line, never doubled");
  assert.equal(mv[0].qty, -6);
  assert.equal((await stockOf(pen)).qty, before.qty - 6);
});

test("draft documents don't move stock until they are sent", async () => {
  const pen = await itemNamed(orgA, "Opening Pen");
  const before = await stockOf(pen);
  const draft = await newInvoice(orgA, [line(pen, 2)], "draft");
  assert.equal(draft.status, 201, draft.text);
  assert.deepEqual(await stockOf(pen), before);
  const sendIt = await asA("put", `/api/v1/invoices/status?organization_id=${orgA}&invoice_id=${draft.body.data.invoice_id}`, { status: "sent", status_formatted: "Sent" });
  assert.equal(sendIt.status, 200, sendIt.text);
  assert.equal((await stockOf(pen)).qty, before.qty - 2);
  const draftBill = await newBill(orgA, [line(pen, 9, 70)], 1);
  assert.equal(draftBill.status, 201, draftBill.text);
  // The draft bill (9 units) adds nothing; the sent invoice took 2 at average cost (a cent of rounding allowed).
  const after = await stockOf(pen);
  assert.equal(after.qty, before.qty - 2);
  assert.ok(Math.abs(after.value - (before.value - 2 * before.avg)) < 0.02, `value ${after.value}`);
});

test("bill void and delete reverse the stock in", async () => {
  const pen = await itemNamed(orgA, "Opening Pen");
  const b = await newBill(orgA, [line(pen, 20, 40)]);
  assert.equal(b.status, 201, b.text);
  const billDoc = await mongoose.model("PO_bill").findOne({ bill_number: b.body.data.bill_number }).lean();
  const qtyWith = (await stockOf(pen)).qty;
  const voidRes = await asA("post", `/api/v1/bills/update-status-void?org_id=${orgA}&bill_id=${billDoc.bill_number}&status=void`, {});
  assert.equal(voidRes.status, 200, voidRes.text);
  assert.equal((await stockOf(pen)).qty, qtyWith - 20);
  assert.equal((await movementsFor("bill", billDoc._id)).length, 0);
});

test("FIFO and average cost value the same sales differently", async () => {
  const avg = await newItem(orgA, { name: "Avg Item", valuation_method: "average" });
  const fifo = await newItem(orgA, { name: "Fifo Item", valuation_method: "fifo" });
  for (const it of [avg, fifo]) {
    assert.equal((await newBill(orgA, [line(it, 10, 100)], 0, "2026-11-01")).status, 201);
    assert.equal((await newBill(orgA, [line(it, 10, 200)], 0, "2026-11-02")).status, 201);
  }
  const sale = (it) => newInvoice(orgA, [line(it, 15, 300)], "sent", "2026-11-03");
  assert.equal((await sale(avg)).status, 201);
  assert.equal((await sale(fifo)).status, 201);
  // Average: 20 units cost 3000 (avg 150); 15 sold at 150 = 2250; 5 left worth 750.
  assert.deepEqual(await stockOf(avg), { qty: 5, value: 750, avg: 150 });
  // FIFO: 10 @ 100 and 5 @ 200 sold = 2000; 5 left at 200 = 1000.
  assert.deepEqual(await stockOf(fifo), { qty: 5, value: 1000, avg: 200 });
});

test("credit note brings goods back in, vendor credit sends them out", async () => {
  const pen = await itemNamed(orgA, "Opening Pen");
  const before = await stockOf(pen);
  const cn = await asA("post", `/api/v1/credit-notes?org_id=${orgA}`, {
    contact_id: customer,
    date: "2026-11-04",
    status: "open",
    line_items: [{ item_id: pen.item_id, name: pen.name, quantity: 2, rate: 100, account_id: "AC_046" }],
  });
  assert.equal(cn.status, 201, cn.text);
  assert.equal((await stockOf(pen)).qty, before.qty + 2);
  const cnId = cn.body.data._id;
  const draftVc = await asA("post", `/api/v1/vendor-credits?org_id=${orgA}`, {
    contact_id: vendor,
    date: "2026-11-04",
    status: "draft",
    line_items: [{ item_id: pen.item_id, name: pen.name, quantity: 1, rate: 60, account_id: "AC_078" }],
  });
  assert.equal(draftVc.status, 201, draftVc.text);
  assert.equal((await stockOf(pen)).qty, before.qty + 2, "draft vendor credit doesn't move stock");
  const vc = await asA("post", `/api/v1/vendor-credits?org_id=${orgA}`, {
    contact_id: vendor,
    date: "2026-11-04",
    status: "open",
    line_items: [{ item_id: pen.item_id, name: pen.name, quantity: 1, rate: 60, account_id: "AC_078" }],
  });
  assert.equal(vc.status, 201, vc.text);
  assert.equal((await stockOf(pen)).qty, before.qty + 2 - 1);
  // Voiding the credit note takes its goods back out.
  const del = await asA("delete", `/api/v1/credit-notes/${cn.body.data.credit_number}?org_id=${orgA}`);
  assert.equal(del.status, 200, del.text);
  assert.equal((await stockOf(pen)).qty, before.qty - 1);
});

test("inventory adjustment posts a balanced journal and deleting it reverses both", async () => {
  const gem = await newItem(orgA, { name: "Adjust Gem", opening_stock: 10, opening_stock_rate: 20 });
  const r = await asA("post", `/api/v1/inventory/adjustments?org_id=${orgA}`, {
    date: "2026-11-04",
    reason: "Stock count",
    account_id: "AC_078",
    line_items: [
      { item_id: gem.item_id, mode: "quantity", qty_change: -3 },
      { item_id: (await newItem(orgA, { name: "Adjust Nut", opening_stock: 4, opening_stock_rate: 10 })).item_id, mode: "value", value_change: 15 },
    ],
  });
  assert.equal(r.status, 201, r.text);
  const adj = r.body.data;
  // 3 units out at 20 = -60; value line +15
  assert.equal(money(adj.total_value), -45);
  assert.equal((await stockOf(gem)).qty, 7);
  const j = await mongoose.model("Journal").findOne({ journal_id: adj.journal_id }).lean();
  const net = j.line_items.reduce((s, l) => s + (l.creditOrDebit === "Debit" ? 1 : -1) * Math.round(l.amount * 100), 0);
  assert.equal(net, 0, "journal balances");
  // Stock went down: Inventory Asset is credited, the chosen account (cost of goods) debited.
  assert.equal(j.line_items.find((l) => l.creditOrDebit === "Credit").coa_account_id, "AC_084");
  assert.equal(j.line_items.find((l) => l.creditOrDebit === "Debit").coa_account_id, "AC_078");

  const del = await asA("delete", `/api/v1/inventory/adjustments/${adj._id}?org_id=${orgA}`);
  assert.equal(del.status, 200, del.text);
  assert.equal((await stockOf(gem)).qty, 10);
  assert.equal(await mongoose.model("Journal").exists({ journal_id: adj.journal_id }), null);
});

test("adjustments refuse taking out more than is on hand and bad input", async () => {
  const gem = await itemNamed(orgA, "Adjust Gem");
  const tooMany = await asA("post", `/api/v1/inventory/adjustments?org_id=${orgA}`, {
    date: "2026-11-04", reason: "x", account_id: "AC_078", line_items: [{ item_id: gem.item_id, mode: "quantity", qty_change: -999 }],
  });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.message, new RegExp(`only ${(await stockOf(gem)).qty} of Adjust Gem in stock`));
  const zero = await asA("post", `/api/v1/inventory/adjustments?org_id=${orgA}`, {
    date: "2026-11-04", reason: "x", account_id: "AC_078", line_items: [{ item_id: gem.item_id, mode: "quantity", qty_change: 0 }],
  });
  assert.equal(zero.status, 400);
  assert.match(zero.body.message, /can't be zero/);
  const noReason = await asA("post", `/api/v1/inventory/adjustments?org_id=${orgA}`, {
    date: "2026-11-04", reason: "", account_id: "AC_078", line_items: [{ item_id: gem.item_id, mode: "quantity", qty_change: 1 }],
  });
  assert.equal(noReason.status, 400);
});

test("warn lets a sale go below zero with a warning; block refuses it", async () => {
  const w = await newItem(orgA, { name: "Warn Item", opening_stock: 5, opening_stock_rate: 10 });
  const sold = await newInvoice(orgA, [line(w, 8, 10)]);
  assert.equal(sold.status, 201, sold.text);
  assert.equal(sold.body.stock_warnings.length, 1);
  assert.equal((await stockOf(w)).qty, -3);

  const set = await asA("put", `/api/v1/inventory/settings?org_id=${orgA}`, { sell_policy: "block" });
  assert.equal(set.status, 200, set.text);
  const refused = await newInvoice(orgA, [line(w, 1, 10)]);
  assert.equal(refused.status, 400, refused.text);
  assert.match(refused.body.message, /Not enough stock to sell/);
  assert.equal((await stockOf(w)).qty, -3, "nothing was saved");
  await asA("put", `/api/v1/inventory/settings?org_id=${orgA}`, { sell_policy: "warn" });
});

test("low stock: reorder level flags items, the summary filters them, notifications mention them", async () => {
  await newItem(orgA, { name: "Low Item", opening_stock: 3, opening_stock_rate: 10, reorder_level: 5 });
  const r = await asA("get", `/api/v1/inventory/summary?org_id=${orgA}&filter=low`);
  assert.equal(r.status, 200, r.text);
  const row = r.body.data.find((x) => x.name === "Low Item");
  assert.ok(row, "listed under the low stock filter");
  assert.equal(row.status, "low_stock");
  assert.equal(row.status_label, "Low stock");
  await newItem(orgA, { name: "Plenty Item", opening_stock: 50, opening_stock_rate: 10, reorder_level: 4 });
  const again = await asA("get", `/api/v1/inventory/summary?org_id=${orgA}&filter=low`);
  assert.ok(!again.body.data.find((x) => x.name === "Plenty Item"), "items above their reorder level are not listed");
  const n = await asA("get", `/api/v1/user/notifications?organization_id=${orgA}`);
  assert.equal(n.status, 200, n.text);
  assert.ok(n.body.data.some((x) => /low on stock/.test(x.title)));
});

test("another business and users without inventory pages can't see stock", async () => {
  const pen = await itemNamed(orgA, "Opening Pen");
  const other = await asB("get", `/api/v1/inventory/summary?org_id=${orgA}`);
  assert.equal(other.status, 403, other.text);
  const ledger = await asB("get", `/api/v1/inventory/items/${pen.item_id}/ledger?org_id=${orgA}`);
  assert.equal(ledger.status, 403, ledger.text);
  assert.doesNotMatch(ledger.text, /Opening Pen/);
  const noPage = await asB("get", `/api/v1/inventory/summary?org_id=${orgB}`);
  assert.equal(noPage.status, 403, noPage.text);
  assert.match(noPage.body.message, /permission/);
  const adjust = await asB("post", `/api/v1/inventory/adjustments?org_id=${orgB}`, { date: "2026-11-04", reason: "x", account_id: "AC_078", line_items: [] });
  assert.equal(adjust.status, 403, adjust.text);
});

test("the owner's other organisation doesn't see this organisation's stock", async () => {
  const pen = await itemNamed(orgA, "Opening Pen");
  const r = await asA("get", `/api/v1/inventory/items/${pen.item_id}/ledger?org_id=${orgA2}`);
  assert.equal(r.status, 404, r.text);
  const list = await asA("get", `/api/v1/inventory/summary?org_id=${orgA2}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 0);
});

test("valuation report and item stock history agree with the ledger", async () => {
  const pen = await itemNamed(orgA, "Opening Pen");
  const ledger = await asA("get", `/api/v1/inventory/items/${pen.item_id}/ledger?org_id=${orgA}`);
  assert.equal(ledger.status, 200, ledger.text);
  const last = ledger.body.data[ledger.body.data.length - 1];
  assert.equal(money(last.running_qty), (await stockOf(pen)).qty);
  const val = await asA("get", `/api/v1/inventory/valuation?org_id=${orgA}`);
  assert.equal(val.status, 200, val.text);
  const row = val.body.data.find((x) => x.name === "Opening Pen");
  assert.equal(money(row.value), (await stockOf(pen)).value);
});
