// Fixed assets: the register, depreciation posted month by month, disposal, and
// the permissions around each step.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_fixedassets$2");
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
// Dates are read the way the reports read them: in the server's own time zone.
const localDay = (d) => dayjs(d).format("YYYY-MM-DD");

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
let asset;

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Assets Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  org = o.body.data?.organization_id;
  assert.ok(org, JSON.stringify(o.body));
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: String(org) }).lean();
  const pick = (type, name) => coa.chart_of_accounts.find((a) => a.account_type === type && (!name || a.account_name === name));
  acct.asset = pick("fixed_asset", "Furniture and Equipment");
  acct.expense = pick("expense", "Depreciation Expense");
  acct.bank = pick("bank") || pick("cash");
  acct.income = pick("income");
  assert.ok(acct.asset && acct.expense && acct.bank && acct.income, "chart of accounts has what the test needs");
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

const figures = () => ({
  org_id: org, name: "Office furniture", purchase_date: "2026-01-15", cost: 12000, salvage_value: 0, method: "straight_line", useful_life_months: 12,
  asset_account_id: acct.asset.account_id, expense_account_id: acct.expense.account_id,
});
const journalsOf = (type) => mongoose.model("Journal").find({ organization_id: String(org), type }).lean();
const trial = async () => (await call("get", `/api/v1/reports/trial-balance?org_id=${org}&as_of=2027-12-31`)).body.data;

test("an asset is added with its figures checked", async () => {
  for (const [patch, message] of [
    [{ name: "" }, /name/],
    [{ cost: 0 }, /cost/],
    [{ salvage_value: 12000 }, /salvage/],
    [{ purchase_date: "2026-02-30" }, /purchase date/],
    [{ useful_life_months: 0 }, /Useful life/],
    [{ cost: 100.123 }, /decimal/],
    [{ asset_account_id: acct.expense.account_id }, /fixed asset account/],
    [{ expense_account_id: acct.asset.account_id }, /expense account/],
    [{ method: "wdv", rate: 0 }, /rate/],
  ]) {
    const r = await call("post", "/api/v1/fixed-assets", { ...figures(), ...patch });
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.match(r.body.message, message);
  }
  const ok = await call("post", "/api/v1/fixed-assets", figures());
  assert.equal(ok.status, 201, ok.text);
  asset = ok.body.data;
  assert.match(asset.asset_id, /^FA-/);
  assert.equal(asset.book_value, 12000);
  assert.equal(asset.monthly_depreciation, 1000);
  assert.equal(asset.can_change_figures, true);

  // The accumulated depreciation account was created in the chart of accounts.
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: String(org) }).lean();
  const acc = coa.chart_of_accounts.find((a) => a.account_name === "Accumulated Depreciation");
  assert.ok(acc && acc.account_type === "fixed_asset");
  assert.equal(asset.accumulated_account_id, acc.account_id);
  // A second asset reuses it.
  const two = await call("post", "/api/v1/fixed-assets", { ...figures(), name: "Laptop" });
  assert.equal(two.body.data.accumulated_account_id, acc.account_id);
  await call("delete", `/api/v1/fixed-assets/${two.body.data._id}?org_id=${org}`);
});

