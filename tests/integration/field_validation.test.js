// Input validation: the shared rules (GSTIN with its check letter, PAN, IFSC,
// phone, email, names, dates, amounts) and the request check that applies them
// to every field of every JSON body, with a message that shows the format.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_fieldval$2");
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
const rules = require("../../helpers/fieldRules");

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
const GOOD_GSTIN = "33AAACB2902M1Z0";

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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Validation Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

const ok = (kind, v) => assert.equal(rules.validate(kind, v), null, `${kind} ${v} should be accepted`);
const no = (kind, v, re) => {
  const m = rules.validate(kind, v);
  assert.ok(m, `${kind} ${v} should be refused`);
  if (re) assert.match(m, re);
  return m;
};

test("GSTIN needs the right shape, a real state code and a matching check letter", () => {
  ok("gstin", GOOD_GSTIN);
  ok("gstin", " 33aaacb2902m1z0 ");
  ok("gstin", "27AAPFU0939F1ZV");
  no("gstin", "33AAACB2902M1Z5", /typing mistake/);
  no("gstin", "33AAACB2902M1Z", /15 characters/);
  no("gstin", "99ZZZZZ0000Z1Z1", /./);
  no("gstin", "40AAACB2902M1Z0", /state code/);
  no("gstin", "33ABCDE1234F1Z5", /PAN inside/);
  const m = no("gstin", "nonsense");
  assert.match(m, /Format:/);
  assert.match(m, /33AAACB2902M1Z0/, "shows an example");
  assert.equal(rules.gstinCheckChar("33AAACB2902M1Z"), "0");
});

test("PAN, TAN, IFSC, account, UPI, HSN, Udyam and vehicle numbers", () => {
  ok("pan", "ABCPE1234F");
  ok("pan", "abcpe1234f");
  no("pan", "ABCDE1234F", /Format/);
  no("pan", "ABC1234567");
  ok("tan", "CHEA12345B");
  no("tan", "CHE123456");
  ok("ifsc", "hdfc0001234");
  no("ifsc", "HDFC1001234", /Format/);
  no("ifsc", "HDFC000123");
  ok("account_number", "1234 5678 9012");
  no("account_number", "12345678");
  no("account_number", "12345678901234567890");
  ok("upi", "shop@okhdfcbank");
  no("upi", "shop okhdfc");
  ok("hsn", "9983");
  ok("hsn", "998314");
  no("hsn", "99831");
  no("hsn", "ABCD");
  ok("msme", "udyam-tn-02-0012345");
  no("msme", "UDYAM-TN-2-12345");
  ok("vehicle", "tn09ab1234");
  no("vehicle", "1234");
});

test("email, phone and mobile numbers", () => {
  ok("email", "accounts@example.com");
  ok("email", "a.b+tag@sub.example.co.in");
  no("email", "a@b", /Format: name@domain.com/);
  no("email", "no-at-sign.com");
  no("email", "spaces in@x.com");
  no("email", `${"a".repeat(250)}@x.com`);
  ok("mobile", "9876543210");
  ok("mobile", "+91 98765 43210");
  ok("mobile", "098765 43210");
  ok("mobile", "+44 7911 123456");
  no("mobile", "1234567890", /10-digit/);
  no("mobile", "98765abc00");
  no("mobile", "12345");
  ok("phone", "044-23456789");
  ok("phone", "+1 (415) 555-0100");
  no("phone", "12345", /Format/);
  no("phone", "call me");
});

test("PIN codes are strict for India and lenient elsewhere", () => {
  ok("pincode", "600001");
  ok("pincode", "SW1A 1AA");
  no("pincode", "6");
  assert.equal(rules.validate("pincode", "600001", { country: "India" }), null);
  assert.match(rules.validate("pincode", "012345", { country: "India" }), /6 digits/);
  assert.match(rules.validate("pincode", "6000", { country: "IN" }), /6 digits/);
  assert.equal(rules.validate("pincode", "SW1A 1AA", { country: "United Kingdom" }), null);
});

test("names, places, dates and numbers", () => {
  ok("person_name", "Priya Sharma");
  ok("person_name", "D'Souza-Rao Jr.");
  ok("person_name", "முருகன்");
  no("person_name", "Priya123", /letters/);
  no("person_name", "<b>x</b>");
  no("person_name", "x".repeat(61));
  ok("business_name", "Sri Lakshmi Traders & Co. (P) Ltd");
  ok("business_name", "7Eleven 24x7");
  no("business_name", "<script>alert(1)</script>");
  no("business_name", "---");
  ok("place", "Chennai");
  no("place", "12345");
  ok("date", "2026-11-02");
  ok("date", "02-11-2026");
  ok("date", "2026-11-02T10:00:00.000Z");
  no("date", "2026-02-30", /real calendar date/);
  no("date", "31-04-2026");
  no("date", "tomorrow");
  ok("amount", "1250.50");
  ok("amount", "₹1,25,000.00");
  no("amount", "12.505", /2 decimal places/);
  no("amount", "-5");
  no("amount", "abc");
  ok("quantity", "12.5");
  no("quantity", "1.23456");
  ok("percent", "18");
  no("percent", "101");
  assert.equal(rules.validate("amount", ""), null, "empty is left to each form to require");
});

