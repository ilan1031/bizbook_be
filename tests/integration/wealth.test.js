// Wealth: the investment register. Company holdings post to the books at
// cost; personal holdings never do; the two are granted separately.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_wealth$2");
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
const rbac = require("../../helpers/rbac");

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
const add = (scope, extra) => call("post", `/api/v1/wealth/${scope}/investments`, { org_id: org, name: "HDFC FD", kind: "fixed_deposit", purchase_date: day(-30), cost: 100000, pay_account_id: bank?.account_id, ...extra });
const journalsFor = (journal_id) => mongoose.model("Journal").findOne({ journal_id }).lean();

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Wealth Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  const lk = await call("get", `/api/v1/wealth/company/lookups?org_id=${org}`);
  bank = lk.body.data.pay_accounts[0];
  assert.ok(bank, JSON.stringify(lk.body));
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("company and personal wealth are separate permission pages", () => {
  const keys = rbac.CATALOG.map((p) => p.key);
  assert.ok(keys.includes("investments") && keys.includes("personalWealth"));
  assert.deepEqual(rbac.classifyRequest("GET", "/api/v1/wealth/company/investments"), { page: "investments", action: "view" });
  assert.deepEqual(rbac.classifyRequest("POST", "/api/v1/wealth/company/investments"), { page: "investments", action: "create" });
  assert.deepEqual(rbac.classifyRequest("POST", "/api/v1/wealth/personal/investments/abc/close"), { page: "personalWealth", action: "edit" });
  assert.deepEqual(rbac.classifyRequest("POST", "/api/v1/wealth/company/investments/abc/valuations"), { page: "investments", action: "edit" });
  assert.deepEqual(rbac.classifyRequest("DELETE", "/api/v1/wealth/personal/investments/abc"), { page: "personalWealth", action: "delete" });
  // A user granted only company investments is refused personal wealth.
  const user = { role: "user", permissions: { investments: ["view"] } };
  assert.equal(rbac.checkApiAccess(user, "GET", "/api/v1/wealth/company/investments"), null);
  assert.ok(rbac.checkApiAccess(user, "GET", "/api/v1/wealth/personal/investments"));
  assert.ok(rbac.checkApiAccess(user, "POST", "/api/v1/wealth/company/investments"));
});

test("a company holding is posted at cost: Dr Investments Held, Cr bank", async () => {
  const r = await add("company");
  assert.equal(r.status, 201, r.text);
  const inv = await mongoose.model("Investment").findById(r.body.data._id).lean();
  const j = await journalsFor(inv.journal_id);
  assert.equal(j.posting_status, "posted");
  const dr = j.line_items.find((l) => l.creditOrDebit === "Debit");
  const cr = j.line_items.find((l) => l.creditOrDebit === "Credit");
  assert.equal(dr.coa_account_name, "Investments Held");
  assert.equal(dr.amount, 100000);
  assert.equal(cr.coa_account_id, bank.account_id);
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: org }).lean();
  const held = coa.chart_of_accounts.find((a) => a.account_name === "Investments Held");
  assert.equal(held.account_type, "other_asset");
  // The account is created once.
  await add("company", { name: "Second", cost: 500 });
  const again = await mongoose.model("Chart_of_account").findOne({ organization_id: org }).lean();
  assert.equal(again.chart_of_accounts.filter((a) => a.account_name === "Investments Held").length, 1);
});

test("bad holdings are refused", async () => {
  assert.equal((await add("company", { name: "" })).status, 400);
  assert.equal((await add("company", { cost: 0 })).status, 400);
  assert.equal((await add("company", { cost: 10.123 })).status, 400);
  assert.equal((await add("company", { purchase_date: day(3) })).status, 400);
  assert.equal((await add("company", { purchase_date: "2026-02-30" })).status, 400);
  assert.equal((await add("company", { maturity_date: day(-60) })).status, 400);
  assert.equal((await add("company", { pay_account_id: "nope" })).status, 400);
  assert.equal((await add("company", { interest_rate: 150 })).status, 400);
  assert.equal((await add("nonsense")).status, 404);
});

test("an opening holding posts against the opening balance offset", async () => {
  const r = await add("company", { name: "Old gold", kind: "gold", pay_account_id: undefined, already_held: true, cost: 50000 });
  assert.equal(r.status, 201, r.text);
  const inv = await mongoose.model("Investment").findById(r.body.data._id).lean();
  const j = await journalsFor(inv.journal_id);
  assert.equal(j.line_items.find((l) => l.creditOrDebit === "Credit").coa_account_name, "Opening Balance Offset");
});

test("personal holdings post nothing to the books", async () => {
  const before = await mongoose.model("Journal").countDocuments({ organization_id: org });
  const r = await add("personal", { name: "My MF", kind: "mutual_fund", pay_account_id: undefined, cost: 20000 });
  assert.equal(r.status, 201, r.text);
  assert.equal(await mongoose.model("Journal").countDocuments({ organization_id: org }), before);
  assert.equal(r.body.data.posted, false);
});

