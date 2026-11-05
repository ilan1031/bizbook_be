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

test("day book: posted entries grouped by day with their lines, drafts left out", async () => {
  const r = await api(`/api/v1/reports/day-book?org_id=${org}&from=${day(-10)}&to=${day(0)}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.deepEqual(d.days.map((x) => x.date), [day(-3), day(-1)]);
  assert.deepEqual(d.days.flatMap((x) => x.entries.map((e) => e.journal_id)), ["J-SALE", "J-PAID"]);
  const sale = d.days[0].entries[0];
  assert.equal(sale.amount, 1000);
  assert.equal(sale.name, "Kumar Traders");
  assert.equal(sale.lines.length, 2);
  assert.equal(d.totals.entries, 2);
  assert.equal(d.totals.amount, 1400);
  assert.equal(d.truncated, false);
  assert.equal((await api(`/api/v1/reports/day-book?org_id=${org}&from=${day(0)}&to=${day(-5)}`)).status, 400);
});

test("cash flow: opening, what the money was for, and the closing balance agree", async () => {
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: String(org) }).lean();
  const pick = (type) => coa.chart_of_accounts.find((a) => a.account_type === type);
  const asset = pick("fixed_asset");
  const equity = pick("equity");
  assert.ok(asset && equity, "chart of accounts has a fixed asset and an equity account");
  const J = mongoose.model("Journal");
  const line = (a, side, amount) => ({ coa_account_id: a.account_id, coa_account_name: a.account_name, creditOrDebit: side, amount });
  await J.create({ organization_id: String(org), admin_id: adminId, journal_id: "J-ASSET", journal_date: dayjs(day(-2)).toDate(), type: "Manual Journal", line_items: [line(asset, "Debit", 100), line(acct.cash, "Credit", 100)] });
  await J.create({ organization_id: String(org), admin_id: adminId, journal_id: "J-CAPITAL", journal_date: dayjs(day(-2)).toDate(), type: "Manual Journal", line_items: [line(acct.cash, "Debit", 1000), line(equity, "Credit", 1000)] });

  const r = await api(`/api/v1/reports/cash-flow?org_id=${org}&from=${day(-10)}&to=${day(0)}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.opening_balance, 0);
  const sec = (key) => d.sections.find((s) => s.key === key);
  assert.equal(sec("operating").total, 400, "400 collected from customers");
  assert.equal(sec("investing").total, -100, "100 spent on an asset");
  assert.equal(sec("financing").total, 1000, "1000 capital brought in");
  assert.equal(d.net_change, 1300);
  assert.equal(d.closing_balance, 1300);
  assert.equal(d.checks.is_explained, true);
  assert.equal(d.cash_accounts.find((a) => a.account_id === acct.cash.account_id).closing, 1300);

  // A later window starts from the earlier closing balance.
  const later = await api(`/api/v1/reports/cash-flow?org_id=${org}&from=${day(-1)}&to=${day(0)}`);
  assert.equal(later.body.data.opening_balance, 1000 + 0 - 100, "balance before the window");
  assert.equal(later.body.data.net_change, 400);
  assert.equal(later.body.data.checks.is_explained, true);
});

test("GST summary: output tax on sales against input tax on purchases", async () => {
  const Inv = mongoose.model("Invoice");
  const gstInv = (n, date, status, total, lines) =>
    Inv.create({
      organization_id: Number(org), admin_id: adminId, invoice_id: `G${n}`, invoice_number: `GST-${n}`, customer_name: "Kumar Traders", date, due_date: date, status, total,
      gst_total: lines.reduce((t, l) => t + l.gst_amount, 0), cgst_total: lines.reduce((t, l) => t + l.gst_amount / 2, 0), sgst_total: lines.reduce((t, l) => t + l.gst_amount / 2, 0), igst_total: 0,
      line_items: lines,
    });
  await gstInv(1, day(-3), "sent", 1180, [{ gst_rate: 18, taxable_amount: 1000, gst_amount: 180 }]);
  await gstInv(2, day(-2), "paid", 1050, [{ gst_rate: 5, taxable_amount: 1000, gst_amount: 50 }]);
  await gstInv(3, day(-2), "draft", 5000, [{ gst_rate: 18, taxable_amount: 4000, gst_amount: 720 }]);
  await gstInv(4, day(-90), "sent", 590, [{ gst_rate: 18, taxable_amount: 500, gst_amount: 90 }]); // outside the period
  const vendor = await mongoose.model("Contact").findOne({ contact_name: "Steel Suppliers" });
  await mongoose.model("PO_bill").create({
    bill_number: "GB-1", organization_id: Number(org), admin_id: adminId, vendor_id: vendor._id, billDate: dayjs(day(-4)).toDate(), due_date: dayjs(day(20)).toDate(), status_type: "OPEN", total: 590,
    gst_total: 90, cgst_total: 0, sgst_total: 0, igst_total: 90, items: [{ item_total: 500, gst_rate: 18, gst_amount: 90 }],
  });
  const r = await api(`/api/v1/reports/gst-summary?org_id=${org}&from=${day(-10)}&to=${day(0)}`);
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.sales.documents, 2, "draft and out-of-period invoices left out");
  assert.equal(d.sales.taxable, 2000);
  assert.equal(d.sales.tax, 230);
  assert.deepEqual(d.sales.by_rate, [{ rate: 5, taxable: 1000, tax: 50 }, { rate: 18, taxable: 1000, tax: 180 }]);
  assert.equal(d.sales.cgst, 115);
  assert.equal(d.purchases.documents, 1);
  assert.equal(d.purchases.tax, 90);
  assert.equal(d.purchases.igst, 90);
  assert.equal(d.net.payable, 140, "230 collected - 90 input credit");
  assert.ok(d.notes.length > 0);
  assert.equal((await api(`/api/v1/reports/gst-summary?org_id=abc`)).status, 400);
});

test("day book, cash flow and GST summary each have their own permission", async () => {
  const U = mongoose.model("user");
  const bcrypt = require("bcryptjs");
  const user = await U.create({
    email: "books@test.local", password: await bcrypt.hash("User@1234", 10), mobile: "9876500002", company_name: "Books Co", role: "user", status: "active",
    agreement_status: true, permissions: { dayBook: ["view"] }, ip_limit: 5,
  });
  const login = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", "10.2.0.1").send({ email: "books@test.local", password: "User@1234" });
  const t = login.body.token;
  assert.ok(t, JSON.stringify(login.body));
  const mine = await request(app).post("/api/v1/org/create-organisation").set("X-Forwarded-For", "10.2.0.1").set("Authorization", `Bearer ${t}`)
    .send({ organizationName: "Books Co", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  const own = mine.body.data?.organization_id;
  assert.ok(own, mine.text);
  const get = (path) => api(`/api/v1/reports/${path}?org_id=${own}`, t, "10.2.0.1");
  assert.equal((await get("day-book")).status, 200);
  assert.equal((await get("cash-flow")).status, 403);
  assert.equal((await get("gst-summary")).status, 403);
  await U.deleteOne({ _id: user._id });
});
