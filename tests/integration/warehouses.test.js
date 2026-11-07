// Warehouses and stock transfers: stock starts in the default warehouse and
// moves between warehouses without touching the books.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_warehouses$2");
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
let widget;
let main;
let shop;
let yard;
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const heldIn = async (warehouse, item) => {
  const r = await call("get", `/api/v1/inventory/warehouses/${warehouse}/stock?org_id=${org}`);
  assert.equal(r.status, 200, r.text);
  return r.body.data.find((x) => String(x._id) === String(item._id))?.qty || 0;
};
const move = (from, to, qty, extra = {}) =>
  call("post", "/api/v1/inventory/transfers", { org_id: org, date: "2026-11-02", from_warehouse_id: from, to_warehouse_id: to, lines: [{ item_ref: widget._id, qty }], ...extra });

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Warehouse Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  const r = await call("post", "/api/v1/items/newitems", { organization_id: org, item_type: "goods", can_be_sold: true, can_be_purchased: true, track_inventory: true, valuation_method: "average", name: "Widget", item_name: "Widget", purchase_rate: 10, opening_stock: 100, opening_stock_rate: 10 });
  assert.ok(r.status < 300, r.text);
  widget = await mongoose.model("Item").findOne({ organization_id: org, name: "Widget" }).lean();
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("a default warehouse exists and holds all the stock", async () => {
  const r = await call("get", `/api/v1/inventory/warehouses?org_id=${org}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.length, 1);
  main = r.body.data[0]._id;
  assert.equal(r.body.data[0].is_default, true);
  assert.equal(r.body.data[0].units, 100);
});

test("warehouses can be added, renamed and not duplicated", async () => {
  const a = await call("post", "/api/v1/inventory/warehouses", { org_id: org, name: "Shop Floor", code: "SHOP" });
  assert.equal(a.status, 201, a.text);
  shop = a.body.data._id;
  const b = await call("post", "/api/v1/inventory/warehouses", { org_id: org, name: "Yard" });
  yard = b.body.data._id;
  assert.equal((await call("post", "/api/v1/inventory/warehouses", { org_id: org, name: "shop floor" })).status, 400);
  assert.equal((await call("post", "/api/v1/inventory/warehouses", { org_id: org, name: "  " })).status, 400);
  const u = await call("patch", `/api/v1/inventory/warehouses/${yard}`, { org_id: org, name: "Back Yard" });
  assert.equal(u.body.data.name, "Back Yard");
});

test("a transfer moves quantity and leaves stock value and journals alone", async () => {
  const journals = await mongoose.model("Journal").countDocuments({ organization_id: org });
  const t = await move(main, shop, 30);
  assert.equal(t.status, 201, t.text);
  assert.equal(await heldIn(shop, widget), 30);
  assert.equal(await heldIn(main, widget), 70);
  const it = await mongoose.model("Item").findById(widget._id).lean();
  assert.equal(it.stock_qty, 100);
  assert.equal(await mongoose.model("Journal").countDocuments({ organization_id: org }), journals);
});

test("a warehouse cannot send more than it holds", async () => {
  const r = await move(shop, yard, 31);
  assert.equal(r.status, 400);
  assert.match(r.body.message, /only 30/);
  assert.equal((await move(main, main, 1)).status, 400);
  assert.equal((await move(main, shop, 0)).status, 400);
  assert.equal((await move(main, shop, 1, { date: "2026-02-30" })).status, 400);
  assert.equal((await move(main, shop, 1, { lines: [] })).status, 400);
});

test("stock can move between two non-default warehouses and back", async () => {
  assert.equal((await move(shop, yard, 10)).status, 201);
  assert.equal(await heldIn(shop, widget), 20);
  assert.equal(await heldIn(yard, widget), 10);
  assert.equal((await move(yard, main, 4)).status, 201);
  assert.equal(await heldIn(main, widget), 74);
  assert.equal(await heldIn(yard, widget), 6);
});

test("lookups show what each warehouse holds", async () => {
  const r = await call("get", `/api/v1/inventory/transfers/lookups?org_id=${org}`);
  assert.equal(r.status, 200, r.text);
  const row = r.body.data.items.find((i) => String(i._id) === String(widget._id));
  assert.equal(row.held[String(shop)], 20);
  assert.equal(row.held[String(main)], 74);
});

test("a transfer is not removed when its stock has moved on", async () => {
  const list = await call("get", `/api/v1/inventory/transfers?org_id=${org}`);
  const first = list.body.data.find((t) => t.lines[0].qty === 30);
  const r = await call("delete", `/api/v1/inventory/transfers/${first._id}?org_id=${org}`);
  assert.equal(r.status, 400);
  assert.match(r.body.message, /already moved on/);
});

test("removing a later transfer restores the earlier warehouse", async () => {
  const list = await call("get", `/api/v1/inventory/transfers?org_id=${org}`);
  const last = list.body.data.find((t) => t.lines[0].qty === 4);
  assert.equal((await call("delete", `/api/v1/inventory/transfers/${last._id}?org_id=${org}`)).status, 200);
  assert.equal(await heldIn(yard, widget), 10);
  assert.equal(await heldIn(main, widget), 70);
});

test("a warehouse with transfers is switched off, not removed; the default stays", async () => {
  assert.equal((await call("delete", `/api/v1/inventory/warehouses/${shop}?org_id=${org}`)).status, 400);
  assert.equal((await call("delete", `/api/v1/inventory/warehouses/${main}?org_id=${org}`)).status, 400);
  assert.equal((await call("patch", `/api/v1/inventory/warehouses/${main}`, { org_id: org, active: false })).status, 400);
  assert.equal((await call("patch", `/api/v1/inventory/warehouses/${shop}`, { org_id: org, active: false })).status, 200);
  assert.equal((await move(main, shop, 1)).status, 400);
  const fresh = await call("post", "/api/v1/inventory/warehouses", { org_id: org, name: "Spare" });
  assert.equal((await call("delete", `/api/v1/inventory/warehouses/${fresh.body.data._id}?org_id=${org}`)).status, 200);
});

test("another organisation cannot see or use these warehouses", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  const r = await call("get", `/api/v1/inventory/warehouses/${shop}/stock?org_id=${other}`);
  assert.equal(r.status, 404);
  const t = await call("post", "/api/v1/inventory/transfers", { org_id: other, date: "2026-11-02", from_warehouse_id: main, to_warehouse_id: shop, lines: [{ item_ref: widget._id, qty: 1 }] });
  assert.equal(t.status, 404);
});