test("dated values give the current value and the gain", async () => {
  const list = await call("get", `/api/v1/wealth/company/investments?org_id=${org}`);
  const fd = list.body.data.find((x) => x.name === "HDFC FD");
  assert.equal(fd.current_value, 100000);
  const v1 = await call("post", `/api/v1/wealth/company/investments/${fd._id}/valuations`, { org_id: org, date: day(-10), value: 102000 });
  assert.equal(v1.status, 200, v1.text);
  await call("post", `/api/v1/wealth/company/investments/${fd._id}/valuations`, { org_id: org, date: day(-1), value: 103500 });
  const upd = await call("post", `/api/v1/wealth/company/investments/${fd._id}/valuations`, { org_id: org, date: day(-1), value: 103000 });
  assert.equal(upd.body.data.valuations.length, 2);
  assert.equal(upd.body.data.current_value, 103000);
  assert.equal(upd.body.data.gain, 3000);
  assert.equal(upd.body.data.gain_percent, 3);
  assert.equal((await call("post", `/api/v1/wealth/company/investments/${fd._id}/valuations`, { org_id: org, date: day(2), value: 1 })).status, 400);
  assert.equal((await call("post", `/api/v1/wealth/company/investments/${fd._id}/valuations`, { org_id: org, date: day(-90), value: 1 })).status, 400);
  // The books stay at cost.
  const inv = await mongoose.model("Investment").findById(fd._id).lean();
  assert.equal((await journalsFor(inv.journal_id)).total_amount, 100000);
});

test("totals add up and the scopes do not mix", async () => {
  const c = await call("get", `/api/v1/wealth/company/investments?org_id=${org}`);
  assert.equal(c.body.data.length, 3);
  assert.equal(c.body.totals.cost, 150500);
  assert.equal(c.body.totals.current_value, 153500);
  const p = await call("get", `/api/v1/wealth/personal/investments?org_id=${org}`);
  assert.deepEqual(p.body.data.map((x) => x.name), ["My MF"]);
});

test("closing a company holding posts the sale with its gain", async () => {
  const list = await call("get", `/api/v1/wealth/company/investments?org_id=${org}`);
  const fd = list.body.data.find((x) => x.name === "HDFC FD");
  assert.equal((await call("post", `/api/v1/wealth/company/investments/${fd._id}/close`, { org_id: org, date: day(0), proceeds: 108000 })).status, 400); // no deposit account
  const r = await call("post", `/api/v1/wealth/company/investments/${fd._id}/close`, { org_id: org, date: day(0), proceeds: 108000, deposit_account_id: bank.account_id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.status, "closed");
  assert.equal(r.body.data.closed.gain_or_loss, 8000);
  const inv = await mongoose.model("Investment").findById(fd._id).lean();
  const j = await journalsFor(inv.closed.journal_id);
  const sum = (side) => j.line_items.filter((l) => l.creditOrDebit === side).reduce((t, l) => t + l.amount, 0);
  assert.equal(sum("Debit"), 108000);
  assert.equal(sum("Credit"), 108000);
  assert.ok(j.line_items.some((l) => l.coa_account_name === "Interest Income" && l.amount === 8000));
  assert.equal((await call("post", `/api/v1/wealth/company/investments/${fd._id}/close`, { org_id: org, date: day(0), proceeds: 1, deposit_account_id: bank.account_id })).status, 400);
  assert.equal((await call("delete", `/api/v1/wealth/company/investments/${fd._id}?org_id=${org}`)).status, 400);
});

test("a loss is booked to expense, and deleting removes the purchase entry", async () => {
  const gold = (await call("get", `/api/v1/wealth/company/investments?org_id=${org}`)).body.data.find((x) => x.name === "Old gold");
  const r = await call("post", `/api/v1/wealth/company/investments/${gold._id}/close`, { org_id: org, date: day(0), proceeds: 45000, deposit_account_id: bank.account_id });
  assert.equal(r.body.data.closed.gain_or_loss, -5000);
  const inv = await mongoose.model("Investment").findById(gold._id).lean();
  const j = await journalsFor(inv.closed.journal_id);
  assert.ok(j.line_items.some((l) => l.creditOrDebit === "Debit" && l.coa_account_name === "Other Expenses" && l.amount === 5000));

  const second = (await call("get", `/api/v1/wealth/company/investments?org_id=${org}`)).body.data.find((x) => x.name === "Second");
  const stored = await mongoose.model("Investment").findById(second._id).lean();
  assert.equal((await call("delete", `/api/v1/wealth/company/investments/${second._id}?org_id=${org}`)).status, 200);
  assert.equal(await mongoose.model("Journal").countDocuments({ journal_id: stored.journal_id }), 0);
});

test("a locked period blocks company postings", async () => {
  const lock = await call("put", "/api/v1/period-lock", { org_id: org, locked_until: day(-5) });
  assert.equal(lock.status, 200, lock.text);
  assert.equal((await add("company", { name: "Late entry", purchase_date: day(-10) })).status, 400);
  // Personal records are not books, so they are not locked.
  assert.equal((await add("personal", { name: "Old personal", pay_account_id: undefined, purchase_date: day(-10) })).status, 201);
  await call("put", "/api/v1/period-lock", { org_id: org, locked_until: null });
});

test("another organisation cannot see or change these holdings", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Wealth Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  assert.equal((await call("get", `/api/v1/wealth/company/investments?org_id=${other}`)).body.data.length, 0);
  const mine = (await call("get", `/api/v1/wealth/personal/investments?org_id=${org}`)).body.data[0];
  assert.equal((await call("delete", `/api/v1/wealth/personal/investments/${mine._id}?org_id=${other}`)).status, 404);
  // A personal id cannot be reached through the company scope.
  assert.equal((await call("delete", `/api/v1/wealth/company/investments/${mine._id}?org_id=${org}`)).status, 404);
});
