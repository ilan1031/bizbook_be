// Trial Balance, General Ledger and the aged receivables / payables: the
// numbers follow the books (drafts and voids stay out, every row adds up), and
// each report is behind its own page permission.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_acctreports$2");
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
const api = (url, tok = token, ip = IP) => request(app).get(url).set("X-Forwarded-For", ip).set("Authorization", `Bearer ${tok}`);
const day = (offset) => dayjs().add(offset, "day").format("YYYY-MM-DD");

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
  const o = await request(app)
    .post("/api/v1/org/create-organisation")
    .set("X-Forwarded-For", IP)
    .set("Authorization", `Bearer ${token}`)
    .send({ organizationName: "Reports Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  org = o.body.data?.organization_id;
  assert.ok(org, JSON.stringify(o.body));
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: String(org) }).lean();
  const pick = (type) => coa.chart_of_accounts.find((a) => a.account_type === type);
  acct.receivable = pick("accounts_receivable");
  acct.income = pick("income");
  acct.cash = pick("cash") || pick("bank");
  assert.ok(acct.receivable && acct.income && acct.cash, "chart of accounts has the accounts the test needs");

  const J = mongoose.model("Journal");
  const line = (a, side, amount) => ({ coa_account_id: a.account_id, coa_account_name: a.account_name, creditOrDebit: side, amount });
  const make = (journal_id, date, lines, extra = {}) =>
    J.create({ organization_id: String(org), admin_id: adminId, journal_id, journal_date: dayjs(date).toDate(), type: "Manual Journal", line_items: lines, ...extra });
  // Before the period: a sale of 200 (opening balance for the ledger).
  await make("J-OLD", day(-60), [line(acct.receivable, "Debit", 200), line(acct.income, "Credit", 200)]);
  // In the period: a sale of 1000, then 400 received.
  await make("J-SALE", day(-3), [line(acct.receivable, "Debit", 1000), line(acct.income, "Credit", 1000)], { customer_name: "Kumar Traders" });
  await make("J-PAID", day(-1), [line(acct.cash, "Debit", 400), line(acct.receivable, "Credit", 400)]);
  // A draft: counted nowhere.
  await make("J-DRAFT", day(-2), [line(acct.receivable, "Debit", 9999), line(acct.income, "Credit", 9999)], { posting_status: "draft" });
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("trial balance: every account, debits equal credits, drafts left out", async () => {
  const r = await api(`/api/v1/reports/trial-balance?org_id=${org}&as_of=${day(0)}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.checks.is_balanced, true);
  assert.equal(d.totals.difference, 0);
  assert.equal(d.totals.debit, d.totals.credit);
  const row = (id) => d.accounts.find((a) => a.account_id === id);
  assert.equal(row(acct.receivable.account_id).debit, 800, "200 + 1000 - 400, no draft");
  assert.equal(row(acct.cash.account_id).debit, 400);
  assert.equal(row(acct.income.account_id).credit, 1200);
  assert.equal(d.totals.debit, 1200);
});

test("trial balance for a period splits opening balance and movement", async () => {
  const r = await api(`/api/v1/reports/trial-balance?org_id=${org}&from=${day(-10)}&as_of=${day(0)}`);
  const row = r.body.data.accounts.find((a) => a.account_id === acct.receivable.account_id);
  assert.equal(row.opening, 200);
  assert.equal(row.period_debit, 1000);
  assert.equal(row.period_credit, 400);
  assert.equal(row.debit, 800);
  // As of an earlier date the later journals don't count.
  const early = await api(`/api/v1/reports/trial-balance?org_id=${org}&as_of=${day(-90)}`);
  assert.equal(early.body.data.accounts.length, 0);
});

test("trial balance checks its input", async () => {
  assert.equal((await api(`/api/v1/reports/trial-balance`)).status, 400);
  assert.equal((await api(`/api/v1/reports/trial-balance?org_id=${org}&as_of=2026-02-30`)).status, 400);
  assert.equal((await api(`/api/v1/reports/trial-balance?org_id=${org}&from=${day(0)}&as_of=${day(-5)}`)).status, 400);
});

test("general ledger: opening balance, entries with a running balance, and the account list", async () => {
  const list = await api(`/api/v1/reports/general-ledger?org_id=${org}`);
  assert.ok(list.body.data.accounts.some((a) => a.account_id === acct.receivable.account_id));

  const r = await api(`/api/v1/reports/general-ledger?org_id=${org}&account_id=${acct.receivable.account_id}&from=${day(-10)}&to=${day(0)}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.opening_balance, 200);
  assert.deepEqual(d.entries.map((e) => e.journal_id), ["J-SALE", "J-PAID"], "the draft is not listed");
  assert.deepEqual(d.entries.map((e) => e.balance), [1200, 800]);
  assert.equal(d.entries[0].name, "Kumar Traders");
  assert.equal(d.totals.debit, 1000);
  assert.equal(d.totals.credit, 400);
  assert.equal(d.closing_balance, 800);
  // A credit-normal account runs the other way: income grows with credits.
  const inc = await api(`/api/v1/reports/general-ledger?org_id=${org}&account_id=${acct.income.account_id}&from=${day(-10)}&to=${day(0)}`);
  assert.equal(inc.body.data.account.normal_side, "credit");
  assert.equal(inc.body.data.closing_balance, 1200);
  assert.equal((await api(`/api/v1/reports/general-ledger?org_id=${org}&account_id=nope`)).status, 404);
});

