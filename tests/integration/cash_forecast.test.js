// Cash forecast: opening cash, receivables, payables, maturities and planned
// items, month by month.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_forecast$2");
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
let adminId;
let bank;
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const day = (offset) => dayjs().add(offset, "day").format("YYYY-MM-DD");
const inMonth = (m, d = 15) => dayjs().startOf("month").add(m, "month").date(d).format("YYYY-MM-DD");
const fc = (qs = "") => call("get", `/api/v1/wealth/company/forecast?org_id=${org}${qs}`);
let n = 0;
const invoice = (due, balance, status = "sent") => {
  n += 1;
  return mongoose.model("Invoice").create({ organization_id: Number(org), admin_id: adminId, invoice_id: `F${n}`, invoice_number: `FC-${n}`, customer_name: "C", date: day(-90), due_date: due, status, total: balance, balance });
};
const bill = (due, balance, status_type = "OPEN") => {
  n += 1;
  return mongoose.model("PO_bill").create({ bill_number: `FB-${n}`, organization_id: Number(org), admin_id: adminId, vendor_id: new mongoose.Types.ObjectId(), billDate: new Date(day(-60)), due_date: new Date(due), total: balance, balance, status_type });
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
  const res = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", IP).send({ email: "superadmin@test.local", password: "Super@1234" });
  token = res.body.token;
  assert.ok(token, JSON.stringify(res.body));
  adminId = (await mongoose.model("user").findOne({ role: "superadmin" }).lean())._id;
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Forecast Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  bank = (await call("get", `/api/v1/wealth/company/lookups?org_id=${org}`)).body.data.pay_accounts[0];
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: org }).lean();
  const equity = coa.chart_of_accounts.find((a) => a.account_id === "AC_043");
  const line = (a, side) => ({ coa_account_id: a.account_id, coa_account_name: a.account_name, creditOrDebit: side, amount: 100000 });
  await mongoose.model("Journal").create({ organization_id: org, admin_id: adminId, journal_id: "JL-FC-1", journal_date: new Date(day(-30)), type: "Opening", total_amount: 100000, line_items: [line(bank, "Debit"), line(equity, "Credit")], posting_status: "posted" });
  await invoice(inMonth(1), 40000); // next month
  await invoice(day(-10), 15000); // overdue
  await invoice(inMonth(8), 7000); // beyond a 6 month horizon
  await invoice(inMonth(1), 9999, "draft"); // not counted
  await bill(inMonth(1, 20), 25000);
  await bill(day(-5), 5000); // overdue
  await bill(inMonth(2), 8000, "PAID"); // not counted
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("cash forecast is its own permission page", () => {
  assert.ok(rbac.CATALOG.some((p) => p.key === "cashForecast"));
  assert.deepEqual(rbac.classifyRequest("GET", "/api/v1/wealth/company/forecast"), { page: "cashForecast", action: "view" });
  assert.deepEqual(rbac.classifyRequest("POST", "/api/v1/wealth/company/forecast-items"), { page: "cashForecast", action: "create" });
  assert.deepEqual(rbac.classifyRequest("DELETE", "/api/v1/wealth/company/forecast-items/abc"), { page: "cashForecast", action: "delete" });
  const user = { role: "user", permissions: { investments: ["view"] } };
  assert.ok(rbac.checkApiAccess(user, "GET", "/api/v1/wealth/company/forecast"));
});

test("it starts from the cash in the bank and spreads dues across months", async () => {
  const r = await fc("&months=6");
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.opening_cash, 100000);
  assert.equal(d.rows.length, 6);
  // Month 1 (this month): overdue invoice in, overdue bill out.
  assert.equal(d.rows[0].inflow.receivables, 15000);
  assert.equal(d.rows[0].outflow.payables, 5000);
  assert.equal(d.rows[0].closing, 110000);
  // Next month: 40000 in, 25000 out.
  assert.equal(d.rows[1].inflow.receivables, 40000);
  assert.equal(d.rows[1].outflow.payables, 25000);
  assert.equal(d.rows[1].closing, 125000);
  assert.equal(d.overdue.receivables, 15000);
  assert.equal(d.overdue.payables, 5000);
  assert.equal(d.beyond_horizon.receivables, 7000);
  assert.equal(d.first_shortfall, null);
});

test("a longer horizon brings later invoices in; a shorter one leaves them out", async () => {
  const twelve = (await fc("&months=12")).body.data;
  assert.equal(twelve.rows.length, 12);
  assert.equal(twelve.rows[8].inflow.receivables, 7000);
  assert.equal(twelve.beyond_horizon.receivables, 0);
  const three = (await fc("&months=3")).body.data;
  assert.equal(three.beyond_horizon.receivables, 7000);
});

test("customers paying late push money into later months", async () => {
  const r = (await fc("&months=6&delay=45")).body.data;
  assert.equal(r.delay, 45);
  assert.equal(r.rows[1].inflow.receivables < 40000, true);
  const total = r.rows.reduce((t, x) => t + x.inflow.receivables, 0) + r.beyond_horizon.receivables;
  assert.equal(total, 62000);
});

test("maturing deposits and planned items change the picture, and a shortfall is flagged", async () => {
  await call("post", "/api/v1/wealth/company/investments", { org_id: org, name: "Short FD", kind: "fixed_deposit", purchase_date: day(-20), cost: 20000, maturity_date: inMonth(2), pay_account_id: bank.account_id });
  let r = (await fc("&months=6")).body.data;
  assert.equal(r.opening_cash, 80000);
  assert.equal(r.rows[2].inflow.maturities, 20000);

  const bad = (b) => call("post", "/api/v1/wealth/company/forecast-items", { org_id: org, label: "Tax", direction: "out", amount: 1000, date: inMonth(3), ...b });
  assert.equal((await bad({ label: "" })).status, 400);
  assert.equal((await bad({ direction: "sideways" })).status, 400);
  assert.equal((await bad({ amount: 0 })).status, 400);
  assert.equal((await bad({ date: "2026-02-30" })).status, 400);
  assert.equal((await bad({ date: day(-100) })).status, 400);
  const big = await bad({ label: "Advance tax", amount: 500000 });
  assert.equal(big.status, 201, big.text);
  r = (await fc("&months=6")).body.data;
  assert.equal(r.rows[3].outflow.planned, 500000);
  assert.ok(r.first_shortfall);
  assert.ok(r.lowest.amount < 0);

  const items = await call("get", `/api/v1/wealth/company/forecast-items?org_id=${org}`);
  assert.equal(items.body.data.length, 1);
  assert.equal((await call("delete", `/api/v1/wealth/company/forecast-items/${items.body.data[0]._id}?org_id=${org}`)).status, 200);
  assert.equal((await fc("&months=6")).body.data.first_shortfall, null);
});

test("bad settings are refused", async () => {
  assert.equal((await fc("&months=5")).status, 400);
  assert.equal((await fc("&delay=-1")).status, 400);
  assert.equal((await fc("&delay=200")).status, 400);
  assert.equal((await call("get", "/api/v1/wealth/company/forecast")).status, 400);
});

test("another organisation gets its own empty forecast", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Forecast Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  const r = await call("get", `/api/v1/wealth/company/forecast?org_id=${other}`);
  assert.equal(r.body.data.opening_cash, 0);
  assert.equal(r.body.data.rows.reduce((t, x) => t + x.inflow.total + x.outflow.total, 0), 0);
});
