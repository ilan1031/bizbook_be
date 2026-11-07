// Batch and serial tracking: lots are registered against stock on hand,
// issued, expire, and cannot outgrow the stock.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_stocklots$2");
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
let token;
let org;
let paint;
let phone;
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const newItem = async (name, opening) => {
  const r = await call("post", "/api/v1/items/newitems", { organization_id: org, item_type: "goods", can_be_sold: true, can_be_purchased: true, track_inventory: true, valuation_method: "average", name, item_name: name, purchase_rate: 10, opening_stock: opening, opening_stock_rate: 10 });
  assert.ok(r.status < 300, r.text);
  return mongoose.model("Item").findOne({ organization_id: org, name }).lean();
};
const track = (item, tracking) => call("patch", `/api/v1/inventory/batches/tracking/${item._id}`, { org_id: org, tracking });
const batch = (extra) => call("post", "/api/v1/inventory/batches", { org_id: org, item_ref: paint._id, number: "B1", qty: 10, ...extra });

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Lots Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  paint = await newItem("Paint", 50);
  phone = await newItem("Phone", 5);
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("lots need the item switched to tracking first", async () => {
  assert.equal((await batch()).status, 400);
  assert.equal((await track(paint, "weird")).status, 400);
  assert.equal((await track(paint, "batch")).status, 200);
});

test("a batch is registered with its expiry and counted against stock", async () => {
  const r = await batch({ number: "B1", qty: 30, expiry_date: "2099-01-01" });
  assert.equal(r.status, 201, r.text);
  const l = await call("get", `/api/v1/inventory/batches/lookups?org_id=${org}`);
  const row = l.body.data.find((x) => String(x._id) === String(paint._id));
  assert.equal(row.registered, 30);
  assert.equal(row.unassigned, 20);
});

test("a batch cannot exceed unassigned stock, repeat a number or have bad dates", async () => {
  const over = await batch({ number: "B2", qty: 21 });
  assert.equal(over.status, 400);
  assert.match(over.body.message, /Only 20/);
  assert.equal((await batch({ number: "B1", qty: 1 })).status, 400);
  assert.equal((await batch({ number: "B3", qty: 0 })).status, 400);
  assert.equal((await batch({ number: "B3", qty: 1, expiry_date: "2026-02-30" })).status, 400);
  assert.equal((await batch({ number: "B3", qty: 1, mfg_date: "2026-05-01", expiry_date: "2026-01-01" })).status, 400);
});

test("issuing reduces a batch and stops at what is left", async () => {
  const list = await call("get", `/api/v1/inventory/batches?org_id=${org}`);
  const b1 = list.body.data.find((x) => x.number === "B1");
  const a = await call("post", `/api/v1/inventory/batches/${b1._id}/issue`, { org_id: org, qty: 12, reference: "INV-1" });
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.data.qty, 18);
  assert.equal((await call("post", `/api/v1/inventory/batches/${b1._id}/issue`, { org_id: org, qty: 19 })).status, 400);
  assert.equal((await call("delete", `/api/v1/inventory/batches/${b1._id}?org_id=${org}`)).status, 400);
  // Book stock is untouched: documents move it, not the register.
  assert.equal((await mongoose.model("Item").findById(paint._id).lean()).stock_qty, 50);
});

test("expiring and expired batches can be listed", async () => {
  await batch({ number: "OLD", qty: 5, expiry_date: "2020-01-01" });
  const soon = await call("get", `/api/v1/inventory/batches?org_id=${org}&expiring=30`);
  const old = soon.body.data.find((x) => x.number === "OLD");
  assert.ok(old && old.expired === true && old.days_to_expiry < 0);
  assert.ok(!soon.body.data.some((x) => x.number === "B1"));
});

test("tracking cannot change once lots exist", async () => {
  const r = await track(paint, "serial");
  assert.equal(r.status, 400);
});

test("serial numbers are one unit each, unique, and used once", async () => {
  assert.equal((await track(phone, "serial")).status, 200);
  const r = await call("post", "/api/v1/inventory/batches", { org_id: org, item_ref: phone._id, numbers: "SN1, SN2\nSN3" });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.length, 3);
  assert.equal((await call("post", "/api/v1/inventory/batches", { org_id: org, item_ref: phone._id, numbers: ["SN3"] })).status, 400);
  assert.equal((await call("post", "/api/v1/inventory/batches", { org_id: org, item_ref: phone._id, numbers: ["A", "a"] })).status, 400);
  assert.equal((await call("post", "/api/v1/inventory/batches", { org_id: org, item_ref: phone._id, numbers: ["X1", "X2", "X3"] })).status, 400); // only 2 left
  const sn1 = r.body.data.find((x) => x.number === "SN1");
  assert.equal((await call("post", `/api/v1/inventory/batches/${sn1._id}/issue`, { org_id: org, reference: "INV-9" })).status, 200);
  const again = await call("post", `/api/v1/inventory/batches/${sn1._id}/issue`, { org_id: org });
  assert.equal(again.status, 400);
  assert.match(again.body.message, /already been used/);
  const used = await call("get", `/api/v1/inventory/batches?org_id=${org}&status=used`);
  assert.deepEqual(used.body.data.map((x) => x.number), ["SN1"]);
});

test("another organisation cannot touch these lots", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Lots Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  const list = await call("get", `/api/v1/inventory/batches?org_id=${other}`);
  assert.equal(list.body.data.length, 0);
  const mine = (await call("get", `/api/v1/inventory/batches?org_id=${org}`)).body.data[0];
  assert.equal((await call("post", `/api/v1/inventory/batches/${mine._id}/issue`, { org_id: other, qty: 1 })).status, 404);
  assert.equal((await call("post", "/api/v1/inventory/batches", { org_id: other, item_ref: paint._id, number: "Z", qty: 1 })).status, 404);
});
