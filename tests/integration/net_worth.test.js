// Net worth and allocation: company from the books plus the register, personal
// from holdings and hand-entered assets and loans.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_networth$2");
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
let bank;
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const day = (offset) => dayjs().add(offset, "day").format("YYYY-MM-DD");
const nw = (scope, qs = "") => call("get", `/api/v1/wealth/${scope}/net-worth?org_id=${org}${qs}`);
const slice = (data, key) => data.allocation.find((s) => s.key === key);

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Net Worth Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  const lk = await call("get", `/api/v1/wealth/company/lookups?org_id=${org}`);
  bank = lk.body.data.pay_accounts[0];
  // Money in the bank: an opening-balance style manual entry through a journal.
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: org }).lean();
  const equity = coa.chart_of_accounts.find((a) => a.account_id === "AC_043");
  const line = (a, side) => ({ coa_account_id: a.account_id, coa_account_name: a.account_name, creditOrDebit: side, amount: 500000 });
  await mongoose.model("Journal").create({
    organization_id: org, admin_id: (await mongoose.model("user").findOne({ role: "superadmin" }).lean())._id, journal_id: "JL-NW-1", journal_date: new Date(day(-60)), type: "Opening", total_amount: 500000,
    line_items: [line(bank, "Debit"), line(equity, "Credit")], posting_status: "posted",
  });
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("company net worth starts from the books", async () => {
  const r = await nw("company");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.net_worth, 500000);
  assert.equal(slice(r.body.data, "cash").value, 500000);
  assert.equal(slice(r.body.data, "cash").percent, 100);
});

test("a registered holding moves cash into investments at cost, then at current value", async () => {
  const add = await call("post", "/api/v1/wealth/company/investments", { org_id: org, name: "Nifty Fund", kind: "mutual_fund", purchase_date: day(-40), cost: 100000, pay_account_id: bank.account_id });
  assert.equal(add.status, 201, add.text);
  let r = (await nw("company")).body.data;
  assert.equal(r.net_worth, 500000);
  assert.equal(slice(r, "cash").value, 400000);
  assert.equal(slice(r, "mutual_fund").value, 100000);
  assert.equal(r.unrealised_gain, 0);
  assert.equal(r.register_matches_books, true);

  await call("post", `/api/v1/wealth/company/investments/${add.body.data._id}/valuations`, { org_id: org, date: day(-5), value: 120000 });
  r = (await nw("company")).body.data;
  assert.equal(r.net_worth, 520000);
  assert.equal(r.net_worth_in_books, 500000);
  assert.equal(r.unrealised_gain, 20000);
  assert.equal(slice(r, "mutual_fund").value, 120000);
});

test("an earlier date shows what was held then", async () => {
  const before = (await nw("company", `&as_of=${day(-50)}`)).body.data;
  assert.equal(slice(before, "cash").value, 500000);
  assert.equal(slice(before, "mutual_fund"), undefined);
  const mid = (await nw("company", `&as_of=${day(-20)}`)).body.data;
  assert.equal(slice(mid, "mutual_fund").value, 100000); // not yet revalued
  assert.equal((await nw("company", "&as_of=2026-02-30")).status, 400);
});

test("selling removes the holding from net worth and books the proceeds", async () => {
  const list = await call("get", `/api/v1/wealth/company/investments?org_id=${org}`);
  const fund = list.body.data[0];
  await call("post", `/api/v1/wealth/company/investments/${fund._id}/close`, { org_id: org, date: day(-1), proceeds: 125000, deposit_account_id: bank.account_id });
  const r = (await nw("company")).body.data;
  assert.equal(slice(r, "mutual_fund"), undefined);
  assert.equal(r.net_worth, 525000);
  assert.equal(slice(r, "cash").value, 525000);
  // As of before the sale it was still held.
  assert.equal(slice((await nw("company", `&as_of=${day(-3)}`)).body.data, "mutual_fund").value, 120000);
});

test("personal net worth adds holdings and assets, and takes off loans", async () => {
  assert.equal((await nw("personal")).body.data.net_worth, 0);
  await call("post", "/api/v1/wealth/personal/investments", { org_id: org, name: "My PPF", kind: "bonds", purchase_date: day(-100), cost: 200000 });
  const home = await call("post", "/api/v1/wealth/personal/entries", { org_id: org, type: "asset", category: "home", name: "Flat", amount: 5000000 });
  assert.equal(home.status, 201, home.text);
  await call("post", "/api/v1/wealth/personal/entries", { org_id: org, type: "liability", category: "home_loan", name: "SBI home loan", amount: 3000000 });
  const r = (await nw("personal")).body.data;
  assert.equal(r.total_assets, 5200000);
  assert.equal(r.total_liabilities, 3000000);
  assert.equal(r.net_worth, 2200000);
  assert.equal(slice(r, "asset_home").percent, 96.2);
  assert.equal(r.liabilities[0].label, "Home loan");
  // Personal figures never reach the company books.
  assert.equal((await nw("company")).body.data.net_worth, 525000);
});

test("entries are validated and kept to their owner", async () => {
  const post = (b) => call("post", "/api/v1/wealth/personal/entries", { org_id: org, type: "asset", category: "home", name: "X", amount: 1, ...b });
  assert.equal((await post({ type: "other" })).status, 400);
  assert.equal((await post({ name: "" })).status, 400);
  assert.equal((await post({ amount: -1 })).status, 400);
  assert.equal((await post({ category: "home_loan" })).status, 400);
  assert.equal((await post({ type: "liability", category: "home" })).status, 400);
  assert.equal((await post({ as_on: day(5) })).status, 400);
  assert.equal((await call("post", "/api/v1/wealth/company/entries", { org_id: org, type: "asset", name: "X", amount: 1 })).status, 404);
  const list = await call("get", `/api/v1/wealth/personal/entries?org_id=${org}`);
  const flat = list.body.data.find((e) => e.name === "Flat");
  const upd = await call("patch", `/api/v1/wealth/personal/entries/${flat._id}`, { org_id: org, amount: 5500000 });
  assert.equal(upd.body.data.amount, 5500000);
  assert.equal((await nw("personal")).body.data.net_worth, 2700000);
  assert.equal((await call("delete", `/api/v1/wealth/personal/entries/${flat._id}?org_id=${org}`)).status, 200);
  assert.equal((await call("delete", `/api/v1/wealth/personal/entries/${flat._id}?org_id=${org}`)).status, 404);
});

test("another organisation sees none of it", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Net Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  const r = await call("get", `/api/v1/wealth/personal/net-worth?org_id=${other}`);
  assert.equal(r.body.data.net_worth, 0);
  assert.equal((await call("get", `/api/v1/wealth/personal/entries?org_id=${other}`)).body.data.length, 0);
});
