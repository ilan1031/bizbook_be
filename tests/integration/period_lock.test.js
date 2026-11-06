// Period locking: once the books are locked up to a date, entries dated on or
// before it can't be added, changed or removed, and nothing is half-changed
// when a request is refused.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_periodlock$2");
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
const lock = (until, note) => call("put", "/api/v1/period-lock", { org_id: org, locked_until: until, note });
const manual = (date) =>
  call("post", `/api/v1/manual-journals?org_id=${org}`, {
    journal_date: date,
    line_items: [
      { coa_account_id: acct.bank.account_id, creditOrDebit: "Debit", amount: 100 },
      { coa_account_id: acct.income.account_id, creditOrDebit: "Credit", amount: 100 },
    ],
  });

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Lock Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  org = o.body.data?.organization_id;
  assert.ok(org, JSON.stringify(o.body));
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: String(org) }).lean();
  const pick = (type, name) => coa.chart_of_accounts.find((a) => a.account_type === type && (!name || a.account_name === name));
  acct.bank = pick("bank") || pick("cash");
  acct.income = pick("income");
  acct.asset = pick("fixed_asset", "Furniture and Equipment");
  acct.expense = pick("expense", "Depreciation Expense");
  assert.ok(acct.bank && acct.income && acct.asset && acct.expense);
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("the lock date is validated, saved, and its history kept", async () => {
  assert.equal((await call("get", `/api/v1/period-lock?org_id=${org}`)).body.data.locked_until, null);
  assert.equal((await lock(day(5))).status, 400, "can't lock into the future");
  assert.equal((await lock("not a date")).status, 400);
  assert.equal((await call("put", "/api/v1/period-lock", { locked_until: day(-30) })).status, 400, "needs an organisation");
  const ok = await lock(day(-30), "March filed");
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.locked_until, day(-30));
  assert.equal(ok.body.data.history[0].note, "March filed");
  assert.equal((await call("get", `/api/v1/period-lock?org_id=${org}`)).body.data.locked_until, day(-30));
  await lock(null);
  assert.equal((await call("get", `/api/v1/period-lock?org_id=${org}`)).body.data.locked_until, null);
  assert.equal((await call("get", `/api/v1/period-lock?org_id=${org}`)).body.data.history.length, 2, "locking and unlocking are both recorded");
});

test("a manual journal in or before the locked period is refused; later ones go through", async () => {
  const before = await manual(day(-40)); // booked while unlocked
  assert.ok([200, 201].includes(before.status), before.text);
  const journalId = before.body.data?.journal_id || before.body.journal_id;
  assert.ok(journalId, before.text);

  await lock(day(-30));
  const refused = await manual(day(-40));
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "PERIOD_LOCKED");
  assert.match(refused.body.message, /locked up to/);
  assert.equal((await manual(day(-30))).status, 403, "the lock date itself is closed");
  assert.ok([200, 201].includes((await manual(day(-29))).status), "the day after is open");

  // Removing an old entry is refused too, and nothing is deleted.
  const del = await call("delete", `/api/v1/manual-journals/${journalId}?org_id=${org}`);
  assert.equal(del.status, 403);
  assert.equal(del.body.code, "PERIOD_LOCKED");
  assert.ok(await mongoose.model("Journal").exists({ journal_id: journalId }), "the entry is still there");

  // Unlocking makes the same removal work.
  await lock(null);
  assert.equal((await call("delete", `/api/v1/manual-journals/${journalId}?org_id=${org}`)).status, 200);
});

