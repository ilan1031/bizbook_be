// Notifications: each business's items are its own (organisation in every id,
// nothing from another business), ids survive changes to the numbers, a
// customer payment is notified, and the bell knows whose read state to use.
//
// Runs against its own throwaway database (TEST_DB_URL + "_notifications").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_notifications$2");
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "1";
process.env.SUPERADMIN_EMAIL = "superadmin@test.local";
process.env.SUPERADMIN_PASSWORD = "Super@1234";
process.env.SUPERADMIN_MOBILE = "9000000001";
process.env.LOGIN_OTP_ENABLED = "false";
process.env.EMAIL_USER = ""; // never send real email from tests
process.env.EMAIL_PASS = "";
process.env.RAZORPAY_KEY_ID = ""; // empty, so .env can't fill in real keys
process.env.RAZORPAY_KEY_SECRET = "";

const mongoose = require("mongoose");
const request = require("supertest");

const realLog = console.log;
console.log = () => {}; // the controllers are chatty

const SA_IP = "203.0.113.20";
const OWNER_IP = "10.20.0.2";
const OWNER = {
  companyName: "Second Books Co",
  email: "second-owner@test.local",
  password: "Owner@1234",
  phoneNumber: "9876520002",
  country: "India",
  state: "Tamil Nadu",
  agreeToTerms: true,
};
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

let app;
let saToken;
let ownerToken;
let ownerId;
let orgA; // superadmin's business
let orgB; // the second owner's business
let customerA;
let customerB;
let overdueInvoiceId;