test("figures can still be changed before anything is posted", async () => {
  const r = await call("patch", `/api/v1/fixed-assets/${asset._id}`, { org_id: org, cost: 24000 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.monthly_depreciation, 2000);
  await call("patch", `/api/v1/fixed-assets/${asset._id}`, { org_id: org, cost: 12000 });
});

test("preview shows what a run would post, and running posts one journal per month", async () => {
  const pre = await call("get", `/api/v1/fixed-assets/depreciation/preview?org_id=${org}&up_to=2026-03-31`);
  assert.equal(pre.status, 200, pre.text);
  assert.equal(pre.body.data.items[0].months, 3);
  assert.equal(pre.body.data.total, 3000);
  assert.equal((await journalsOf("Depreciation")).length, 0, "a preview posts nothing");

  const run = await call("post", "/api/v1/fixed-assets/depreciation/run", { org_id: org, up_to: "2026-03-31" });
  assert.equal(run.status, 200, run.text);
  assert.equal(run.body.data.months_posted, 3);
  assert.equal(run.body.data.total, 3000);
  const journals = await journalsOf("Depreciation");
  assert.equal(journals.length, 3);
  for (const j of journals) {
    const debit = j.line_items.filter((l) => l.creditOrDebit === "Debit").reduce((t, l) => t + l.amount, 0);
    const credit = j.line_items.filter((l) => l.creditOrDebit === "Credit").reduce((t, l) => t + l.amount, 0);
    assert.equal(debit, 1000);
    assert.equal(credit, 1000);
  }
  assert.deepEqual(journals.map((j) => localDay(j.journal_date)).sort(), ["2026-01-31", "2026-02-28", "2026-03-31"], "dated the last day of each month");

  // Running again for the same period posts nothing more.
  const again = await call("post", "/api/v1/fixed-assets/depreciation/run", { org_id: org, up_to: "2026-03-31" });
  assert.equal(again.body.data.months_posted, 0);
  assert.equal((await journalsOf("Depreciation")).length, 3);

  // The books show it: expense up, accumulated depreciation as a credit.
  const tb = await trial();
  const row = (id) => tb.accounts.find((a) => a.account_id === id);
  assert.equal(row(acct.expense.account_id).debit, 3000);
  assert.equal(row(asset.accumulated_account_id).credit, 3000);
  assert.equal(tb.checks.is_balanced, true);
});

test("once posted, figures are locked and the asset can't be deleted", async () => {
  const locked = await call("patch", `/api/v1/fixed-assets/${asset._id}`, { org_id: org, cost: 5, name: "Renamed furniture" });
  assert.equal(locked.status, 200);
  assert.equal(locked.body.data.cost, 12000, "the cost didn't move");
  assert.equal(locked.body.data.name, "Renamed furniture", "the name can still change");
  assert.equal(locked.body.data.can_change_figures, false);
  assert.equal((await call("delete", `/api/v1/fixed-assets/${asset._id}?org_id=${org}`)).status, 400);
  const sched = await call("get", `/api/v1/fixed-assets/${asset._id}/schedule?org_id=${org}`);
  assert.equal(sched.body.data.schedule.length, 12);
  assert.equal(sched.body.data.schedule.filter((r) => r.posted).length, 3);
  assert.equal(sched.body.data.schedule[0].journal_id, journals0(await journalsOf("Depreciation"), "2026-01-31"));
});
const journals0 = (list, date) => list.find((j) => localDay(j.journal_date) === date)?.journal_id;

test("disposal needs depreciation up to date, the right accounts, and books the gain", async () => {
  const early = await call("post", `/api/v1/fixed-assets/${asset._id}/dispose`, { org_id: org, date: "2026-06-10", proceeds: 8000, proceeds_account_id: acct.bank.account_id, gain_loss_account_id: acct.income.account_id });
  assert.equal(early.status, 400);
  assert.match(early.body.message, /Post depreciation up to 2026-05/);

  await call("post", "/api/v1/fixed-assets/depreciation/run", { org_id: org, up_to: "2026-05-31" });
  // Five months posted: book value 12,000 - 5,000 = 7,000. Sold for 8,000: a gain of 1,000.
  const noBank = await call("post", `/api/v1/fixed-assets/${asset._id}/dispose`, { org_id: org, date: "2026-06-10", proceeds: 8000, gain_loss_account_id: acct.income.account_id });
  assert.match(noBank.body.message, /bank or cash/);
  const noGain = await call("post", `/api/v1/fixed-assets/${asset._id}/dispose`, { org_id: org, date: "2026-06-10", proceeds: 8000, proceeds_account_id: acct.bank.account_id });
  assert.match(noGain.body.message, /income account/);
  const wrongType = await call("post", `/api/v1/fixed-assets/${asset._id}/dispose`, { org_id: org, date: "2026-06-10", proceeds: 8000, proceeds_account_id: acct.bank.account_id, gain_loss_account_id: acct.expense.account_id });
  assert.equal(wrongType.status, 400);

  const ok = await call("post", `/api/v1/fixed-assets/${asset._id}/dispose`, { org_id: org, date: "2026-06-10", proceeds: 8000, proceeds_account_id: acct.bank.account_id, gain_loss_account_id: acct.income.account_id });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.status, "disposed");
  assert.equal(ok.body.data.disposal.gain_or_loss, 1000);
  const [j] = await journalsOf("Asset Disposal");
  const side = (s) => j.line_items.filter((l) => l.creditOrDebit === s).reduce((t, l) => t + l.amount, 0);
  assert.equal(side("Debit"), 13000, "8,000 received + 5,000 depreciation cleared");
  assert.equal(side("Credit"), 13000, "12,000 cost + 1,000 gain");

  // The asset is closed: no more depreciation, no changes, no second disposal.
  const run = await call("post", "/api/v1/fixed-assets/depreciation/run", { org_id: org, up_to: "2030-12-31" });
  assert.equal(run.body.data.months_posted, 0);
  assert.equal((await call("post", `/api/v1/fixed-assets/${asset._id}/dispose`, { org_id: org, date: "2026-06-11", proceeds: 0 })).status, 400);
  assert.equal((await call("patch", `/api/v1/fixed-assets/${asset._id}`, { org_id: org, name: "x" })).status, 400);
  const tb = await trial();
  assert.equal(tb.checks.is_balanced, true);
  assert.equal(tb.accounts.find((a) => a.account_id === asset.accumulated_account_id), undefined, "accumulated depreciation is cleared");
});

