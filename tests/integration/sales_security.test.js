// Sales security: customer-portal logins are scoped to their own customer and
// organisation (SALES-1), path-only routes for payments and contact persons
// are scoped to the caller's organisations (SALES-2), and comments are stored
// as plain text (SALES-3). Also the sales input checks (SALES-6/10/22).
//
// Runs against its own throwaway database (TEST_DB_URL + "_sales").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_sales$2");
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
const jwt = require("jsonwebtoken");

const realLog = console.log;
console.log = () => {};

let app;
let saToken; // owns org A
let bToken; // another business, owns org B
let orgA;
let orgB;
let custA; // portal customer in org A
let custA2; // another customer in org A
let custB; // customer in org B
let portalToken;
const SA_IP = "203.0.113.20";
const B_IP = "10.20.0.2";

const call = (method, url, { token, ip = SA_IP, body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};
const asA = (method, url, body) => call(method, url, { token: saToken, body });
const asB = (method, url, body) => call(method, url, { token: bToken, ip: B_IP, body });
const asPortal = (method, url, body) => call(method, url, { token: portalToken, ip: "10.20.0.9", body });

const newCustomer = async (as, org, name, email) => {
  const r = await as("post", "/api/v1/contact", {
    organization_id: org,
    contact_type: "Customer",
    contact_name: name,
    company_name: name,
    place_of_contact: "Tamil Nadu",
    contact_persons: [{ first_name: name, email, is_primary_contact: true }],
  });
  assert.ok(r.status < 300, r.text);
  return r.body.data.contact_id;
};
const newQuote = async (as, org, customer_id, status, name = "Pen") => {
  const r = await as("post", `/api/v1/estimates?organization_id=${org}`, {
    organization_id: org,
    customer_id,
    date: "2026-11-02",
    expiry_date: "2026-11-30",
    place_of_supply: "Tamil Nadu",
    status,
    status_formatted: status,
    line_items: [{ name, quantity: 1, rate: 100, gst_rate: 18 }],
  });
  assert.equal(r.status, 201, r.text);
  return r.body.data.msg.quote_id;
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
  const l = await call("post", "/api/v1/user/user-login", { body: { email: "superadmin@test.local", password: "Super@1234" } });
  assert.equal(l.status, 200, l.text);
  saToken = l.body.token;
  const o = await asA("post", "/api/v1/org/create-organisation", { organizationName: "Seller A", country: "India", state: "Tamil Nadu", industry_name: "IT" });
  orgA = String(o.body.data?.organization_id || o.body.organization_id);

  const B = { companyName: "B Co", email: "b@test.local", password: "Bpass@1234", phoneNumber: "9123456780", country: "India", state: "Kerala", agreeToTerms: true };
  await call("post", "/api/v1/user/user-register", { ip: B_IP, body: B });
  const bId = String((await mongoose.model("user").findOne({ email: B.email }).lean())._id);
  const all = ["view", "create", "edit", "delete"];
  await asA("patch", `/api/v1/admin/users/${bId}`, {
    status: "active",
    permissions: { customers: all, quotes: all, invoices: all, paymentsReceived: all },
  });
  const bl = await call("post", "/api/v1/user/user-login", { ip: B_IP, body: { email: B.email, password: B.password } });
  assert.equal(bl.status, 200, bl.text);
  bToken = bl.body.token;
  const ob = await asB("post", "/api/v1/org/create-organisation", { organizationName: "Seller B", country: "India", state: "Kerala", industry_name: "IT" });
  orgB = String(ob.body.data?.organization_id || ob.body.organization_id);

  custA = await newCustomer(asA, orgA, "Portal Customer", "portal@test.local");
  custA2 = await newCustomer(asA, orgA, "Other Customer", "other@test.local");
  custB = await newCustomer(asB, orgB, "B Customer", "bcust@test.local");

  const client = await mongoose.model("clients").create({ email: "portal@test.local", password: "x", role: "client", status: "active", client_id: custA });
  portalToken = jwt.sign({ userId: client._id, role: "client" }, process.env.JWT_SECRET);
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("SALES-1: a portal login sees only its own non-draft quotes", async () => {
  const draft = await newQuote(asA, orgA, custA, "draft");
  const sent = await newQuote(asA, orgA, custA, "sent");
  await newQuote(asA, orgA, custA2, "sent", "Other customer's item");

  // No ids needed: the server takes them from the login.
  const list = await asPortal("get", "/api/v1/clientestimates?filter=all");
  assert.equal(list.status, 200, list.text);
  const ids = list.body.estimates.map((q) => q.quote_id);
  assert.ok(ids.includes(sent));
  assert.ok(!ids.includes(draft), "drafts are never shown in the portal");
  assert.ok(list.body.estimates.every((q) => q.customer_id === custA));
  assert.ok(list.body.estimates.every((q) => /^QT-/.test(q.estimate_number)), "every quote has a number");

  // Naming another customer or organisation is refused.
  assert.equal((await asPortal("get", `/api/v1/clientestimates?customer_id=${custA2}`)).status, 403);
  assert.equal((await asPortal("get", `/api/v1/clientestimates?organization_id=${orgB}&customer_id=${custB}`)).status, 403);
  // A draft is not reachable by id either.
  assert.equal((await asPortal("get", `/api/v1/clientestimates/${draft}`)).status, 404);

  const detail = await asPortal("get", `/api/v1/clientestimates/${sent}`);
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.body.organization.org_name, "Seller A", "the seller comes from the real organisation");
  assert.equal(detail.body.customer.contact_name, "Portal Customer");
});

test("SALES-1: a portal login can't accept, decline or comment on other customers' quotes", async () => {
  const other = await newQuote(asA, orgA, custA2, "sent");
  const foreign = await newQuote(asB, orgB, custB, "sent");
  const own = await newQuote(asA, orgA, custA, "sent");

  assert.equal((await asPortal("put", `/api/v1/clientestimates/accepted?quote_id=${other}`, {})).status, 404);
  assert.equal((await asPortal("put", `/api/v1/clientestimates/accepted?organization_id=${orgB}&quote_id=${foreign}&customer_id=${custA}`, {})).status, 403);
  assert.equal((await asPortal("put", `/api/v1/clientestimates/comment/${other}`, { description: "hi" })).status, 404);
  const Estimate = mongoose.model("Estimate");
  assert.equal((await Estimate.findOne({ quote_id: other }).lean()).status, "sent");
  assert.equal((await Estimate.findOne({ quote_id: foreign }).lean()).status, "sent");

  // Their own sent quote: decline needs a reason, then works.
  assert.equal((await asPortal("put", `/api/v1/clientestimates/declined?quote_id=${own}`, { description: "" })).status, 400);
  const d = await asPortal("put", `/api/v1/clientestimates/declined?quote_id=${own}`, { description: "Too costly <script>alert(1)</script>" });
  assert.equal(d.status, 200, d.text);
  const saved = await Estimate.findOne({ quote_id: own }).lean();
  assert.equal(saved.status, "declined");
  const reason = saved.comments.find((c) => c.comment_type === "client");
  assert.equal(reason.description, "Too costly alert(1)", "stored as plain text");

  // A business login can't use the portal endpoints.
  assert.equal((await asA("get", "/api/v1/clientestimates")).status, 403);
});

test("SALES-2: another business can't read or change payments and contact persons", async () => {
  const persons = await asA("get", `/api/v1/contact-person/${custA}?organization_id=${orgA}`);
  assert.equal(persons.status, 200, persons.text);
  const cp = persons.body.data[0];

  assert.equal((await asB("get", `/api/v1/individual-contact-person/${cp.contact_person_id}`)).status, 404);
  assert.equal((await asB("get", `/api/v1/contact-person/${custA}?organization_id=${orgB}`)).status, 404);
  assert.equal((await asB("get", `/api/v1/contact-person/${custA}`)).status, 404);
  assert.equal((await asB("put", `/api/v1/contact-person/${cp.contact_person_id}`, { first_name: "HACKED" })).status, 404);
  assert.equal(
    (await asB("put", `/api/v1/contact-person/${cp.contact_person_id}/make-primary`, { organization_id: orgB, contact_id: custA })).status,
    404
  );
  assert.equal((await asB("delete", `/api/v1/contact-person/${cp.contact_person_id}`)).status, 404);
  assert.equal((await asB("put", `/api/v1/contact?contact_id=${custA}&organization_id=${orgB}`, { contact_name: "HACKED" })).status, 404);
  const after = await mongoose.model("contactDetails").findOne({ contact_person_id: cp.contact_person_id }).lean();
  assert.notEqual(after?.first_name, "HACKED");
  assert.notEqual((await mongoose.model("Contact").findOne({ contact_id: custA }).lean()).contact_name, "HACKED");

  // The owner still can.
  assert.equal((await asA("get", `/api/v1/individual-contact-person/${cp.contact_person_id}`)).status, 200);
  assert.equal((await asA("put", `/api/v1/contact-person/${cp.contact_person_id}`, { designation: "Owner" })).status, 200);

  // Payments are scoped to the organisation in the request.
  await mongoose.model("CustomerPayment").create({ payment_id: "PR-SEC-1", organization_id: orgA, customer_id: custA, amount: 10 });
  assert.equal((await asB("get", `/api/v1/payment/individual?organization_id=${orgB}&payment_id=PR-SEC-1`)).status, 404);
  assert.equal((await asA("get", `/api/v1/payment/individual?organization_id=${orgA}&payment_id=PR-SEC-1`)).status, 200);
});

test("SALES-3: customer comments are stored and returned as plain text", async () => {
  const add = await asA("post", `/api/v1/contact/comments?contact_id=${custA}&organization_id=${orgA}`, {
    description: 'Call back <img src=x onerror="alert(1)"> soon & a < b',
  });
  assert.equal(add.status, 201, add.text);
  assert.equal(add.body.data.description, "Call back  soon & a < b");
  assert.equal((await asA("post", `/api/v1/contact/comments?contact_id=${custA}&organization_id=${orgA}`, { description: "<b></b>" })).status, 400);
  assert.equal((await asB("post", `/api/v1/contact/comments?contact_id=${custA}&organization_id=${orgB}`, { description: "x" })).status, 404);

  // Comments saved through the customer update are cleaned too, and the
  // update doesn't wipe the addresses.
  await asA("put", `/api/v1/contact?contact_id=${custA}&organization_id=${orgA}`, { billing_address: { city: "Chennai" } });
  const put = await asA("put", `/api/v1/contact?contact_id=${custA}&organization_id=${orgA}`, {
    comments: [{ description: "<script>alert(2)</script>hello" }],
  });
  assert.equal(put.status, 200, put.text);
  const c = await asA("get", `/api/v1/vendors/comments?contact_id=${custA}&organization_id=${orgA}`);
  assert.ok(c.body.data.every((x) => !/[<>]/.test(x.description.replace(" a < b", ""))), JSON.stringify(c.body.data));
  const contact = await mongoose.model("Contact").findOne({ contact_id: custA }).lean();
  assert.equal(contact.billing_address?.city, "Chennai");
});

test("SALES-6/10/22: invoices are validated and numbered per organisation", async () => {
  const post = (body) => asA("post", `/api/v1/invoices?org_id=${orgA}`, { customer_id: custA, date: "2026-11-02", place_of_supply: "Tamil Nadu", ...body });
  const line = { name: "Pen", quantity: 1, rate: 100, gst_rate: 18 };
  assert.equal((await post({ line_items: [] })).status, 400);
  assert.equal((await post({ customer_id: "", line_items: [line] })).status, 400);
  assert.equal((await post({ line_items: [{ ...line, quantity: -3 }] })).status, 400);
  assert.equal((await post({ line_items: [{ ...line, quantity: 999999999999 }] })).status, 400);
  const early = await post({ due_date: "2026-10-01", line_items: [line] });
  assert.equal(early.status, 400);
  assert.match(early.body.message, /Due date/);

  // The number the form shows is the one saved; a taken number is refused.
  const next = await asA("get", `/api/v1/invoice-id?organization_id=${orgA}`);
  const ok = await post({ invoice_number: next.body.data, line_items: [line] });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.data.invoice_number, next.body.data);
  assert.equal((await post({ invoice_number: next.body.data, line_items: [line] })).status, 409);
  // Another organisation starts its own sequence.
  const nextB = await asB("get", `/api/v1/invoice-id?organization_id=${orgB}`);
  assert.match(nextB.body.data, /000001$/);
});

test("SALES-11: a paid invoice can't be voided or deleted", async () => {
  const inv = await asA("post", `/api/v1/invoices?org_id=${orgA}`, {
    customer_id: custA,
    date: "2026-11-02",
    status: "sent",
    line_items: [{ name: "Pen", quantity: 1, rate: 100, gst_rate: 0 }],
  });
  const id = inv.body.data.invoice_id;
  await mongoose.model("Invoice").updateOne({ invoice_id: id }, { $set: { payment_made: 100, balance: 0, status: "paid" } });
  assert.equal((await asA("put", `/api/v1/invoices/status?organization_id=${orgA}&invoice_id=${id}`, { status: "void", status_formatted: "Void" })).status, 400);
  assert.equal((await asA("delete", `/api/v1/invoices?org_id=${orgA}&invoice_id=${id}`)).status, 400);
  // And its customer can't be deleted while it has invoices.
  assert.equal((await asA("delete", `/api/v1/contact?organization_id=${orgA}&contact_id=${custA}`)).status, 400);
});
