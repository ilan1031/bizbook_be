// Banking: import a statement, match its lines to the books, reconcile the
// account, and keep each step behind its own permission.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_banking$2");
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
const day = (offset) => dayjs().add(offset, "day").format("YYYY-MM-DD");
const call = (method, url, body, tok = token, ip = IP) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Bank Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  org = o.body.data?.organization_id;
  assert.ok(org, JSON.stringify(o.body));
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: String(org) }).lean();
  const pick = (type) => coa.chart_of_accounts.find((a) => a.account_type === type);
  acct.bank = pick("bank") || pick("cash");
  acct.income = pick("income");
  acct.expense = pick("expense");
  acct.receivable = pick("accounts_receivable");
  assert.ok(acct.bank && acct.income && acct.expense, "chart of accounts has the accounts the test needs");

  const J = mongoose.model("Journal");
  const line = (a, side, amount) => ({ coa_account_id: a.account_id, coa_account_name: a.account_name, creditOrDebit: side, amount });
  const make = (journal_id, date, lines, extra = {}) =>
    J.create({ organization_id: String(org), admin_id: adminId, journal_id, journal_date: dayjs(date).toDate(), type: "Manual Journal", line_items: lines, ...extra });
  await make("B-IN", day(-5), [line(acct.bank, "Debit", 500), line(acct.income, "Credit", 500)], { customer_name: "Kumar Traders" });
  await make("B-OUT", day(-3), [line(acct.expense, "Debit", 200), line(acct.bank, "Credit", 200)]);
  await make("B-LATE", day(-1), [line(acct.bank, "Debit", 700), line(acct.income, "Credit", 700)]); // not on the statement yet
  await make("B-DRAFT", day(-2), [line(acct.bank, "Debit", 999), line(acct.income, "Credit", 999)], { posting_status: "draft" });
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

let txIn;
let txOut;

test("only bank and cash accounts are listed, with the book balance", async () => {
  const r = await call("get", `/api/v1/banking/accounts?org_id=${org}`);
  assert.equal(r.status, 200, r.text);
  const a = r.body.data.accounts.find((x) => x.account_id === acct.bank.account_id);
  assert.equal(a.book_balance, 1000, "500 - 200 + 700, no draft");
  assert.ok(r.body.data.accounts.every((x) => ["bank", "cash"].includes(x.account_type)));
});

test("import reads banks' number formats, reports bad rows and ignores repeats", async () => {
  const rows = [
    { date: day(-5), description: "NEFT Kumar Traders", reference: "N1", amount: "1,500.00" },
    { date: day(-3), description: "Cheque 123", debit: "200.00", credit: "" },
    { date: "not a date", description: "bad", amount: 10 },
    { date: day(-2), description: "zero", amount: 0 },
    { date: day(-2), description: "letters", amount: "abc" },
  ];
  rows[0].amount = "500.00"; // keep the books' figures
  const r = await call("post", "/api/v1/banking/transactions/import", { org_id: org, account_id: acct.bank.account_id, rows });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.imported, 2);
  assert.equal(r.body.data.errors.length, 3);
  assert.deepEqual(r.body.data.errors.map((e) => e.row), [3, 4, 5]);

  // The same statement again adds nothing.
  const again = await call("post", "/api/v1/banking/transactions/import", { org_id: org, account_id: acct.bank.account_id, rows: rows.slice(0, 2) });
  assert.equal(again.body.data.imported, 0);
  assert.equal(again.body.data.duplicates, 2);

  // Two identical lines in one file are two real transactions.
  const twins = await call("post", "/api/v1/banking/transactions/import", {
    org_id: org, account_id: acct.bank.account_id,
    rows: [{ date: day(-4), description: "Bank charge", amount: "-5" }, { date: day(-4), description: "Bank charge", amount: "-5" }],
  });
  assert.equal(twins.body.data.imported, 2);
  const list = await call("get", `/api/v1/banking/transactions?org_id=${org}&account_id=${acct.bank.account_id}`);
  assert.equal(list.body.data.total, 4);
  txIn = list.body.data.transactions.find((t) => t.amount === 500);
  txOut = list.body.data.transactions.find((t) => t.amount === -200);
  assert.ok(txIn && txOut);

  // Not a bank account, no rows, too many rows.
  assert.equal((await call("post", "/api/v1/banking/transactions/import", { org_id: org, account_id: acct.income.account_id, rows })).status, 400);
  assert.equal((await call("post", "/api/v1/banking/transactions/import", { org_id: org, account_id: acct.bank.account_id, rows: [] })).status, 400);
});

