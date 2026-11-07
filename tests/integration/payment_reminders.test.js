// Payment reminders: which invoices are listed, who gets an email, the 24-hour
// cooldown, and the history.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_reminders$2");
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
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const day = (offset) => dayjs().add(offset, "day").format("YYYY-MM-DD");
let n = 0;
const invoice = (extra) => {
  n += 1;
  return mongoose.model("Invoice").create({ organization_id: Number(org), admin_id: adminId, invoice_id: `R${n}`, invoice_number: `REM-${n}`, customer_id: `c${n}`, customer_name: `Customer ${n}`, email: `c${n}@example.com`, date: day(-60), due_date: day(-10), status: "sent", total: 1000, balance: 1000, ...extra });
};
let late;
let soon;
let noEmail;
let paid;
let draft;

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Reminder Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  late = await invoice({ due_date: day(-10) });
  soon = await invoice({ due_date: day(3), balance: 500 });
  noEmail = await invoice({ email: "", due_date: day(-5) });
  paid = await invoice({ balance: 0, status: "paid" });
  draft = await invoice({ status: "draft", due_date: day(-20) });
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("overdue lists late unpaid invoices only, most late first", async () => {
  const r = await call("get", `/api/v1/reminders?org_id=${org}`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data.map((x) => x.invoice_number), [late.invoice_number, noEmail.invoice_number]);
  assert.equal(r.body.data[0].days_past_due, 10);
  assert.equal(r.body.data[0].can_send, true);
  assert.equal(r.body.data[1].can_send, false);
  assert.equal(r.body.totals.balance, 2000);
});

test("due soon lists invoices due within a week", async () => {
  const r = await call("get", `/api/v1/reminders?org_id=${org}&filter=due_soon`);
  assert.deepEqual(r.body.data.map((x) => x.invoice_number), [soon.invoice_number]);
  const all = await call("get", `/api/v1/reminders?org_id=${org}&filter=all`);
  assert.equal(all.body.data.length, 3); // not paid, not draft
});

test("sending emails the customer, skips the rest, and logs it", async () => {
  const ids = [late, noEmail, paid, draft].map((i) => String(i._id));
  const r = await call("post", "/api/v1/reminders/send", { org_id: org, invoice_ids: ids });
  assert.equal(r.status, 200, r.text);
  const by = (num) => r.body.data.find((x) => x.invoice_number === num);
  assert.equal(by(late.invoice_number).status, "sent");
  assert.equal(by(noEmail.invoice_number).status, "skipped");
  assert.match(by(noEmail.invoice_number).reason, /No email/);
  assert.equal(r.body.data.filter((x) => x.status === "skipped" && /Not an unpaid/.test(x.reason)).length, 2);
  const log = await call("get", `/api/v1/reminders/log?org_id=${org}`);
  assert.equal(log.body.data.length, 1);
  assert.equal(log.body.data[0].to, "c1@example.com");
  assert.equal(log.body.data[0].days_past_due, 10);
});

test("an invoice reminded today is not reminded again", async () => {
  const r = await call("post", "/api/v1/reminders/send", { org_id: org, invoice_ids: [String(late._id)] });
  assert.equal(r.body.data[0].status, "skipped");
  assert.match(r.body.data[0].reason, /24 hours/);
  const list = await call("get", `/api/v1/reminders?org_id=${org}`);
  const row = list.body.data.find((x) => x.invoice_number === late.invoice_number);
  assert.equal(row.can_send, false);
  assert.equal(row.reminders_sent, 1);
});

test("bad requests are refused", async () => {
  assert.equal((await call("post", "/api/v1/reminders/send", { org_id: org, invoice_ids: [] })).status, 400);
  assert.equal((await call("post", "/api/v1/reminders/send", { org_id: org, invoice_ids: ["nope"] })).status, 400);
  assert.equal((await call("get", "/api/v1/reminders")).status, 400);
});

test("another organisation sees none of these", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Reminder Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  const list = await call("get", `/api/v1/reminders?org_id=${other}&filter=all`);
  assert.equal(list.body.data.length, 0);
  const r = await call("post", "/api/v1/reminders/send", { org_id: other, invoice_ids: [String(soon._id)] });
  assert.equal(r.body.data[0].status, "skipped");
});
