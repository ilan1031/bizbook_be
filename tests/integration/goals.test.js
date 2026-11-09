// Financial goals: progress from money put aside and linked holdings, the
// monthly saving needed, and status against the pace.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_goals$2");
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
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const day = (offset) => dayjs().add(offset, "day").format("YYYY-MM-DD");
const goal = (scope, extra) => call("post", `/api/v1/wealth/${scope}/goals`, { org_id: org, name: "Expansion fund", target_amount: 120000, target_date: day(365), ...extra });
const get = async (scope, name) => (await call("get", `/api/v1/wealth/${scope}/goals?org_id=${org}`)).body.data.find((g) => g.name === name);

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Goals Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("goals follow the permission of their area, and adding savings is an edit", () => {
  assert.deepEqual(rbac.classifyRequest("GET", "/api/v1/wealth/company/goals"), { page: "investments", action: "view" });
  assert.deepEqual(rbac.classifyRequest("POST", "/api/v1/wealth/personal/goals"), { page: "personalWealth", action: "create" });
  assert.deepEqual(rbac.classifyRequest("POST", "/api/v1/wealth/personal/goals/abc/contributions"), { page: "personalWealth", action: "edit" });
  assert.deepEqual(rbac.classifyRequest("DELETE", "/api/v1/wealth/company/goals/abc/contributions/x"), { page: "investments", action: "edit" });
  assert.deepEqual(rbac.classifyRequest("DELETE", "/api/v1/wealth/company/goals/abc"), { page: "investments", action: "delete" });
});

test("a new goal needs a sensible name, target and date", async () => {
  assert.equal((await goal("company", { name: "" })).status, 400);
  assert.equal((await goal("company", { target_amount: 0 })).status, 400);
  assert.equal((await goal("company", { target_amount: 10.123 })).status, 400);
  assert.equal((await goal("company", { target_date: day(-5) })).status, 400);
  assert.equal((await goal("company", { target_date: "2026-02-30" })).status, 400);
  assert.equal((await goal("company", { start_date: day(400) })).status, 400);
  assert.equal((await goal("nonsense")).status, 404);
  const ok = await goal("company");
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.data.saved, 0);
  assert.equal(ok.body.data.remaining, 120000);
  assert.equal(ok.body.data.status, "on_track");
  assert.equal(ok.body.data.months_left, 12);
  assert.equal(ok.body.data.monthly_needed, 10000);
});

test("money put aside moves progress and lowers the monthly amount needed", async () => {
  const g = await get("company", "Expansion fund");
  const r = await call("post", `/api/v1/wealth/company/goals/${g._id}/contributions`, { org_id: org, amount: 36000, note: "First instalment" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.saved, 36000);
  assert.equal(r.body.data.percent, 30);
  assert.equal(r.body.data.remaining, 84000);
  assert.equal(r.body.data.monthly_needed, 7000);
  assert.equal((await call("post", `/api/v1/wealth/company/goals/${g._id}/contributions`, { org_id: org, amount: 0 })).status, 400);
  assert.equal((await call("post", `/api/v1/wealth/company/goals/${g._id}/contributions`, { org_id: org, amount: 5, date: day(3) })).status, 400);
  const cid = r.body.data.contributions[0]._id;
  const del = await call("delete", `/api/v1/wealth/company/goals/${g._id}/contributions/${cid}?org_id=${org}`);
  assert.equal(del.body.data.saved, 0);
  assert.equal((await call("delete", `/api/v1/wealth/company/goals/${g._id}/contributions/${cid}?org_id=${org}`)).status, 404);
});

test("a linked holding counts at its current value, and cannot serve two goals", async () => {
  const inv = await call("post", "/api/v1/wealth/personal/investments", { org_id: org, name: "House FD", kind: "fixed_deposit", purchase_date: day(-30), cost: 50000 });
  await call("post", `/api/v1/wealth/personal/investments/${inv.body.data._id}/valuations`, { org_id: org, date: day(-1), value: 52000 });
  const made = await goal("personal", { name: "House deposit", target_amount: 200000, linked_investments: [inv.body.data._id] });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.body.data.from_holdings, 52000);
  assert.equal(made.body.data.saved, 52000);
  assert.equal(made.body.data.percent, 26);
  const second = await goal("personal", { name: "Another", linked_investments: [inv.body.data._id] });
  assert.equal(second.status, 400);
  assert.match(second.body.message, /already counted/);
  // A company holding can't be linked from the personal area.
  const co = await call("post", "/api/v1/wealth/company/investments", { org_id: org, name: "Co FD", kind: "fixed_deposit", purchase_date: day(-10), cost: 1000, already_held: true });
  assert.equal((await goal("personal", { name: "Mixed", linked_investments: [co.body.data._id] })).status, 400);
  assert.equal((await goal("personal", { name: "Bad link", linked_investments: ["nope"] })).status, 400);
  // Selling the holding stops it counting.
  await call("post", `/api/v1/wealth/personal/investments/${inv.body.data._id}/close`, { org_id: org, date: day(0), proceeds: 53000 });
  assert.equal((await get("personal", "House deposit")).from_holdings, 0);
});

