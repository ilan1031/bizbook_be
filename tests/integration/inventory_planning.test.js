// Inventory planning: reorder levels and the list of what to buy, and landed
// cost (freight and duty added to the value of the stock a bill brought in).
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_invplanning$2");
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
const dayjs = require("dayjs");

const realLog = console.log;
console.log = () => {};

let app;
let token;
let org;
let vendor;
let adminId;
const IP = "10.0.0.1";
const call = (method, url, body, tok = token, ip = IP) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const itemNamed = (name) => mongoose.model("Item").findOne({ organization_id: String(org), name }).lean();
const stockOf = async (item) => {
  const it = await mongoose.model("Item").findById(item._id).lean();
  return { qty: money(it.stock_qty), value: money(it.stock_value), avg: money(it.avg_cost) };
};
const newItem = async (body) => {
  const r = await call("post", "/api/v1/items/newitems", { organization_id: org, item_type: "goods", can_be_sold: true, can_be_purchased: true, track_inventory: true, valuation_method: "average", ...body, name: body.name, item_name: body.name });
  assert.ok(r.status < 300, r.text);
  return itemNamed(body.name);
};
const lineOf = (item, quantity, rate) => ({ item_id: item.item_id, name: item.name, quantity, rate, gst_rate: 0 });
const newBill = (lines, billDate = "2026-11-01") =>
  call("post", `/api/v1/bills/create-bills?org_id=${org}`, { status: 0, vendor_id: vendor, vendorName: "Steel Supplies", billDate, dueDate: "2026-12-01", items: lines.map((l) => ({ ...l, item_name: l.name, amount: l.quantity * l.rate })) });
let bolts;
let nuts;
let bill;
let accounts;

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
  const res = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", IP).send({ email: "superadmin@test.local", password: "Super@1234" });
  token = res.body.token;
  assert.ok(token, JSON.stringify(res.body));
  adminId = (await mongoose.model("user").findOne({ role: "superadmin" }).lean())._id;
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Planning Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  const v = await call("post", "/api/v1/contact", { organization_id: org, contact_type: "Vendor", contact_name: "Steel Supplies", company_name: "Steel Supplies", place_of_contact: "Tamil Nadu", contact_persons: [{ first_name: "Steel", email: "steel@inv.test", is_primary_contact: true }] });
  assert.ok(v.status < 300, v.text);
  // Bills name the vendor by its record id.
  vendor = String((await mongoose.model("Contact").findOne({ contact_id: v.body.data.contact_id }).lean())._id);
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: org }).lean();
  accounts = { payable: coa.chart_of_accounts.find((a) => a.account_type === "accounts_payable"), expense: coa.chart_of_accounts.find((a) => a.account_type === "expense"), inventory: coa.chart_of_accounts.find((a) => a.account_type === "stock") };
  assert.ok(accounts.payable && accounts.expense && accounts.inventory);
  bolts = await newItem({ name: "Bolts", purchase_rate: 10, reorder_level: 50 });
  nuts = await newItem({ name: "Nuts", purchase_rate: 5, reorder_level: 20 });
  await newItem({ name: "Washers", purchase_rate: 2 }); // no reorder level
  const made = await newBill([lineOf(bolts, 100, 10), lineOf(nuts, 100, 5)]); // Bolts 1,000 and Nuts 500 in stock
  assert.ok(made.status < 300, made.text);
  bill = made.body.data?.bill_number || (await mongoose.model("PO_bill").findOne({ organization_id: Number(org) }).lean()).bill_number;
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("reorder list: items at or below their level, with a suggested quantity and cost", async () => {
  const none = await call("get", `/api/v1/inventory/reorder?org_id=${org}&filter=needs`);
  assert.equal(none.status, 200, none.text);
  assert.equal(none.body.data.length, 0, "100 Bolts and 100 Nuts are above their levels");
  assert.equal(none.body.totals.needs_reorder, 0);

  // Stock falls: take 70 Bolts out (30 left, level 50) and 85 Nuts (15 left, level 20).
  for (const [item, qty] of [[bolts, -70], [nuts, -85]]) {
    const r = await call("post", "/api/v1/inventory/adjustments", { organization_id: org, date: "2026-11-02", reason: "Count", account_id: accounts.expense.account_id, line_items: [{ item_id: item.item_id, mode: "quantity", qty_change: qty }] });
    assert.equal(r.status, 201, r.text);
  }
  const r = await call("get", `/api/v1/inventory/reorder?org_id=${org}&filter=needs`);
  assert.deepEqual(r.body.data.map((x) => x.name), ["Bolts", "Nuts"]);
  const b = r.body.data[0];
  assert.equal(b.stock_qty, 30);
  assert.equal(b.suggested_qty, 70, "no reorder quantity set: top up to twice the level (100 - 30)");
  assert.equal(b.unit_cost, 10);
  assert.equal(b.estimated_cost, 700);
  assert.equal(r.body.totals.needs_reorder, 2);
  assert.equal(r.body.totals.estimated_cost, 700 + 25 * 5);

  const all = await call("get", `/api/v1/inventory/reorder?org_id=${org}`);
  assert.equal(all.body.data.length, 3);
  assert.equal(all.body.data.find((x) => x.name === "Washers").needs_reorder, false);
  assert.equal((await call("get", `/api/v1/inventory/reorder?org_id=${org}&search=nut`)).body.data.length, 1);
});

