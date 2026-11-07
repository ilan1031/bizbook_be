// Exchange rates: the rate book and the converter.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_fxrates$2");
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
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const day = (offset) => dayjs().add(offset, "day").format("YYYY-MM-DD");
const rate = (currency_code, date, r) => call("post", "/api/v1/currencies/rates", { org_id: org, currency_code, date, rate: r });
const convert = (qs) => call("get", `/api/v1/currencies/convert?org_id=${org}&${qs}`);

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "FX Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  await mongoose.model("Organization").updateOne({ organization_id: Number(org) }, { $set: { currency_code: "INR" } });
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("a rate is saved, and saving the same day again updates it", async () => {
  const a = await rate("usd", day(-10), 82);
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.data.currency_code, "USD");
  const b = await rate("USD", day(-10), 83.5);
  assert.equal(b.body.data.rate, 83.5);
  const list = await call("get", `/api/v1/currencies/rates?org_id=${org}`);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.base_currency, "INR");
});

test("bad rates are refused", async () => {
  assert.equal((await rate("USD", day(-1), 0)).status, 400);
  assert.equal((await rate("USD", day(-1), -3)).status, 400);
  assert.equal((await rate("USD", day(-1), 1.1234567)).status, 400);
  assert.equal((await rate("US", day(-1), 80)).status, 400);
  assert.equal((await rate("INR", day(-1), 1)).status, 400);
  assert.equal((await rate("USD", "2026-02-30", 80)).status, 400);
  assert.equal((await rate("USD", day(5), 80)).status, 400);
});

test("conversion uses the latest rate on or before the date", async () => {
  await rate("USD", day(-3), 85);
  await rate("EUR", day(-3), 90);
  const old = await convert(`from=USD&to=INR&amount=100&date=${day(-5)}`);
  assert.equal(old.body.data.result, 8350);
  const now = await convert("from=USD&to=INR&amount=100");
  assert.equal(now.body.data.result, 8500);
  assert.equal(now.body.data.rate, 85);
});

test("foreign to foreign goes through the base currency", async () => {
  const r = await convert("from=EUR&to=USD&amount=100");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.rate, 1.058824);
  assert.equal(r.body.data.result, 105.88);
  assert.equal((await convert("from=INR&to=INR&amount=50")).body.data.result, 50);
});

test("a missing rate is a clear 404", async () => {
  const r = await convert("from=GBP&to=INR&amount=10");
  assert.equal(r.status, 404);
  assert.match(r.body.message, /No GBP rate/);
  const early = await convert(`from=USD&to=INR&amount=10&date=${day(-60)}`);
  assert.equal(early.status, 404);
  assert.equal((await convert("from=USD&to=INR&amount=abc")).status, 400);
});

test("the summary shows each currency's latest rate and rates can be removed", async () => {
  const s = await call("get", `/api/v1/currencies/summary?org_id=${org}`);
  const usd = s.body.data.find((x) => x.currency_code === "USD");
  assert.equal(usd.rate, 85);
  assert.equal(usd.rates_recorded, 2);
  const list = await call("get", `/api/v1/currencies/rates?org_id=${org}&currency=USD`);
  assert.equal(list.body.data.length, 2);
  const del = await call("delete", `/api/v1/currencies/rates/${list.body.data[0]._id}?org_id=${org}`);
  assert.equal(del.status, 200);
  assert.equal((await call("delete", `/api/v1/currencies/rates/${list.body.data[0]._id}?org_id=${org}`)).status, 404);
});

test("another organisation does not see these rates", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other FX Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  const list = await call("get", `/api/v1/currencies/rates?org_id=${other}`);
  assert.equal(list.body.data.length, 0);
  const r = await call("get", `/api/v1/currencies/convert?org_id=${other}&from=USD&to=INR&amount=1`);
  assert.equal(r.status, 404);
});