test("aged receivables: unpaid invoices by days past due, per customer, drafts and paid left out", async () => {
  const Inv = mongoose.model("Invoice");
  const inv = (n, name, due, balance, status = "sent") =>
    Inv.create({ organization_id: Number(org), admin_id: adminId, invoice_id: `I${n}`, invoice_number: `INV-${n}`, customer_id: name, customer_name: name, date: day(-100), due_date: due, status, total: balance, balance });
  await inv(1, "Kumar Traders", day(-45), 500); // 31-60
  await inv(2, "Kumar Traders", day(10), 300); // current
  await inv(3, "Ravi Stores", day(-5), 100); // 1-30
  await inv(4, "Ravi Stores", day(-200), 900); // over 90
  await inv(5, "Ravi Stores", day(-45), 999, "draft");
  await inv(6, "Ravi Stores", day(-45), 0, "paid");
  const r = await api(`/api/v1/reports/aged-receivables?org_id=${org}&as_of=${day(0)}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.deepEqual(d.totals, { current: 300, d1_30: 100, d31_60: 500, d61_90: 0, d90_plus: 900, total: 1800 });
  const kumar = d.parties.find((p) => p.party_name === "Kumar Traders");
  assert.equal(kumar.total, 800);
  assert.equal(kumar.d31_60, 500);
  assert.equal(kumar.documents.length, 2);
  assert.equal(d.parties[0].party_name, "Ravi Stores", "largest balance first");
  assert.equal((await api(`/api/v1/reports/aged-receivables?org_id=abc`)).status, 400);
});

test("aged payables: open bills by days past due with the vendor's name", async () => {
  const vendor = await mongoose.model("Contact").create({ contact_id: "V1", organization_id: String(org), admin_id: adminId, contact_name: "Steel Suppliers", contact_type: "Vendor" });
  const Bill = mongoose.model("PO_bill");
  const bill = (n, due, balance, status_type) =>
    Bill.create({ bill_number: `B-${n}`, organization_id: Number(org), admin_id: adminId, vendor_id: vendor._id, billDate: dayjs().add(-80, "day").toDate(), due_date: dayjs(due).toDate(), total: balance, balance, status_type });
  await bill(1, day(-20), 250, "OPEN");
  await bill(2, day(-70), 150, "PARTIALLY PAID");
  await bill(3, day(-20), 999, "DRAFT");
  await bill(4, day(-20), 999, "VOID");
  const r = await api(`/api/v1/reports/aged-payables?org_id=${org}&as_of=${day(0)}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.parties.length, 1);
  assert.equal(d.parties[0].party_name, "Steel Suppliers");
  assert.deepEqual(d.totals, { current: 0, d1_30: 250, d31_60: 0, d61_90: 150, d90_plus: 0, total: 400 });
});

test("each report is behind its own page permission", async () => {
  const U = mongoose.model("user");
  const bcrypt = require("bcryptjs");
  const user = await U.create({
    email: "viewer@test.local",
    password: await bcrypt.hash("User@1234", 10),
    mobile: "9876500001",
    company_name: "Viewer Co",
    role: "user",
    status: "active",
    agreement_status: true,
    permissions: { trialBalance: ["view"] },
    ip_limit: 5,
  });
  const login = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", "10.1.0.1").send({ email: "viewer@test.local", password: "User@1234" });
  assert.ok(login.body.token, JSON.stringify(login.body));
  const t = login.body.token;
  // Another business's books are never returned, whatever the permissions.
  assert.equal((await api(`/api/v1/reports/trial-balance?org_id=${org}`, t, "10.1.0.1")).status, 403);

  const mine = await request(app)
    .post("/api/v1/org/create-organisation")
    .set("X-Forwarded-For", "10.1.0.1")
    .set("Authorization", `Bearer ${t}`)
    .send({ organizationName: "Viewer Co", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  const own = mine.body.data?.organization_id;
  assert.ok(own, mine.text);
  const get = (path) => api(`/api/v1/reports/${path}?org_id=${own}`, t, "10.1.0.1");
  assert.equal((await get("trial-balance")).status, 200);
  for (const path of ["general-ledger", "aged-receivables", "aged-payables"]) {
    const r = await get(path);
    assert.equal(r.status, 403, `${path}: ${r.text}`);
  }
  assert.equal((await get("trial-balance")).body.data.accounts.length, 0, "the viewer's own books are empty");
  await U.deleteOne({ _id: user._id });
});