test("a loss is booked to an expense account", async () => {
  const a = (await call("post", "/api/v1/fixed-assets", { ...figures(), name: "Printer", cost: 6000, useful_life_months: 6, purchase_date: "2026-01-02" })).body.data;
  await call("post", "/api/v1/fixed-assets/depreciation/run", { org_id: org, up_to: "2026-02-28" }); // 2 x 1,000
  const sold = await call("post", `/api/v1/fixed-assets/${a._id}/dispose`, { org_id: org, date: "2026-03-05", proceeds: 3000, proceeds_account_id: acct.bank.account_id, gain_loss_account_id: acct.expense.account_id });
  assert.equal(sold.status, 200, sold.text);
  assert.equal(sold.body.data.disposal.gain_or_loss, -1000, "book value 4,000 sold for 3,000");
  const wrongSide = await call("post", "/api/v1/fixed-assets", { ...figures(), name: "Scrap" });
  const scrapped = await call("post", `/api/v1/fixed-assets/${wrongSide.body.data._id}/dispose`, { org_id: org, date: "2026-01-20", proceeds: 0 });
  assert.equal(scrapped.status, 400, "written off for nothing: the loss needs an account");
});

test("each action has its own permission", async () => {
  const U = mongoose.model("user");
  const bcrypt = require("bcryptjs");
  const user = await U.create({
    email: "clerk@test.local", password: await bcrypt.hash("User@1234", 10), mobile: "9876500004", company_name: "Clerk Co", role: "user", status: "active",
    agreement_status: true, permissions: { fixedAssets: ["view", "edit"] }, ip_limit: 5,
  });
  const login = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", "10.4.0.1").send({ email: "clerk@test.local", password: "User@1234" });
  const t = login.body.token;
  assert.ok(t, JSON.stringify(login.body));
  const mine = await call("post", "/api/v1/org/create-organisation", { organizationName: "Clerk Co", country: "India", state: "Tamil Nadu", industry_name: "IT" }, t, "10.4.0.1");
  const own = mine.body.data?.organization_id;
  assert.ok(own, mine.text);
  const as = (m, u, b) => call(m, u, b, t, "10.4.0.1");
  assert.equal((await as("get", `/api/v1/fixed-assets?org_id=${own}`)).status, 200, "view");
  assert.equal((await as("post", "/api/v1/fixed-assets", { ...figures(), org_id: own })).status, 403, "adding needs create");
  assert.equal((await as("post", "/api/v1/fixed-assets/depreciation/run", { org_id: own, up_to: "2026-03-31" })).status, 200, "posting depreciation needs edit");
  assert.equal((await as("post", "/api/v1/fixed-assets/000000000000000000000000/dispose", { org_id: own, date: "2026-03-31" })).status, 403, "disposing needs delete");
  assert.equal((await as("delete", `/api/v1/fixed-assets/000000000000000000000000?org_id=${own}`)).status, 403);
  assert.equal((await as("get", `/api/v1/fixed-assets?org_id=${org}`)).status, 403, "never another business's register");
  await U.deleteOne({ _id: user._id });
});