test("setting a reorder quantity changes the suggestion; bad values are refused", async () => {
  const set = await call("patch", `/api/v1/inventory/reorder/${bolts._id}`, { org_id: org, reorder_quantity: 200 });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.body.data.suggested_qty, 200);
  const lvl = await call("patch", `/api/v1/inventory/reorder/${bolts._id}`, { org_id: org, reorder_level: 25 });
  assert.equal(lvl.body.data.suggested_qty, 0, "30 on hand is above a level of 25");
  await call("patch", `/api/v1/inventory/reorder/${bolts._id}`, { org_id: org, reorder_level: 50 });
  for (const body of [{ reorder_level: -1 }, { reorder_quantity: "abc" }, { reorder_level: 1.23456 }, {}]) {
    assert.equal((await call("patch", `/api/v1/inventory/reorder/${bolts._id}`, { org_id: org, ...body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call("patch", "/api/v1/inventory/reorder/000000000000000000000000", { org_id: org, reorder_level: 5 })).status, 404);
});

const charges = [{ description: "Freight", amount: 90 }, { description: "Duty", amount: 60 }];
const landed = (patch = {}) => call("post", "/api/v1/inventory/landed-cost", { org_id: org, bill_number: bill, date: "2026-11-03", account_id: accounts.payable.account_id, allocation: "value", charges, ...patch });

test("landed cost: a preview shares the total over the bill's stock items", async () => {
  const lookups = await call("get", `/api/v1/inventory/landed-cost/lookups?org_id=${org}`);
  assert.ok(lookups.body.data.bills.some((b) => b.bill_number === bill));
  assert.ok(lookups.body.data.accounts.some((a) => a.account_id === accounts.payable.account_id));

  const byValue = await landed({ dry_run: true });
  assert.equal(byValue.status, 200, byValue.text);
  assert.equal(byValue.body.data.total, 150);
  const share = (r, name) => r.body.data.lines.find((l) => l.item_name === name).amount;
  assert.equal(share(byValue, "Bolts"), 100, "Bolts are 1,000 of the bill's 1,500");
  assert.equal(share(byValue, "Nuts"), 50);
  const byQty = await landed({ dry_run: true, allocation: "qty" });
  assert.equal(share(byQty, "Bolts"), 75, "equal quantities: half each");
  assert.equal(share(byQty, "Nuts"), 75);
  assert.equal((await mongoose.model("LandedCost").countDocuments({ organization_id: org })), 0, "a preview books nothing");
  // Shares always add up to the total, down to the paisa.
  const odd = await landed({ dry_run: true, charges: [{ description: "Odd", amount: 100.01 }], allocation: "qty" });
  const sum = odd.body.data.lines.reduce((t, l) => t + Math.round(l.amount * 100), 0);
  assert.equal(sum, 10001);
});

test("landed cost is checked, then raises the stock value and books the journal", async () => {
  for (const [patch, message] of [
    [{ charges: [] }, /at least one cost/],
    [{ charges: [{ amount: 0 }] }, /more than zero/],
    [{ charges: [{ amount: 1.234 }] }, /2 decimal/],
    [{ date: "2026-02-30" }, /valid date/],
    [{ bill_number: "NOPE" }, /your bills/],
    [{ account_id: accounts.expense.account_id }, /paid from or is owed to/],
  ]) {
    const r = await landed(patch);
    assert.equal(r.status === 404 ? 400 : r.status, 400, JSON.stringify(patch));
    assert.match(r.body.message, message);
  }

  const before = { bolts: await stockOf(bolts), nuts: await stockOf(nuts) };
  const ok = await landed();
  assert.equal(ok.status, 201, ok.text);
  assert.match(ok.body.data.landed_cost_number, /^LC-/);
  const after = { bolts: await stockOf(bolts), nuts: await stockOf(nuts) };
  assert.equal(after.bolts.qty, before.bolts.qty, "quantities don't move");
  assert.equal(after.bolts.value, money(before.bolts.value + 100), "Bolts take 100 of the cost");
  assert.equal(after.nuts.value, money(before.nuts.value + 50));
  assert.ok(after.bolts.avg > before.bolts.avg, "so each Bolt now costs more");

  const adjustment = await mongoose.model("Inventory_adjustment").findById(ok.body.data.adjustment_id).lean();
  assert.equal(adjustment.total_value, 150);
  const journal = await mongoose.model("Journal").findOne({ journal_id: adjustment.journal_id }).lean();
  const side = (s, id) => journal.line_items.filter((l) => l.creditOrDebit === s && l.coa_account_id === id).reduce((t, l) => t + l.amount, 0);
  assert.equal(side("Debit", accounts.inventory.account_id), 150, "Dr Inventory Asset");
  assert.equal(side("Credit", accounts.payable.account_id), 150, "Cr the account the cost is owed to");

  const list = await call("get", `/api/v1/inventory/landed-cost?org_id=${org}`);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].total, 150);

  // Removing it takes the cost back out.
  const del = await call("delete", `/api/v1/inventory/landed-cost/${ok.body.data._id}?org_id=${org}`);
  assert.equal(del.status, 200, del.text);
  assert.deepEqual(await stockOf(bolts), before.bolts);
  assert.equal(await mongoose.model("Journal").exists({ journal_id: adjustment.journal_id }), null, "its journal is gone too");
  assert.equal((await call("get", `/api/v1/inventory/landed-cost?org_id=${org}`)).body.data.length, 0);
});

