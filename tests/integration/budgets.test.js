// Budgets and Budget vs Actual: validation, the comparison against posted
// journals, and the Budgets permission.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_budgets$2");
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
let adminId;
const acct = {};
const IP = "10.0.0.1";
const call = (method, url, body, tok = token, ip = IP) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
// Budget starts three months ago, so the current month is inside it.
const START = dayjs().subtract(3, "month").format("YYYY-MM");
const m = (i) => dayjs(`${START}-01`).add(i, "month").format("YYYY-MM");
const mid = (i) => dayjs(`${m(i)}-15`).toDate();
const twelve = (n) => Array(12).fill(n);
let budget;

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Budget Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  org = o.body.data?.organization_id;
  assert.ok(org, JSON.stringify(o.body));
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: String(org) }).lean();
  const pick = (type, name) => coa.chart_of_accounts.find((a) => a.account_type === type && (!name || a.account_name === name));
  acct.bank = pick("bank") || pick("cash");
  acct.income = pick("income");
  acct.rent = pick("expense", "Rent Expense");
  acct.travel = pick("expense", "Travel Expense");
  assert.ok(acct.bank && acct.income && acct.rent && acct.travel);

  const J = mongoose.model("Journal");
  const line = (a, side, amount) => ({ coa_account_id: a.account_id, coa_account_name: a.account_name, creditOrDebit: side, amount });
  const make = (journal_id, date, lines, extra = {}) => J.create({ organization_id: String(org), admin_id: adminId, journal_id, journal_date: date, type: "Manual Journal", line_items: lines, ...extra });
  await make("BU-1", mid(0), [line(acct.bank, "Debit", 5000), line(acct.income, "Credit", 5000)]);
  await make("BU-2", mid(0), [line(acct.rent, "Debit", 2000), line(acct.bank, "Credit", 2000)]);
  await make("BU-3", mid(1), [line(acct.bank, "Debit", 3000), line(acct.income, "Credit", 3000)]);
  await make("BU-4", mid(1), [line(acct.travel, "Debit", 400), line(acct.bank, "Credit", 400)]); // not in the budget
  await make("BU-5", mid(2), [line(acct.bank, "Debit", 999), line(acct.income, "Credit", 999)]); // outside the months asked for
  await make("BU-6", mid(0), [line(acct.bank, "Debit", 777), line(acct.income, "Credit", 777)], { posting_status: "draft" });
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

const body = (patch = {}) => ({
  org_id: org, name: "FY budget", start_month: START,
  lines: [{ account_id: acct.income.account_id, amounts: twelve(4000) }, { account_id: acct.rent.account_id, amounts: twelve(1500) }],
  ...patch,
});

test("a budget's figures are checked", async () => {
  for (const [patch, message] of [
    [{ name: "" }, /name/],
    [{ start_month: "2026-13" }, /month/],
    [{ lines: [] }, /at least one/],
    [{ lines: [{ account_id: acct.bank.account_id, amounts: twelve(1) }] }, /income or expense/],
    [{ lines: [{ account_id: acct.rent.account_id, amounts: twelve(1) }, { account_id: acct.rent.account_id, amounts: twelve(2) }] }, /twice/],
    [{ lines: [{ account_id: acct.rent.account_id, amounts: [1, 2, 3] }] }, /12 months/],
    [{ lines: [{ account_id: acct.rent.account_id, amounts: twelve(-5) }] }, /zero or more/],
    [{ lines: [{ account_id: acct.rent.account_id, amounts: twelve(1.234) }] }, /2 decimal/],
    [{ lines: [{ account_id: "AC_999", amounts: twelve(1) }] }, /income or expense/],
  ]) {
    const r = await call("post", "/api/v1/budgets", body(patch));
    assert.equal(r.status, 400, JSON.stringify(patch).slice(0, 80));
    assert.match(r.body.message, message);
  }
  const ok = await call("post", "/api/v1/budgets", body());
  assert.equal(ok.status, 201, ok.text);
  budget = ok.body.data;
  assert.match(budget.budget_id, /^BG-/);
  assert.equal(budget.lines[0].total, 48000);
  assert.equal(budget.end_month, m(11));
  const list = await call("get", `/api/v1/budgets?org_id=${org}`);
  assert.equal(list.body.data.budgets.length, 1);
  assert.ok(list.body.data.accounts.every((a) => ["income", "expense"].includes(a.kind)), "only income and expense accounts are offered");
});

