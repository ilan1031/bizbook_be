// Organisation details (website, PAN, tagline), "only this document" details,
// and the Terranova set-up script that must touch that one account alone.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_orgdetails$2");
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
const { applyTerranova } = require("../../scripts/apply-terranova");
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
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Details Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("website, PAN, tagline and contact details are saved and returned, with the format shown when wrong", async () => {
  const put = (b) => call("put", `/api/v1/organization/${org}`, b);
  const good = await put({ trade_name: "  Sri   Lakshmi Traders ", website: "www.example.com", pan_no: "abcpe1234f", tagline: "Manufacturer  &  Distributor", email: "office@example.com", phone: "+91 91596 40239", gst_in: "33AAACB2902M1Z0" });
  assert.equal(good.status, 200, good.text);
  const got = (await call("get", `/api/v1/organization/${org}`)).body.data;
  assert.equal(got.trade_name, "Sri Lakshmi Traders", "optional trade name, tidied");
  assert.equal(got.website, "www.example.com");
  assert.equal(got.pan_no, "ABCPE1234F");
  assert.equal(got.tagline, "Manufacturer & Distributor");
  assert.equal(got.email, "office@example.com");
  assert.equal(got.phone, "+91 91596 40239");
  assert.equal(got.gst_in, "33AAACB2902M1Z0");
  const bad = await put({ pan_no: "ABC12" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /Format: 5 letters, 4 digits, 1 letter/);
  assert.equal((await put({ website: "not a site" })).status, 400);
  assert.equal((await put({ trade_name: "<b>x</b>" })).status, 400);
  assert.equal((await put({ trade_name: "" })).status, 200, "it is optional, and can be cleared");
  assert.equal((await call("get", `/api/v1/organization/${org}`)).body.data.trade_name, "");
  await put({ trade_name: "Sri Lakshmi Traders" });
  assert.equal((await put({ tagline: "<b>x</b>" })).status, 400);
});

test("details for one document are kept apart from the organisation's own", async () => {
  const q = `organization_id=${org}&kind=invoice&doc_id=INV-1`;
  assert.equal((await call("get", `/api/v1/org/doc-overrides?${q}`)).body.data, null);
  const saved = await call("put", "/api/v1/org/doc-overrides", { organization_id: org, kind: "invoice", doc_id: "INV-1", fields: { org_name: "Terranova Finishes", trade_name: "Terranova", phone: "+91 98765 43210", gst_in: "27AAPFU0939F1ZV", ignored: "x" } });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(Object.keys(saved.body.data).sort(), ["gst_in", "org_name", "phone", "trade_name"]);
  const read = await call("get", `/api/v1/org/doc-overrides?${q}`);
  assert.equal(read.body.data.org_name, "Terranova Finishes");
  // The organisation itself is unchanged, and another document is unaffected.
  assert.equal((await call("get", `/api/v1/organization/${org}`)).body.data.org_name, "Details Test Pvt Ltd");
  assert.equal((await call("get", `/api/v1/org/doc-overrides?organization_id=${org}&kind=invoice&doc_id=INV-2`)).body.data, null);
  // Same field checks as the organisation's details.
  const wrong = await call("put", "/api/v1/org/doc-overrides", { organization_id: org, kind: "invoice", doc_id: "INV-1", fields: { gst_in: "33AAACB2902M1Z5" } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /Format:/);
  assert.equal((await call("put", "/api/v1/org/doc-overrides", { organization_id: org, kind: "nonsense", doc_id: "x", fields: { org_name: "A" } })).status, 400);
  assert.equal((await call("put", "/api/v1/org/doc-overrides", { organization_id: org, kind: "invoice", doc_id: "x", fields: {} })).status, 400);
  assert.equal((await call("delete", `/api/v1/org/doc-overrides?${q}`)).status, 200);
  assert.equal((await call("get", `/api/v1/org/doc-overrides?${q}`)).body.data, null);
});

test("changing a document's details needs the template edit permission", () => {
  const user = { role: "user", permissions: { invoices: ["view"] } };
  assert.equal(rbac.checkApiAccess(user, "GET", "/api/v1/org/doc-overrides"), null);
  assert.ok(rbac.checkApiAccess(user, "PUT", "/api/v1/org/doc-overrides"));
  assert.ok(rbac.checkApiAccess(user, "DELETE", "/api/v1/org/doc-overrides"));
  assert.equal(rbac.checkApiAccess({ role: "user", permissions: { invoices: ["view"], templates: ["view", "edit"] } }, "PUT", "/api/v1/org/doc-overrides"), null);
});

test("the Terranova script sets that account's logo and details and leaves everyone else alone", async () => {
  const db = mongoose.connection;
  const users = db.collection("users");
  const orgs = db.collection("organizations");
  const mk = async (email, name, orgId, extra = {}) => {
    const u = await users.insertOne({ email, name, role: "user", status: "active" });
    await orgs.insertOne({ admin_id: u.insertedId, organization_id: orgId, org_name: name, ...extra });
    return u.insertedId;
  };
  await mk("create@terranovafinishes.com", "Terranova Finishes", 900001, { phone: "9000000000" });
  await mk("someone@else.test", "Else Traders", 900002);

  const dry = await applyTerranova({ db, apply: false });
  assert.equal(dry.found, true);
  assert.equal(dry.organisations.length, 1);
  assert.equal((await orgs.findOne({ organization_id: 900001 })).logo, undefined, "a dry run writes nothing");

  const done = await applyTerranova({ db, apply: true });
  assert.equal(done.organisations[0].org_name, "Terranova Finishes");
  const t = await orgs.findOne({ organization_id: 900001 });
  assert.match(t.logo, /^data:image\/png;base64,/);
  assert.equal(t.phone, "9000000000", "a number the owner already typed is kept");
  assert.equal(t.website, "www.terranovafinishes.com");
  assert.equal(t.city, "Coimbatore");
  assert.match(t.tagline, /Microconcrete/);
  assert.equal(t.gst_in, undefined, "the sample GSTIN from the Word file is not stored");
  assert.equal(t.pan_no, undefined);
  const other = await orgs.findOne({ organization_id: 900002 });
  assert.equal(other.logo, undefined);
  assert.equal(other.website, undefined);
  assert.equal(await db.collection("doc_templates").countDocuments({ organization_id: "900002" }), 0);

  const inv = await db.collection("doc_templates").findOne({ organization_id: "900001", type: "invoice" });
  assert.equal(inv.settings.signatory, "T. Vijay Thirumalairajan");
  assert.match(inv.settings.terms, /Subject to Coimbatore jurisdiction/);
  assert.equal(inv.settings.bank.account_name, "Terranova Finishes");
  const quote = await db.collection("doc_templates").findOne({ organization_id: "900001", type: "quote" });
  assert.match(quote.settings.terms, /valid for 15 days/);
  assert.equal(quote.settings.declaration, undefined, "the quote keeps its own wording");

  // Running it again changes nothing the owner may have edited since.
  await db.collection("doc_templates").updateOne({ organization_id: "900001", type: "invoice" }, { $set: { "settings.signatory": "Someone New" } });
  await applyTerranova({ db, apply: true });
  assert.equal((await db.collection("doc_templates").findOne({ organization_id: "900001", type: "invoice" })).settings.signatory, "Someone New");

  assert.equal((await applyTerranova({ db, email: "nobody@nowhere.test", apply: true })).found, false);
});