test("an item with no stock left can't take landed cost, and says so", async () => {
  const gone = await newItem({ name: "Sold out", purchase_rate: 4 });
  const b = await newBill([lineOf(gone, 10, 4)], "2026-11-04");
  assert.ok(b.status < 300, b.text);
  const number = (await mongoose.model("PO_bill").find({ organization_id: Number(org) }).sort({ createdAt: -1 }).limit(1).lean())[0].bill_number;
  await call("post", "/api/v1/inventory/adjustments", { organization_id: org, date: "2026-11-05", reason: "Lost", account_id: accounts.expense.account_id, line_items: [{ item_id: gone.item_id, mode: "quantity", qty_change: -10 }] });
  const r = await landed({ bill_number: number });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /Sold out has no stock left/);
  assert.equal(await mongoose.model("LandedCost").countDocuments({ organization_id: org }), 0, "nothing was booked");
});

test("the period lock covers landed cost and adjustments", async () => {
  await call("put", "/api/v1/period-lock", { org_id: org, locked_until: dayjs().format("YYYY-MM-DD") });
  const r = await landed({ date: "2026-11-03" });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "PERIOD_LOCKED");
  const adj = await call("post", "/api/v1/inventory/adjustments", { organization_id: org, date: "2026-11-03", reason: "x", account_id: accounts.expense.account_id, line_items: [{ item_id: bolts.item_id, mode: "quantity", qty_change: 1 }] });
  assert.equal(adj.status, 403);
  await call("put", "/api/v1/period-lock", { org_id: org, locked_until: null });
});

test("reorder planning and landed cost have their own permissions", async () => {
  const U = mongoose.model("user");
  const bcrypt = require("bcryptjs");
  const user = await U.create({
    email: "buyer@test.local", password: await bcrypt.hash("User@1234", 10), mobile: "9876500007", company_name: "Buyer Co", role: "user", status: "active",
    agreement_status: true, permissions: { reorderPlanning: ["view"], landedCost: ["view"] }, ip_limit: 5,
  });
  const login = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", "10.7.0.1").send({ email: "buyer@test.local", password: "User@1234" });
  const t = login.body.token;
  assert.ok(t, JSON.stringify(login.body));
  const mine = await call("post", "/api/v1/org/create-organisation", { organizationName: "Buyer Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" }, t, "10.7.0.1");
  const own = mine.body.data?.organization_id;
  assert.ok(own, mine.text);
  const as = (m, u, b) => call(m, u, b, t, "10.7.0.1");
  assert.equal((await as("get", `/api/v1/inventory/reorder?org_id=${own}`)).status, 200, "view");
  assert.equal((await as("patch", "/api/v1/inventory/reorder/000000000000000000000000", { org_id: own, reorder_level: 1 })).status, 403, "changing a level needs edit");
  assert.equal((await as("get", `/api/v1/inventory/landed-cost?org_id=${own}`)).status, 200);
  assert.equal((await as("post", "/api/v1/inventory/landed-cost", { org_id: own })).status, 403, "booking needs create");
  assert.equal((await as("delete", `/api/v1/inventory/landed-cost/000000000000000000000000?org_id=${own}`)).status, 403, "removing needs delete");
  assert.equal((await as("get", `/api/v1/inventory/reorder?org_id=${org}`)).status, 403, "never another business's stock");
  await U.deleteOne({ _id: user._id });
});