test("changing, voiding or deleting an old invoice or bill is refused before anything changes", async () => {
  const Inv = mongoose.model("Invoice");
  const old = await Inv.create({ organization_id: Number(org), admin_id: adminId, invoice_id: "L1", invoice_number: "INV-L1", customer_name: "Kumar", date: day(-50), due_date: day(-40), status: "sent", total: 500, balance: 500 });
  const recent = await Inv.create({ organization_id: Number(org), admin_id: adminId, invoice_id: "L2", invoice_number: "INV-L2", customer_name: "Kumar", date: day(-2), due_date: day(10), status: "sent", total: 700, balance: 700 });
  const vendor = await mongoose.model("Contact").create({ contact_id: "V9", organization_id: String(org), admin_id: adminId, contact_name: "Steel", contact_type: "Vendor" });
  const Bill = mongoose.model("PO_bill");
  const oldBill = await Bill.create({ bill_number: "LB-1", organization_id: Number(org), admin_id: adminId, vendor_id: vendor._id, billDate: dayjs(day(-50)).toDate(), due_date: dayjs(day(-40)).toDate(), status_type: "OPEN", total: 300, balance: 300 });
  await lock(day(-30));

  for (const [method, url, body] of [
    ["delete", `/api/v1/invoices?org_id=${org}&invoice_id=L1`],
    ["put", `/api/v1/invoices/status?organization_id=${org}&invoice_id=L1`, { status: "void", status_formatted: "Void" }],
    ["patch", `/api/v1/invoices?organization_id=${org}&invoice_id=L1`, { notes: "edit" }],
    ["delete", `/api/v1/bills/delete-individual-bill?org_id=${org}&bill_id=${oldBill._id}&journal_id=x`],
    ["post", `/api/v1/bills/update-status-void?org_id=${org}&bill_id=${oldBill._id}`, {}],
    ["post", `/api/v1/invoices?organization_id=${org}`, { date: day(-45), customer_id: "x" }],
  ]) {
    const r = await call(method, url, body);
    assert.equal(r.status, 403, `${method} ${url}: ${r.text}`);
    assert.equal(r.body.code, "PERIOD_LOCKED");
  }
  assert.equal((await Inv.findOne({ invoice_id: "L1" }).lean()).status, "sent", "the old invoice is untouched");
  assert.ok(await Bill.exists({ _id: oldBill._id }), "the old bill is untouched");

  // A recent invoice is not held up by the lock (whatever else the controller says).
  const open = await call("delete", `/api/v1/invoices?org_id=${org}&invoice_id=L2`);
  assert.notEqual(open.body?.code, "PERIOD_LOCKED");
  assert.ok(recent);
  await lock(null);
  const free = await call("delete", `/api/v1/invoices?org_id=${org}&invoice_id=L1`);
  assert.notEqual(free.body?.code, "PERIOD_LOCKED", "unlocked, the same request is no longer stopped by the lock");
  assert.equal(old.invoice_id, "L1");
});

test("depreciation skips locked months and says so; disposal in a locked period is refused", async () => {
  const start = dayjs().subtract(3, "month").startOf("month");
  const made = await call("post", "/api/v1/fixed-assets", {
    org_id: org, name: "Lockable asset", purchase_date: start.format("YYYY-MM-DD"), cost: 6000, salvage_value: 0, method: "straight_line", useful_life_months: 6,
    asset_account_id: acct.asset.account_id, expense_account_id: acct.expense.account_id,
  });
  assert.equal(made.status, 201, made.text);
  const asset = made.body.data;
  // Lock up to the end of the first month of depreciation.
  const lockDate = start.endOf("month").format("YYYY-MM-DD");
  await lock(lockDate);
  const run = await call("post", "/api/v1/fixed-assets/depreciation/run", { org_id: org, up_to: dayjs().endOf("month").format("YYYY-MM-DD") });
  assert.equal(run.status, 200, run.text);
  assert.equal(run.body.data.months_posted, 3, "the 3 open months after the locked one");
  assert.match(run.body.data.skipped[0].reason, /locked period/);
  const months = (await mongoose.model("FixedAsset").findById(asset._id).lean()).postings.map((p) => p.month);
  assert.ok(!months.includes(start.format("YYYY-MM")), "the locked month was not posted");

  const disposal = await call("post", `/api/v1/fixed-assets/${asset._id}/dispose`, { org_id: org, date: lockDate, proceeds: 0 });
  assert.equal(disposal.status, 403);
  assert.equal(disposal.body.code, "PERIOD_LOCKED");
  await lock(null);
});

test("changing the lock needs its own permission, and another business's lock is out of reach", async () => {
  const U = mongoose.model("user");
  const bcrypt = require("bcryptjs");
  const user = await U.create({
    email: "closer@test.local", password: await bcrypt.hash("User@1234", 10), mobile: "9876500005", company_name: "Closer Co", role: "user", status: "active",
    agreement_status: true, permissions: { periodLock: ["view"] }, ip_limit: 5,
  });
  const login = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", "10.5.0.1").send({ email: "closer@test.local", password: "User@1234" });
  const t = login.body.token;
  assert.ok(t, JSON.stringify(login.body));
  const mine = await call("post", "/api/v1/org/create-organisation", { organizationName: "Closer Co", country: "India", state: "Tamil Nadu", industry_name: "IT" }, t, "10.5.0.1");
  const own = mine.body.data?.organization_id;
  assert.ok(own, mine.text);
  assert.equal((await call("get", `/api/v1/period-lock?org_id=${own}`, undefined, t, "10.5.0.1")).status, 200, "view");
  assert.equal((await call("put", "/api/v1/period-lock", { org_id: own, locked_until: day(-1) }, t, "10.5.0.1")).status, 403, "changing needs edit");
  assert.equal((await call("put", "/api/v1/period-lock", { org_id: org, locked_until: day(-1) }, t, "10.5.0.1")).status, 403, "not someone else's books");
  await U.updateOne({ _id: user._id }, { $set: { permissions: { periodLock: ["view", "edit"] } } });
  assert.equal((await call("put", "/api/v1/period-lock", { org_id: own, locked_until: day(-1) }, t, "10.5.0.1")).status, 200);
  await U.deleteOne({ _id: user._id });
});