const call = (method, url, { token, ip = SA_IP, body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};
const asSa = (method, url, body) => call(method, url, { token: saToken, body });
const asOwner = (method, url, body) => call(method, url, { token: ownerToken, ip: OWNER_IP, body });
const notifications = async (org, token = saToken, ip = SA_IP) =>
  call("get", `/api/v1/user/notifications?organization_id=${org}`, { token, ip });
const byTitle = (items, re) => items.find((n) => re.test(n.title));
const suffix = (id) => id.slice(id.indexOf(":") + 1);

test.before(async () => {
  const conn = await mongoose.createConnection(process.env.DB_Coll).asPromise();
  await conn.dropDatabase();
  await conn.close();
  app = require("../../app");
  for (let i = 0; i < 100 && mongoose.connection.readyState !== 1; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (let i = 0; i < 50; i++) {
    if (await mongoose.model("user").exists({ role: "superadmin" })) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const res = await call("post", "/api/v1/user/user-login", { ip: SA_IP, body: { email: "superadmin@test.local", password: "Super@1234" } });
  assert.equal(res.status, 200, res.text);
  saToken = res.body.token;
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("two businesses: each has its own organisation in every notification id", async () => {
  const a = await asSa("post", "/api/v1/org/create-organisation", { organizationName: "Alpha Traders", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  assert.equal(a.status, 200, a.text);
  orgA = String(a.body.data?.organization_id || a.body.organization_id);

  // A second owner with a business of their own.
  await call("post", "/api/v1/user/user-register", { ip: OWNER_IP, body: OWNER });
  ownerId = String((await mongoose.model("user").findOne({ email: OWNER.email }).lean())._id);
  const act = await asSa("patch", `/api/v1/admin/users/${ownerId}`, {
    status: "active",
    permissions: {
      home: ["view"], customers: ["view", "create"], invoices: ["view", "create"], paymentsReceived: ["view", "create"],
      bills: ["view"], inventory: ["view"], notifications: ["view"],
    },
  });
  assert.equal(act.status, 200, act.text);
  const login = await call("post", "/api/v1/user/user-login", { ip: OWNER_IP, body: { email: OWNER.email, password: OWNER.password } });
  assert.equal(login.status, 200, login.text);
  ownerToken = login.body.token;
  const b = await asOwner("post", "/api/v1/org/create-organisation", { organizationName: "Beta Stores", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  assert.equal(b.status, 200, b.text);
  orgB = String(b.body.data?.organization_id || b.body.organization_id);
  assert.notEqual(orgA, orgB);

  // The same kind of trouble in both: one draft invoice each.
  for (const [org, token, ip, name] of [[orgA, saToken, SA_IP, "Alpha Cust"], [orgB, ownerToken, OWNER_IP, "Beta Cust"]]) {
    const c = await call("post", "/api/v1/contact", { token, ip, body: {
      organization_id: org, contact_type: "Customer", contact_name: name, company_name: name, place_of_contact: "TN",
    } });
    assert.ok([200, 201].includes(c.status), c.text);
    const customer = await mongoose.model("Contact").findOne({ organization_id: org, contact_name: name }).lean();
    if (org === orgA) customerA = customer; else customerB = customer;
    const d = await call("post", `/api/v1/invoices?org_id=${org}`, { token, ip, body: {
      customer_id: customer.contact_id, customer_name: name, date: daysAgo(1), due_date: daysAgo(-20),
      line_items: [{ item_id: "IT-1", name: "Consulting", quantity: 1, rate: 500 }], sub_total: 500, status: "draft", status_formatted: "Draft",
    } });
    assert.equal(d.status, 201, d.text);
  }

  const na = (await notifications(orgA)).body.data;
  const nb = (await notifications(orgB, ownerToken, OWNER_IP)).body.data;
  assert.ok(na.length && nb.length, JSON.stringify([na, nb]));
  assert.ok(na.every((n) => n.id.startsWith(`${orgA}:`)), JSON.stringify(na.map((n) => n.id)));
  assert.ok(nb.every((n) => n.id.startsWith(`${orgB}:`)), JSON.stringify(nb.map((n) => n.id)));
  assert.equal(na.filter((n) => nb.some((m) => m.id === n.id)).length, 0, "no id is shared by two businesses");
});

test("a business cannot read another business's notifications, and no id gives an empty list", async () => {
  assert.equal((await notifications(orgB)).status, 403, "superadmin does not own org B");
  assert.equal((await notifications(orgA, ownerToken, OWNER_IP)).status, 403, "second owner does not own org A");
  const none = await call("get", "/api/v1/user/notifications", { token: ownerToken, ip: OWNER_IP });
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.data.filter((n) => n.id.includes(`${orgA}:`)), []);
});

test("ids keep the same suffix when the numbers change, and carry no counts or amounts", async () => {
  const inv = await asSa("post", `/api/v1/invoices?org_id=${orgA}`, {
    customer_id: customerA.contact_id, customer_name: customerA.contact_name, date: daysAgo(40), due_date: daysAgo(30),
    line_items: [{ item_id: "IT-2", name: "Repair", quantity: 1, rate: 1000 }], sub_total: 1000, status: "sent", status_formatted: "Sent",
  });
  assert.equal(inv.status, 201, inv.text);
  overdueInvoiceId = inv.body.data?.invoice_id || (await mongoose.model("Invoice").findOne({ organization_id: orgA, customer_id: customerA.contact_id, status: "sent" }).lean()).invoice_id;

  const before = byTitle((await notifications(orgA)).body.data, /overdue invoice/);
  assert.ok(before, "overdue item present");
  assert.match(before.title, /1,000\.00/);

  const pay = await asSa("post", `/api/v1/payment/customerpayments?organization_id=${orgA}`, {
    formType: "Invoice Payment", amount: 300, payment_mode: "Bank Transfer", deposite_to: "Petty Cash", date: today,
    customer_id: customerA.contact_id, customer_name: customerA.contact_name,
    invoices: [{ invoice_id: overdueInvoiceId, amount_applied: 300 }],
  });
  assert.equal(pay.status, 200, pay.text);

  const after = byTitle((await notifications(orgA)).body.data, /overdue invoice/);
  assert.match(after.title, /700\.00/, "the title shows the new balance");
  assert.equal(after.id, before.id, "the id did not change with the amount");
  assert.equal(suffix(after.id), "overdue-invoices", "the id names the event type");
  assert.doesNotMatch(suffix(before.id), /\d/, "no counts or amounts in the id");
});

test("a customer payment is notified with its amount, payer, date and a link to the payment", async () => {
  const items = (await notifications(orgA)).body.data;
  const paid = byTitle(items, /received from/);
  assert.ok(paid, JSON.stringify(items.map((n) => n.title)));
  assert.equal(paid.title, `₹300.00 received from ${customerA.contact_name}`);
  assert.equal(paid.severity, "success");
  assert.ok(paid.date, "the payment has a date");
  const payment = await mongoose.model("CustomerPayment").findOne({ organization_id: String(orgA), amount: 300 }).lean();
  assert.ok(payment?.payment_id, "payment record exists");
  assert.equal(paid.id, `${orgA}:payment-${payment.payment_id}`, "one id per payment");
  assert.equal(paid.href, `/sales/paymentsReceived/${payment.payment_id}`);
  assert.match(paid.detail, new RegExp(payment.payment_id));
});

test("payments are not shared between businesses", async () => {
  const items = (await notifications(orgB, ownerToken, OWNER_IP)).body.data;
  assert.equal(byTitle(items, /received from/), undefined, "Beta has no payment, so none is shown");
});

test("a payment that was voided no longer shows", async () => {
  const pay = await mongoose.model("CustomerPayment").findOne({ organization_id: String(orgA), amount: 300 }).lean();
  await mongoose.model("CustomerPayment").updateOne({ _id: pay._id }, { $set: { deleted_at: new Date(), is_deleted: true } });
  const items = (await notifications(orgA)).body.data;
  assert.equal(byTitle(items, /received from/), undefined);
});

test("the signed-in person's id is returned, to scope the bell's read state per user", async () => {
  const me = await call("get", "/api/v1/user/me", { token: ownerToken, ip: OWNER_IP });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.data.id, ownerId);
});
