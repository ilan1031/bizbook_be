// Payment links: a link is made for an unpaid invoice, and Razorpay's signed
// webhook records the payment against it exactly once.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_paylinks$2");
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
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test_123";

const mongoose = require("mongoose");
const request = require("supertest");

const realLog = console.log;
console.log = () => {};

let app;
let token;
let org;
let customer;
let invoice;
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
const razorpay = require("../../helpers/razorpayClient");
let linkSeq = 0;
const cancelled = [];
const fake = {
  paymentLink: {
    create: async (p) => {
      linkSeq += 1;
      fake.last = p;
      return { id: `plink_${linkSeq}`, short_url: `https://rzp.io/i/test${linkSeq}` };
    },
    cancel: async (id) => cancelled.push(id),
  },
};
const webhook = (event, linkId, amountPaise, { sign = true, status = "captured" } = {}) => {
  const body = JSON.stringify({ event, payload: { payment_link: { entity: { id: linkId } }, payment: { entity: { id: "pay_1", amount: amountPaise, status } } } });
  const sig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
  return request(app).post("/api/v1/webhooks/razorpay").set("Content-Type", "application/json").set("X-Razorpay-Signature", sign ? sig : "bad").send(body);
};
const makeInvoice = async (rate) => {
  const r = await call("post", `/api/v1/invoices?org_id=${org}`, { customer_id: customer, date: "2026-11-02", status: "sent", place_of_supply: "Tamil Nadu", line_items: [{ name: "Service", quantity: 1, rate, gst_rate: 0 }] });
  assert.equal(r.status, 201, r.text);
  return r.body.data;
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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Links Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  const c = await call("post", "/api/v1/contact", { organization_id: org, contact_type: "Customer", contact_name: "Link Buyer", company_name: "Link Buyer", place_of_contact: "Tamil Nadu", contact_persons: [{ first_name: "Link", email: "buyer@links.test", is_primary_contact: true }] });
  assert.ok(c.status < 300, c.text);
  customer = c.body.data.contact_id;
  invoice = await makeInvoice(1000);
});

test.after(async () => {
  console.log = realLog;
  razorpay.setClient(null);
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("without Razorpay keys a link can't be made", async () => {
  const r = await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: invoice.invoice_id });
  assert.equal(r.status, 503);
  assert.match(r.body.message, /aren't set up/);
});

test("a link is made for the invoice balance, once at a time", async () => {
  razorpay.setClient(fake);
  const avail = await call("get", `/api/v1/payment-links/invoices?org_id=${org}`);
  assert.ok(avail.body.data.some((i) => i.invoice_id === invoice.invoice_id));
  assert.equal((await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: invoice.invoice_id, amount: 0.5 })).status, 400);
  assert.equal((await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: invoice.invoice_id, amount: 5000 })).status, 400);
  assert.equal((await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: "nope" })).status, 404);
  const r = await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: invoice.invoice_id });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.amount, 1000);
  assert.equal(fake.last.amount, 100000);
  assert.equal(r.body.data.short_url, "https://rzp.io/i/test1");
  const again = await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: invoice.invoice_id });
  assert.equal(again.status, 400);
  assert.match(again.body.message, /already has a payment link/);
});

test("the webhook refuses a bad signature and a wrong amount", async () => {
  assert.equal((await webhook("payment_link.paid", "plink_1", 100000, { sign: false })).status, 400);
  assert.equal((await webhook("payment_link.paid", "plink_1", 5000)).status, 400);
  const inv = await mongoose.model("Invoice").findOne({ invoice_id: invoice.invoice_id }).lean();
  assert.equal(inv.balance, 1000);
  const link = await mongoose.model("PaymentLink").findOne({ razorpay_link_id: "plink_1" }).lean();
  assert.equal(link.status, "created");
});

test("a paid webhook records the payment against the invoice, once", async () => {
  const r = await webhook("payment_link.paid", "plink_1", 100000);
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.message, /recorded/);
  const inv = await mongoose.model("Invoice").findOne({ invoice_id: invoice.invoice_id }).lean();
  assert.equal(inv.balance, 0);
  const payments = await mongoose.model("CustomerPayment").find({ organization_id: org }).lean();
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount, 1000);
  assert.equal(payments[0].payment_status, "completed");
  const link = await mongoose.model("PaymentLink").findOne({ razorpay_link_id: "plink_1" }).lean();
  assert.equal(link.status, "paid");
  assert.equal(link.razorpay_payment_id, "pay_1");
  // Razorpay retries: nothing is recorded twice.
  const again = await webhook("payment_link.paid", "plink_1", 100000);
  assert.equal(again.status, 200);
  assert.equal(await mongoose.model("CustomerPayment").countDocuments({ organization_id: org }), 1);
});

test("a paid invoice gets no new link, and a partial link records a part payment", async () => {
  assert.equal((await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: invoice.invoice_id })).status, 400);
  const inv2 = await makeInvoice(2000);
  const r = await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: inv2.invoice_id, amount: 500 });
  assert.equal(r.status, 201, r.text);
  assert.equal((await webhook("payment_link.paid", "plink_2", 50000)).status, 200);
  const after = await mongoose.model("Invoice").findOne({ invoice_id: inv2.invoice_id }).lean();
  assert.equal(after.balance, 1500);
});

test("a waiting link can be cancelled; expiry events update the list", async () => {
  const inv3 = await makeInvoice(300);
  const made = await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: inv3.invoice_id });
  const id = made.body.data._id;
  const del = await call("delete", `/api/v1/payment-links/${id}?org_id=${org}`);
  assert.equal(del.status, 200, del.text);
  assert.deepEqual(cancelled, [made.body.data.razorpay_link_id]);
  assert.equal((await call("delete", `/api/v1/payment-links/${id}?org_id=${org}`)).status, 400);
  const next = await call("post", "/api/v1/payment-links", { org_id: org, invoice_id: inv3.invoice_id });
  assert.equal(next.status, 201);
  assert.equal((await webhook("payment_link.expired", next.body.data.razorpay_link_id, 0)).status, 200);
  const list = await call("get", `/api/v1/payment-links?org_id=${org}&invoice_id=${inv3.invoice_id}`);
  assert.deepEqual(list.body.data.map((l) => l.status).sort(), ["cancelled", "expired"]);
});

test("another organisation cannot see or cancel these links", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Links Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  assert.equal((await call("get", `/api/v1/payment-links?org_id=${other}`)).body.data.length, 0);
  const mine = await mongoose.model("PaymentLink").findOne({ razorpay_link_id: "plink_2" }).lean();
  assert.equal((await call("delete", `/api/v1/payment-links/${mine._id}?org_id=${other}`)).status, 404);
  assert.equal((await call("post", "/api/v1/payment-links", { org_id: other, invoice_id: invoice.invoice_id })).status, 404);
});