test("status shows achieved, behind and overdue", async () => {
  const g = await get("company", "Expansion fund");
  assert.equal((await call("post", `/api/v1/wealth/company/goals/${g._id}/contributions`, { org_id: org, amount: 120000 })).body.data.status, "achieved");

  // Half the time gone with almost nothing saved is behind.
  const behind = await goal("company", { name: "Tax reserve", target_amount: 100000, start_date: day(-180), target_date: day(180) });
  assert.equal(behind.status, 201, behind.text);
  assert.equal(behind.body.data.status, "behind");
  assert.ok(behind.body.data.expected_by_now > 45000 && behind.body.data.expected_by_now < 55000);
  const t = await call("post", `/api/v1/wealth/company/goals/${behind.body.data._id}/contributions`, { org_id: org, amount: 50000 });
  assert.equal(t.body.data.status, "on_track");

  // A goal whose date has passed and isn't met is overdue.
  await mongoose.model("Goal").updateOne({ _id: behind.body.data._id }, { $set: { target_date: new Date(day(-2)), contributions: [] } });
  const late = await get("company", "Tax reserve");
  assert.equal(late.status, "overdue");
  assert.equal(late.months_left, 0);
  assert.equal(late.monthly_needed, 100000);
});

test("goals can be edited and deleted, and stay in their own area", async () => {
  const g = await get("company", "Tax reserve");
  const upd = await call("patch", `/api/v1/wealth/company/goals/${g._id}`, { org_id: org, name: "Advance tax", target_amount: 80000, target_date: day(200) });
  assert.equal(upd.status, 200, upd.text);
  assert.equal(upd.body.data.name, "Advance tax");
  assert.equal(upd.body.data.target_amount, 80000);
  assert.equal((await call("patch", `/api/v1/wealth/company/goals/${g._id}`, { org_id: org, target_date: day(-400) })).status, 400);
  // The personal area can't reach a company goal.
  assert.equal((await call("delete", `/api/v1/wealth/personal/goals/${g._id}?org_id=${org}`)).status, 404);
  assert.equal((await call("delete", `/api/v1/wealth/company/goals/${g._id}?org_id=${org}`)).status, 200);
  assert.equal(await get("company", "Advance tax"), undefined);
});

test("another organisation sees none of it", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Goals Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  assert.equal((await call("get", `/api/v1/wealth/company/goals?org_id=${other}`)).body.data.length, 0);
  const mine = await get("company", "Expansion fund");
  assert.equal((await call("post", `/api/v1/wealth/company/goals/${mine._id}/contributions`, { org_id: other, amount: 1 })).status, 404);
});