test("budget vs actual: months in range, favourable and unfavourable variances, unbudgeted spend", async () => {
  const r = await call("get", `/api/v1/reports/budget-vs-actual?org_id=${org}&budget_id=${budget._id}&from_month=${m(0)}&to_month=${m(1)}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  const row = (id) => d.rows.find((x) => x.account_id === id);
  const income = row(acct.income.account_id);
  assert.equal(income.budget, 8000, "2 months x 4,000");
  assert.equal(income.actual, 8000, "5,000 + 3,000: the draft and the later month are left out");
  assert.equal(income.variance, 0);
  assert.equal(income.percent_used, 100);
  const rent = row(acct.rent.account_id);
  assert.equal(rent.budget, 3000);
  assert.equal(rent.actual, 2000);
  assert.equal(rent.variance, 1000, "under budget is favourable");
  const travel = row(acct.travel.account_id);
  assert.equal(travel.budgeted, false);
  assert.equal(travel.budget, 0);
  assert.equal(travel.actual, 400);
  assert.equal(travel.variance, -400, "unbudgeted spend is unfavourable");
  assert.equal(travel.percent_used, null);
  assert.deepEqual(d.totals.income, { budget: 8000, actual: 8000 });
  assert.deepEqual(d.totals.expense, { budget: 3000, actual: 2400 });
  assert.deepEqual(d.totals.net, { budget: 5000, actual: 5600 });

  // One month only.
  const one = await call("get", `/api/v1/reports/budget-vs-actual?org_id=${org}&budget_id=${budget._id}&from_month=${m(1)}&to_month=${m(1)}`);
  assert.equal(one.body.data.rows.find((x) => x.account_id === acct.income.account_id).actual, 3000);
  // Defaults: from the start up to the current month (which holds the 999 and the 5,000 + 3,000).
  const def = await call("get", `/api/v1/reports/budget-vs-actual?org_id=${org}&budget_id=${budget._id}`);
  assert.equal(def.body.data.from_month, m(0));
  assert.equal(def.body.data.to_month, dayjs().format("YYYY-MM"));
  assert.equal(def.body.data.rows.find((x) => x.account_id === acct.income.account_id).actual, 8999);
});

test("the report checks its input", async () => {
  const get = (q) => call("get", `/api/v1/reports/budget-vs-actual?org_id=${org}${q}`);
  assert.equal((await get("")).status, 400);
  assert.equal((await get("&budget_id=nope")).status, 400);
  assert.equal((await get("&budget_id=000000000000000000000000")).status, 404);
  assert.equal((await get(`&budget_id=${budget._id}&from_month=1999-01`)).status, 400, "outside the budget's months");
  assert.equal((await get(`&budget_id=${budget._id}&from_month=${m(2)}&to_month=${m(1)}`)).status, 400);
});

test("a budget can be changed and deleted", async () => {
  const changed = await call("patch", `/api/v1/budgets/${budget._id}`, { org_id: org, name: "Revised", lines: [{ account_id: acct.income.account_id, amounts: twelve(5000) }] });
  assert.equal(changed.status, 200, changed.text);
  assert.equal(changed.body.data.name, "Revised");
  assert.equal(changed.body.data.lines.length, 1);
  assert.equal((await call("patch", `/api/v1/budgets/${budget._id}`, { org_id: org, lines: [] })).status, 400);
  assert.equal((await call("patch", `/api/v1/budgets/000000000000000000000000`, { org_id: org, name: "x" })).status, 404);
  assert.equal((await call("delete", `/api/v1/budgets/${budget._id}?org_id=${org}`)).status, 200);
  assert.equal((await call("delete", `/api/v1/budgets/${budget._id}?org_id=${org}`)).status, 404);
});

test("each budget action has its own permission", async () => {
  const U = mongoose.model("user");
  const bcrypt = require("bcryptjs");
  const user = await U.create({
    email: "planner@test.local", password: await bcrypt.hash("User@1234", 10), mobile: "9876500006", company_name: "Planner Co", role: "user", status: "active",
    agreement_status: true, permissions: { budgets: ["view"] }, ip_limit: 5,
  });
  const login = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", "10.6.0.1").send({ email: "planner@test.local", password: "User@1234" });
  const t = login.body.token;
  assert.ok(t, JSON.stringify(login.body));
  const mine = await call("post", "/api/v1/org/create-organisation", { organizationName: "Planner Co", country: "India", state: "Tamil Nadu", industry_name: "IT" }, t, "10.6.0.1");
  const own = mine.body.data?.organization_id;
  assert.ok(own, mine.text);
  const as = (mth, url, b) => call(mth, url, b, t, "10.6.0.1");
  assert.equal((await as("get", `/api/v1/budgets?org_id=${own}`)).status, 200, "view");
  assert.equal((await as("get", `/api/v1/reports/budget-vs-actual?org_id=${own}&budget_id=000000000000000000000000`)).status, 404, "the report is allowed (the budget just doesn't exist)");
  assert.equal((await as("post", "/api/v1/budgets", { ...body(), org_id: own })).status, 403, "adding needs create");
  assert.equal((await as("patch", "/api/v1/budgets/000000000000000000000000", { org_id: own, name: "x" })).status, 403, "changing needs edit");
  assert.equal((await as("delete", `/api/v1/budgets/000000000000000000000000?org_id=${own}`)).status, 403, "removing needs delete");
  assert.equal((await as("get", `/api/v1/budgets?org_id=${org}`)).status, 403, "never another business's budgets");
  await U.deleteOne({ _id: user._id });
});