test("suggestions find the journal with the same amount and direction", async () => {
  const r = await call("get", `/api/v1/banking/transactions/${txIn._id}/suggestions?org_id=${org}`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data.suggestions.map((s) => s.journal_id), ["B-IN"]);
  assert.equal(r.body.data.suggestions[0].name, "Kumar Traders");
  const out = await call("get", `/api/v1/banking/transactions/${txOut._id}/suggestions?org_id=${org}`);
  assert.deepEqual(out.body.data.suggestions.map((s) => s.journal_id), ["B-OUT"], "a withdrawal matches a credit to the account");
});

test("matching: a wrong entry is refused, a right one sticks and can be undone", async () => {
  const wrong = await call("patch", `/api/v1/banking/transactions/${txIn._id}`, { org_id: org, action: "match", journal_id: "B-OUT" });
  assert.equal(wrong.status, 400);
  const draft = await call("patch", `/api/v1/banking/transactions/${txIn._id}`, { org_id: org, action: "match", journal_id: "B-DRAFT" });
  assert.equal(draft.status, 400, "a draft isn't in the books");

  const ok = await call("patch", `/api/v1/banking/transactions/${txIn._id}`, { org_id: org, action: "match", journal_id: "B-IN" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.status, "matched");
  assert.equal((await call("patch", `/api/v1/banking/transactions/${txIn._id}`, { org_id: org, action: "match", journal_id: "B-IN" })).status, 400, "already matched");
  assert.equal((await call("delete", `/api/v1/banking/transactions/${txIn._id}?org_id=${org}`)).status, 400, "unmatch before deleting");

  // Another statement line of the same size can't reuse the same entry.
  const dup = await call("post", "/api/v1/banking/transactions/import", { org_id: org, account_id: acct.bank.account_id, rows: [{ date: day(-5), description: "Second 500", amount: 500 }] });
  assert.equal(dup.body.data.imported, 1);
  const second = (await call("get", `/api/v1/banking/transactions?org_id=${org}&status=unmatched`)).body.data.transactions.find((t) => t.description === "Second 500");
  assert.equal((await call("patch", `/api/v1/banking/transactions/${second._id}`, { org_id: org, action: "match", journal_id: "B-IN" })).status, 400, "the entry is already used");
  assert.equal((await call("delete", `/api/v1/banking/transactions/${second._id}?org_id=${org}`)).status, 200);

  const un = await call("patch", `/api/v1/banking/transactions/${txIn._id}`, { org_id: org, action: "unmatch" });
  assert.equal(un.body.data.status, "unmatched");
  assert.equal((await call("patch", `/api/v1/banking/transactions/${txIn._id}`, { org_id: org, action: "nonsense" })).status, 400);
  assert.equal((await call("patch", `/api/v1/banking/transactions/000000000000000000000000`, { org_id: org, action: "ignore" })).status, 404);
});

test("reconciliation: matched lines clear, uncleared entries explain the gap, difference reaches zero", async () => {
  const before = await call("get", `/api/v1/banking/reconciliation?org_id=${org}&account_id=${acct.bank.account_id}`);
  assert.equal(before.status, 200, before.text);
  assert.equal(before.body.data.is_reconciled, false);
  assert.equal(before.body.data.unmatched_statement.count, 4);

  for (const [tx, journal_id] of [[txIn, "B-IN"], [txOut, "B-OUT"]]) {
    assert.equal((await call("patch", `/api/v1/banking/transactions/${tx._id}`, { org_id: org, action: "match", journal_id })).status, 200);
  }
  // The two 5-rupee bank charges are in the statement but not yet in the books.
  const charges = (await call("get", `/api/v1/banking/transactions?org_id=${org}&status=unmatched`)).body.data.transactions;
  assert.equal(charges.length, 2);
  const mid = await call("get", `/api/v1/banking/reconciliation?org_id=${org}&account_id=${acct.bank.account_id}`);
  const m = mid.body.data;
  assert.equal(m.book_balance, 1000);
  assert.equal(m.statement_balance, 290, "500 - 200 - 5 - 5");
  assert.equal(m.uncleared_book.total, 700, "the late receipt isn't on the statement yet");
  assert.equal(m.uncleared_book.items[0].journal_id, "B-LATE");
  assert.equal(m.unmatched_statement.total, -10);
  assert.equal(m.difference, 0, "statement = book - uncleared + statement-only lines");
  assert.equal(m.is_reconciled, false, "two statement lines still need a home");

  // Ignoring them (they will be booked later) leaves nothing to resolve.
  for (const c of charges) assert.equal((await call("patch", `/api/v1/banking/transactions/${c._id}`, { org_id: org, action: "ignore" })).status, 200);
  const done = await call("get", `/api/v1/banking/reconciliation?org_id=${org}&account_id=${acct.bank.account_id}&statement_opening=0`);
  assert.equal(done.body.data.ignored, 2);
  assert.equal(done.body.data.statement_balance, 300);
  assert.equal(done.body.data.difference, 0);
  assert.equal(done.body.data.is_reconciled, true);

  // An opening balance on the statement shifts it, and the difference shows.
  const off = await call("get", `/api/v1/banking/reconciliation?org_id=${org}&account_id=${acct.bank.account_id}&statement_opening=50`);
  assert.equal(off.body.data.difference, 50);
  assert.equal(off.body.data.is_reconciled, false);
  assert.equal((await call("get", `/api/v1/banking/reconciliation?org_id=${org}&account_id=${acct.income.account_id}`)).status, 400);
});

test("banking is behind its own permission, action by action", async () => {
  const U = mongoose.model("user");
  const bcrypt = require("bcryptjs");
  const user = await U.create({
    email: "teller@test.local", password: await bcrypt.hash("User@1234", 10), mobile: "9876500003", company_name: "Teller Co", role: "user", status: "active",
    agreement_status: true, permissions: { banking: ["view"] }, ip_limit: 5,
  });
  const login = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", "10.3.0.1").send({ email: "teller@test.local", password: "User@1234" });
  const t = login.body.token;
  assert.ok(t, JSON.stringify(login.body));
  const mine = await call("post", "/api/v1/org/create-organisation", { organizationName: "Teller Co", country: "India", state: "Tamil Nadu", industry_name: "IT" }, t, "10.3.0.1");
  const own = mine.body.data?.organization_id;
  assert.ok(own, mine.text);

  assert.equal((await call("get", `/api/v1/banking/accounts?org_id=${own}`, undefined, t, "10.3.0.1")).status, 200, "view");
  assert.equal((await call("post", "/api/v1/banking/transactions/import", { org_id: own, account_id: "x", rows: [{ date: day(0), amount: 1 }] }, t, "10.3.0.1")).status, 403, "import needs create");
  assert.equal((await call("patch", "/api/v1/banking/transactions/000000000000000000000000", { org_id: own, action: "ignore" }, t, "10.3.0.1")).status, 403, "matching needs edit");
  assert.equal((await call("delete", `/api/v1/banking/transactions/000000000000000000000000?org_id=${own}`, undefined, t, "10.3.0.1")).status, 403, "removing needs delete");
  // Someone else's books are never reachable.
  assert.equal((await call("get", `/api/v1/banking/accounts?org_id=${org}`, undefined, t, "10.3.0.1")).status, 403);
  await U.deleteOne({ _id: user._id });
});