test("a field is recognised by its name, however it is nested or spelled", () => {
  for (const [name, kind] of [
    ["gst_no", "gstin"], ["gst_in", "gstin"], ["vendor_gst_no", "gstin"], ["gstin", "gstin"], ["pan_no", "pan"], ["email", "email"], ["organization_email", "email"],
    ["contact_persons[0].email", "email"], ["billing_address.zip", "pincode"], ["shipping_address.phone", "phone"], ["mobile", "mobile"], ["phoneNumber", "mobile"],
    ["first_name", "person_name"], ["customer_name", "business_name"], ["company_name", "business_name"], ["hsnCode", "hsn"], ["hsn_or_sac", "hsn"],
    ["due_date", "date"], ["dueDate", "date"], ["ifsc", "ifsc"], ["account_number", "account_number"], ["website", "url"],
  ]) assert.equal(rules.kindForName(name), kind, name);
  for (const free of ["adjustment", "rate", "status", "type", "password", "token", "line_items"]) assert.equal(rules.kindForName(free), null, free);
});

const contact = (extra) => call("post", "/api/v1/contact", { organization_id: org, contact_type: "Customer", contact_name: "Field Test Buyer", company_name: "Field Test Buyer", place_of_contact: "Tamil Nadu", contact_persons: [{ first_name: "Field", email: "buyer@field.test", is_primary_contact: true }], ...extra });

test("a customer is saved with a valid GSTIN, in capitals, and refused with a clear message otherwise", async () => {
  const bad = await contact({ gst_no: "33AAACB2902M1Z5" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /^Gst no: /);
  assert.match(bad.body.message, /Format:/);
  assert.equal(bad.body.field, "gst_no");

  const good = await contact({ contact_name: "Gst Buyer", company_name: "Gst Buyer", gst_no: " 33aaacb2902m1z0 ", pan_no: "abcpe1234f" });
  assert.equal(good.status, 200, good.text);
  const saved = await mongoose.model("Contact").findOne({ contact_name: "Gst Buyer" }).lean();
  assert.equal(saved.gst_no, GOOD_GSTIN);
  assert.equal(saved.pan_no, "ABCPE1234F");
});

test("email, mobile, names and PIN codes are checked on a customer, including nested ones", async () => {
  const email = await contact({ contact_persons: [{ first_name: "Field", email: "not-an-email" }] });
  assert.equal(email.status, 400);
  assert.equal(email.body.field, "contact_persons[0].email");
  assert.match(email.body.message, /valid email/);

  const mobile = await contact({ mobile: "12345" });
  assert.equal(mobile.status, 400);
  assert.match(mobile.body.message, /10-digit mobile/);

  const name = await contact({ contact_persons: [{ first_name: "Field99" }] });
  assert.equal(name.status, 400);
  assert.match(name.body.message, /First name: Enter a valid name/);

  const company = await contact({ company_name: "<script>x</script>" });
  assert.equal(company.status, 400);

  const pin = await contact({ billing_address: { country: "India", zip: "012345" } });
  assert.equal(pin.status, 400);
  assert.equal(pin.body.field, "billing_address.zip");
  assert.match(pin.body.message, /6 digits/);
  const abroad = await contact({ contact_name: "Abroad Buyer", company_name: "Abroad Buyer", billing_address: { country: "United Kingdom", zip: "SW1A 1AA" } });
  assert.equal(abroad.status, 200, abroad.text);
});

test("the GST number of the organisation can be changed, with the same checks", async () => {
  const put = (b) => call("put", `/api/v1/organization/${org}`, b);
  const bad = await put({ gst_in: "33AAACB2902M1Z5" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /Format:/);
  assert.equal((await put({ gst_in: "29ABCDE1234F1Z5" })).status, 400);
  const good = await put({ gst_in: "27aapfu0939f1zv" });
  assert.equal(good.status, 200, good.text);
  assert.equal(good.body.data.gst_in, "27AAPFU0939F1ZV");
  const phone = await put({ phone: "abc" });
  assert.equal(phone.status, 400);
  const email = await put({ organization_email: "bad@" });
  assert.equal(email.status, 400);
  const zip = await put({ country: "India", zip: "99" });
  assert.equal(zip.status, 400);
  const fine = await put({ phone: "044-23456789", organization_email: "office@example.com", country: "India", zip: "600001" });
  assert.equal(fine.status, 200, fine.text);
  // An empty value clears an optional field.
  assert.equal((await put({ gst_in: "" })).status, 200);
});

test("dates and amounts are checked wherever they appear, and sign-in boxes are left alone", async () => {
  const exp = await call("post", `/api/v1/expense/create-expense?org_id=${org}`, { date: "2026-02-30", lineItems: [] });
  assert.equal(exp.status, 400);
  assert.match(exp.body.message, /^Date: /);
  const amt = await call("post", `/api/v1/expense/create-expense?org_id=${org}`, { date: "2026-11-02", tot_amount: "12.505", lineItems: [] });
  assert.equal(amt.status, 400);
  assert.match(amt.body.message, /2 decimal places/);
  // The sign-in "email" box also takes a mobile number.
  const login = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", IP).send({ email: "9000000001", password: "Super@1234" });
  assert.notEqual(login.body.field, "email");
});
