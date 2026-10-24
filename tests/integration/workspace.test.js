// Top-bar features and the other endpoints added with them: global search,
// notifications, the user's own profile and password, record imports, the
// customer portal's own-contact access, and purchase-order update guards.
//
// Runs against its own throwaway database (TEST_DB_URL + "_workspace").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_workspace$2");
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "1";
process.env.SUPERADMIN_EMAIL = "superadmin@test.local";
process.env.SUPERADMIN_PASSWORD = "Super@1234";
process.env.SUPERADMIN_MOBILE = "9000000001";
process.env.LOGIN_OTP_ENABLED = "false";
process.env.EMAIL_USER = ""; // never send real email from tests
process.env.EMAIL_PASS = "";
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";

const mongoose = require("mongoose");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const realLog = console.log;
console.log = () => {};

let app;
let saToken;
let org;
let customer;
let userToken;
let userId;
let userOrg;
const SA_IP = "203.0.113.9";
const USER_IP = "10.9.0.1";
const USER = {
  companyName: "Search Co",
  email: "searcher@test.local",
  password: "User@1234",
  phoneNumber: "9876501234",
  country: "India",
  state: "Tamil Nadu",
  agreeToTerms: true,
};

const call = (method, url, { token, ip = SA_IP, body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};
const asSa = (method, url, body) => call(method, url, { token: saToken, body });
const asUser = (method, url, body) => call(method, url, { token: userToken, ip: USER_IP, body });
const login = (creds, ip) => call("post", "/api/v1/user/user-login", { ip, body: creds });

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
  const res = await login({ email: "superadmin@test.local", password: "Super@1234" }, SA_IP);
  assert.equal(res.status, 200, res.text);
  saToken = res.body.token;

  const o = await asSa("post", "/api/v1/org/create-organisation", {
    organizationName: "Workspace Test Pvt Ltd",
    country: "India",
    state: "Tamil Nadu",
    industry_name: "IT",
  });
  assert.equal(o.status, 200, o.text);
  org = String(o.body.data?.organization_id || o.body.organization_id);
  const createdOrg = await mongoose.model("Organization").findOne({ organization_id: org }).lean();
  assert.equal(createdOrg.industry_type, "IT");
  assert.equal(createdOrg.fiscal_year_start_month, "APRIL");
  assert.equal(createdOrg.language_code, "EN");
  assert.equal(createdOrg.theme, "primary");

  await asSa("post", "/api/v1/contact", {
    organization_id: org,
    contact_type: "Customer",
    contact_name: "Kumar Traders",
    company_name: "Kumar Traders",
    email: "kumar@example.com",
  });
  customer = await mongoose.model("Contact").findOne({ organization_id: org, contact_type: "Customer" }).lean();
  assert.ok(customer?.contact_id);

  // An invoice that fell due last week.
  const past = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const inv = await asSa("post", `/api/v1/invoices?org_id=${org}`, {
    customer_id: customer.contact_id,
    customer_name: customer.contact_name,
    date: past,
    due_date: past,
    line_items: [{ item_id: "IT-1", name: "Consulting", quantity: 1, rate: 2500 }],
    sub_total: 2500,
    status: "sent",
    status_formatted: "Sent",
  });
  assert.equal(inv.status, 201, inv.text);
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("search finds customers and documents, with links to their pages", async () => {
  const r = await asSa("get", `/api/v1/user/search?organization_id=${org}&q=kum`);
  assert.equal(r.status, 200, r.text);
  const groups = new Set(r.body.data.map((x) => x.group));
  assert.ok(groups.has("Customers"));
  assert.ok(groups.has("Invoices"));
  const c = r.body.data.find((x) => x.type === "customer");
  assert.equal(c.href, `/sales/customer/${customer.contact_id}`);
  assert.ok(r.body.data.every((x) => x.href.startsWith("/") && !/undefined/.test(x.href)));
});

test("search needs two characters, treats input as text, and requires an organisation", async () => {
  assert.deepEqual((await asSa("get", `/api/v1/user/search?organization_id=${org}&q=k`)).body.data, []);
  const weird = await asSa("get", `/api/v1/user/search?organization_id=${org}&q=${encodeURIComponent(".*(")}`);
  assert.equal(weird.status, 200);
  assert.deepEqual(weird.body.data, []);
  assert.equal((await asSa("get", "/api/v1/user/search?q=kum")).status, 400);
});

test("notifications report overdue invoices", async () => {
  const r = await asSa("get", `/api/v1/user/notifications?organization_id=${org}`);
  assert.equal(r.status, 200, r.text);
  const overdue = r.body.data.find((n) => /overdue invoice/.test(n.title));
  assert.ok(overdue, JSON.stringify(r.body.data));
  assert.equal(overdue.severity, "error");
  assert.match(overdue.title, /2,500/);
});

test("a user with only Customers sees customers but no invoices, and only in their own organisation", async () => {
  await call("post", "/api/v1/user/user-register", { ip: USER_IP, body: USER });
  userId = String((await mongoose.model("user").findOne({ email: USER.email }).lean())._id);
  const a = await asSa("patch", `/api/v1/admin/users/${userId}`, {
    status: "active",
    permissions: { customers: ["view", "create"], globalSearch: ["view"], notifications: ["view"] },
  });
  assert.equal(a.status, 200, a.text);
  const l = await login({ email: USER.email, password: USER.password }, USER_IP);
  assert.equal(l.status, 200, l.text);
  userToken = l.body.token;

  // Another company's organisation is refused outright.
  assert.equal((await asUser("get", `/api/v1/user/search?organization_id=${org}&q=kum`)).status, 403);

  const o = await asUser("post", "/api/v1/org/create-organisation", {
    organizationName: "Searcher Org",
    country: "India",
    state: "Kerala",
    industry_name: "IT",
  });
  assert.equal(o.status, 200, o.text);
  userOrg = String(o.body.data?.organization_id || o.body.organization_id);
  await mongoose.model("Contact").create({
    contact_id: "CU-W1",
    organization_id: userOrg,
    admin_id: userId,
    contact_type: "Customer",
    contact_name: "Kumaran Stores",
  });
  await mongoose.model("Invoice").create({
    invoice_id: "W-INV-1",
    invoice_number: "INV-KUM-1",
    organization_id: userOrg,
    admin_id: userId,
    customer_name: "Kumaran Stores",
    status: "sent",
    total: 100,
    balance: 100,
  });
  const r = await asUser("get", `/api/v1/user/search?organization_id=${userOrg}&q=kum`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data.map((x) => x.type), ["customer"]);

  const n = await asUser("get", `/api/v1/user/notifications?organization_id=${userOrg}`);
  assert.equal(n.status, 200);
  assert.ok(!n.body.data.some((x) => /invoice/i.test(x.title)), "no invoice alerts without the Invoices page");
});

test("profile can be read and updated", async () => {
  const r = await asUser("get", "/api/v1/user/profile");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.email, USER.email);
  assert.equal(r.body.data.password, undefined);
  assert.equal(r.body.data.devices.length, 1);
  assert.equal(r.body.data.devices[0].ip, USER_IP);

  assert.equal((await asUser("patch", "/api/v1/user/profile", { mobile: "12" })).status, 400);
  const profileImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lJ8AAAAASUVORK5CYII=";
  const u = await asUser("patch", "/api/v1/user/profile", {
    company_name: "Search Co Ltd",
    profile_image: profileImage,
    role: "superadmin",
  });
  assert.equal(u.status, 200, u.text);
  const user = await mongoose.model("user").findById(userId).lean();
  assert.equal(user.company_name, "Search Co Ltd");
  assert.equal(user.profile_image, profileImage);
  assert.equal(user.role, "user", "profile updates can't change the role");
  assert.equal((await asUser("get", "/api/v1/user/profile")).body.data.profile_image, profileImage);
  assert.equal(
    (await asUser("patch", "/api/v1/user/profile", { profile_image: "data:image/svg+xml;base64,PHN2Zz4=" })).status,
    400
  );
});

test("organization profile image can be read, updated and persisted", async () => {
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lJ8AAAAASUVORK5CYII=";
  const updated = await asSa("put", `/api/v1/organization/${org}`, {
    org_image: image,
    phone: "+1 (408) 555-1212",
    zip: "",
  });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.body.data.org_image, image);
  assert.equal(updated.body.data.phone, 14085551212);

  const fetched = await asSa("get", `/api/v1/organization/${org}`);
  assert.equal(fetched.status, 200, fetched.text);
  assert.equal(fetched.body.data.org_image, image);
  const stored = await mongoose.model("Organization").findOne({ organization_id: org }).lean();
  assert.equal(stored.org_image, image);
  assert.match(stored.org_image, /^data:image\/png;base64,/);

  const invalid = await asSa("put", `/api/v1/organization/${org}`, {
    org_image: "data:image/svg+xml;base64,PHN2Zz4=",
  });
  assert.equal(invalid.status, 400);
});

test("password change checks the current password and the rules", async () => {
  const wrong = await asUser("post", "/api/v1/user/change-password", { current_password: "Nope@1234", new_password: "Better@5678" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /incorrect/);
  const weak = await asUser("post", "/api/v1/user/change-password", { current_password: USER.password, new_password: "weak" });
  assert.equal(weak.status, 400);
  const ok = await asUser("post", "/api/v1/user/change-password", { current_password: USER.password, new_password: "Better@5678" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await login({ email: USER.email, password: USER.password }, USER_IP)).status, 400, "old password no longer works");
  assert.equal((await login({ email: USER.email, password: "Better@5678" }, USER_IP)).status, 200);
});

test("customers import skips duplicates and reports bad rows", async () => {
  const cols = await asUser("get", "/api/v1/import/get-column?moduleName=customers");
  assert.equal(cols.status, 200, cols.text);
  assert.ok(cols.body.data.includes("contact_name"));

  const r = await asUser("post", `/api/v1/import/customers?org_id=${userOrg}`, [
    { contact_name: "Imported One", email: "one@example.com", phone: "9000000000" },
    { contact_name: "imported one" },
    { contact_name: "Kumaran Stores" },
    { email: "noname@example.com" },
    { contact_name: "Bad Mail", email: "not-an-email" },
  ]);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(
    { inserted: r.body.data.inserted, skipped: r.body.data.skipped, errors: r.body.data.errors.length },
    { inserted: 1, skipped: 2, errors: 2 }
  );
  const c = await mongoose.model("Contact").findOne({ organization_id: userOrg, contact_name: "Imported One" }).lean();
  assert.equal(c.contact_type, "Customer");
  assert.equal(String(c.admin_id), userId);
  assert.ok(c.contact_id);
});

test("imports follow page permissions", async () => {
  // This user may create customers but not items or vendors.
  assert.equal((await asUser("post", `/api/v1/import/items?org_id=${userOrg}`, [{ name: "X" }])).status, 403);
  assert.equal((await asUser("post", `/api/v1/import/vendors?org_id=${userOrg}`, [{ contact_name: "X" }])).status, 403);
  assert.equal((await asUser("post", `/api/v1/import/customers?org_id=${org}`, [{ contact_name: "X" }])).status, 403);

  const items = await asSa("post", `/api/v1/import/items?org_id=${org}`, [
    { name: "Laptop", rate: "₹45,000.50", item_type: "Goods", unit: "Nos" },
    { name: "Support", rate: "1200", item_type: "Service" },
  ]);
  assert.equal(items.status, 200, items.text);
  assert.equal(items.body.data.inserted, 2);
  const laptop = await mongoose.model("Item").findOne({ organization_id: org, name: "Laptop" }).lean();
  assert.equal(laptop.rate, 45000.5);
  const support = await mongoose.model("Item").findOne({ organization_id: org, name: "Support" }).lean();
  assert.equal(support.item_type, "service");
});

test("updating a purchase order that doesn't exist is a 404, not a crash", async () => {
  const r = await asSa("put", `/api/v1/purchase-orders/update-individual-purchase-order?org_id=${org}&po_id=PO-NOPE`, {
    total: 10,
  });
  assert.equal(r.status, 404, r.text);
});

test("the portal sign-in page can read only the organisation's name without a token", async () => {
  const r = await request(app).get(`/api/v1/organization/${org}`);
  assert.equal(r.status, 200, r.text);
  assert.ok(Object.keys(r.body.data).every((k) => ["organization_id", "org_name", "portal_name"].includes(k)));
  assert.equal(r.body.data.org_name, "Workspace Test Pvt Ltd");
  assert.equal(r.body.data.admin_id, undefined);
  assert.equal((await request(app).get("/api/v1/organization/999999")).status, 404);
});

test("a portal sign-in can read its own contact and check its token, nothing else", async () => {
  const client = await mongoose.model("clients").create({
    email: "portal@example.com",
    password: "x",
    role: "client",
    status: "active",
    client_id: customer.contact_id,
  });
  const token = jwt.sign({ userId: client._id, role: "client" }, process.env.JWT_SECRET);
  const get = (url) => request(app).get(url).set("Authorization", `Bearer ${token}`);

  const own = await get(`/api/v1/contact/${customer.contact_id}?organization_id=${org}`);
  assert.equal(own.status, 200, own.text);
  assert.equal((await get("/api/v1/verify-token")).status, 200);
  assert.equal((await get(`/api/v1/contact/CU-W1?organization_id=${userOrg}`)).status, 403);
  assert.equal((await get(`/api/v1/user/search?organization_id=${org}&q=kum`)).status, 403);
  assert.equal((await get(`/api/v1/invoices?org_id=${org}`)).status, 403);
});

test("features are switched on per user: no Global Search, no search", async () => {
  await asSa("patch", `/api/v1/admin/users/${userId}`, { permissions: { customers: ["view", "create"] } });
  const r = await asUser("get", `/api/v1/user/search?organization_id=${userOrg}&q=kum`);
  assert.equal(r.status, 403);
  assert.match(r.body.message, /Global Search/);
  assert.equal((await asUser("get", `/api/v1/user/notifications?organization_id=${userOrg}`)).status, 403);
  await asSa("patch", `/api/v1/admin/users/${userId}`, {
    permissions: { customers: ["view", "create"], globalSearch: ["view"] },
  });
  assert.equal((await asUser("get", `/api/v1/user/search?organization_id=${userOrg}&q=kum`)).status, 200);
});

test("the superadmin's limits are validated", async () => {
  assert.equal((await asSa("patch", `/api/v1/admin/users/${userId}`, { limits: { per_day: -1 } })).status, 400);
  assert.equal((await asSa("patch", `/api/v1/admin/users/${userId}`, { limits: { per_month: 2.5 } })).status, 400);
});

test("a daily create limit stops the next create and counts imported rows", async () => {
  await mongoose.model("create_event").deleteMany({});
  const set = await asSa("patch", `/api/v1/admin/users/${userId}`, { limits: { per_day: 3, per_month: "", per_year: null } });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual(set.body.data.limits, { per_day: 3, per_month: null, per_year: null, max_organizations: null });

  const add = (name) =>
    asUser("post", "/api/v1/contact", { organization_id: userOrg, contact_type: "Customer", contact_name: name, company_name: name });
  assert.ok([200, 201].includes((await add("Limit One")).status));

  // Two rows fit; the third is refused.
  const imp = await asUser("post", `/api/v1/import/customers?org_id=${userOrg}`, [
    { contact_name: "Limit Two" },
    { contact_name: "Limit Three" },
    { contact_name: "Limit Four" },
  ]);
  assert.equal(imp.status, 200, imp.text);
  assert.equal(imp.body.data.inserted, 2);
  assert.match(imp.body.data.errors[0].message, /limit/);

  const over = await add("Limit Five");
  assert.equal(over.status, 429, over.text);
  assert.equal(over.body.code, "CREATE_LIMIT");
  assert.match(over.body.message, /3 new records today/);
  assert.equal(await mongoose.model("Contact").countDocuments({ contact_name: "Limit Five" }), 0);

  // Reading still works, and the superadmin sees the usage.
  assert.equal((await asUser("get", `/api/v1/user/search?organization_id=${userOrg}&q=limit`)).status, 200);
  const list = await asSa("get", "/api/v1/admin/users");
  const row = list.body.data.find((u) => String(u._id) === userId);
  assert.equal(row.usage.day, 3);
  assert.equal(row.usage.organizations, 1);
  const me = await asUser("get", "/api/v1/user/me");
  assert.equal(me.body.data.usage.day, 3);
  assert.equal(me.body.data.limits.per_day, 3);

  // Lifting the limit lets them carry on.
  await asSa("patch", `/api/v1/admin/users/${userId}`, { limits: { per_day: null } });
  assert.ok([200, 201].includes((await add("Limit Five")).status));
});

test("an organisation cap stops new organisations", async () => {
  await asSa("patch", `/api/v1/admin/users/${userId}`, { limits: { max_organizations: 1 } });
  const r = await asUser("post", "/api/v1/org/create-organisation", {
    organizationName: "Second Org",
    country: "India",
    state: "Kerala",
    industry_name: "IT",
  });
  assert.equal(r.status, 429, r.text);
  assert.equal(r.body.code, "ORG_LIMIT");
  await asSa("patch", `/api/v1/admin/users/${userId}`, { limits: { max_organizations: null } });
});

test("templates: defaults, saving needs the Templates permission, and input is checked", async () => {
  const d = await asUser("get", `/api/v1/org/templates?organization_id=${userOrg}`);
  assert.equal(d.status, 200, d.text);
  assert.equal(d.body.data.invoice.title, "TAX INVOICE");
  assert.equal(d.body.data.quote.title, "QUOTATION");

  const denied = await asUser("put", `/api/v1/org/templates/invoice?organization_id=${userOrg}`, { title: "X" });
  assert.equal(denied.status, 403);
  assert.match(denied.body.message, /Templates/);

  await asSa("patch", `/api/v1/admin/users/${userId}`, {
    permissions: { customers: ["view", "create"], templates: ["view", "edit"] },
  });
  const bad = await asUser("put", `/api/v1/org/templates/invoice?organization_id=${userOrg}`, { logo: "javascript:alert(1)" });
  assert.equal(bad.status, 400);
  assert.equal((await asUser("put", `/api/v1/org/templates/receipt?organization_id=${userOrg}`, {})).status, 400);
  const ok = await asUser("put", `/api/v1/org/templates/invoice?organization_id=${userOrg}`, {
    title: "PROFORMA INVOICE",
    subtitle: "NOT A TAX INVOICE",
    advance_percent: 50,
    bank: { account_name: "Searcher Co", ifsc: "ABCD0001234", hacker: "x" },
    extra: "ignored",
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.extra, undefined);
  assert.equal(ok.body.data.bank.hacker, undefined);
  const after = await asUser("get", `/api/v1/org/templates?organization_id=${userOrg}`);
  assert.equal(after.body.data.invoice.title, "PROFORMA INVOICE");
  assert.equal(after.body.data.invoice.advance_percent, 50);
  assert.equal(after.body.data.quote.title, "QUOTATION", "quote template untouched");
  // Another company's templates are out of reach.
  assert.equal((await asUser("put", `/api/v1/org/templates/invoice?organization_id=${org}`, {})).status, 403);
});

test("portal sign-ins can change their password and use an emailed reset link once", async () => {
  const bcrypt = require("bcryptjs");
  const ctrl = require("../../controllers/portalPasswordController");
  const sent = [];
  ctrl.sendMail = async (m) => {
    sent.push(m);
    return { ok: true };
  };
  const client = await mongoose.model("clients").create({
    email: "reset@example.com",
    password: await bcrypt.hash("Old@12345", 10),
    role: "client",
    status: "active",
    client_id: customer.contact_id,
  });
  const token = jwt.sign({ userId: client._id, role: "client" }, process.env.JWT_SECRET);
  const change = await request(app)
    .post("/api/v1/client/change-password")
    .set("Authorization", `Bearer ${token}`)
    .send({ current_password: "Old@12345", new_password: "Newer@12345" });
  assert.equal(change.status, 200, change.text);
  // A business sign-in can't use the portal's endpoint.
  assert.equal((await asUser("post", "/api/v1/client/change-password", {})).status, 403);

  const unknown = await request(app).post("/api/v1/client/forgot-password").send({ email: "nobody@example.com" });
  assert.equal(unknown.status, 200);
  assert.equal(sent.length, 0);
  const f = await request(app).post("/api/v1/client/forgot-password").send({ email: "reset@example.com" });
  assert.equal(f.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /\/portal\/reset-password\?token=/);
  const resetToken = decodeURIComponent(sent[0].text.match(/token=(\S+)/)[1]);
  assert.equal((await request(app).post("/api/v1/client/reset-password").send({ token: resetToken, password: "weak" })).status, 400);
  const ok = await request(app).post("/api/v1/client/reset-password").send({ token: resetToken, password: "Reset@12345" });
  assert.equal(ok.status, 200, ok.text);
  const again = await request(app).post("/api/v1/client/reset-password").send({ token: resetToken, password: "Again@12345" });
  assert.equal(again.status, 400);
  assert.match(again.body.message, /already been used/);
  const fresh = await mongoose.model("clients").findById(client._id);
  assert.ok(await bcrypt.compare("Reset@12345", fresh.password));
});

test("a regular user's portal invite works: the backend's own calls aren't blocked by the device check", async () => {
  const mailer = require("../../helpers/mailer");
  const realSend = mailer.sendMail;
  const realUser = process.env.EMAIL_USER;
  const realPass = process.env.EMAIL_PASS;
  // The invite makes calls to this API over HTTP, so serve the app on a real port.
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const realPort = process.env.PORT;
  process.env.PORT = String(server.address().port);
  const sent = [];
  process.env.EMAIL_USER = "sender@example.com"; // only so the invite sees a mailbox...
  process.env.EMAIL_PASS = "x";
  mailer.sendMail = async (m) => {
    sent.push(m); // ...the message itself is captured, never sent
    return { ok: true, channel: "email", messageId: "<test@example.com>" };
  };
  try {
    await asSa("patch", `/api/v1/admin/users/${userId}`, {
      permissions: { customers: ["view", "create"], customerPortal: ["view", "create"] },
    });
    const person = await mongoose.model("contactDetails").create({
      contact_person_id: "CP-INVITE-1",
      admin_id: userId,
      contact_id: "CU-W1",
      organization_id: userOrg,
      first_name: "Ravi",
      email: "ravi@example.com",
    });
    assert.ok(person);
    const r = await asUser("post", "/api/v1/email/invite-portal", {
      contactId: "CU-W1",
      contact_person_id: "CP-INVITE-1",
      admin_id: userId,
      email: "ravi@example.com",
      name: "Ravi",
      organizationId: userOrg,
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "ravi@example.com");
    assert.match(sent[0].html || sent[0].text, /\/portal\/create-password\?token=/);
    assert.match(sent[0].text, new RegExp(`/portal/${userOrg}/login`));
    // The contact is marked invited even though this user can't edit customers.
    const contact = await mongoose.model("Contact").findOne({ contact_id: "CU-W1", organization_id: userOrg }).lean();
    assert.equal(contact.portal_status, "enabled");
    assert.ok(contact.invited_at);
    const personAfter = await mongoose.model("contactDetails").findOne({ contact_person_id: "CP-INVITE-1" }).lean();
    assert.equal(personAfter.is_added_in_portal, true);
    assert.equal(personAfter.is_portal_invitation_accepted, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (realPort === undefined) delete process.env.PORT;
    else process.env.PORT = realPort;
    mailer.sendMail = realSend;
    process.env.EMAIL_USER = realUser;
    process.env.EMAIL_PASS = realPass;
  }
});

test("the internal-call header is only honoured from this process", async () => {
  const { HEADER } = require("../../helpers/internalCall");
  // A guessed header from outside doesn't get past the device check.
  const r = await request(app)
    .get("/api/v1/user/me")
    .set("X-Forwarded-For", "198.51.100.200")
    .set(HEADER, "guess")
    .set("Authorization", `Bearer ${userToken}`);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "IP_NOT_ALLOWED");
});

test("recurring-invoice emails go to the customer's contact email, from the server mailbox", async () => {
  const mailer = require("../../helpers/mailer");
  const helper = require("../../helpers/emailHelper");
  const real = mailer.sendCustomerMail;
  const calls = [];
  mailer.sendCustomerMail = async (m) => {
    calls.push(m);
    return { ok: true, channel: "email", messageId: "<r@example.com>" };
  };
  try {
    // CU-W1 has the person added by the invite test (not flagged primary) - still found.
    const ok = await helper.sendInvoiceNotificationEmail(
      { organization_id: userOrg, customer_id: "CU-W1", customer_name: "Kumaran Stores", invoice_number: "INV-9", invoice_id: "9", date_formatted: "01/01/2026" },
      { profile_name: "Monthly" }
    );
    assert.equal(ok.success, true, JSON.stringify(ok));
    assert.equal(calls[0].to, "ravi@example.com");
    assert.equal(calls[0].businessName, "Searcher Org");
    // A customer with no email anywhere is reported, not silently skipped.
    const none = await helper.sendInvoiceNotificationEmail(
      { organization_id: userOrg, customer_id: "CU-NOBODY", customer_name: "X", invoice_number: "INV-10" },
      {}
    );
    assert.equal(none.success, false);
    assert.match(none.error, /No email address/);
  } finally {
    mailer.sendCustomerMail = real;
  }
});

test("invitation link lifecycle: set password once, then the link means 'sign in'", async () => {
  const claims = {
    clientId: "CU-W1",
    clientPersonId: "CP-INVITE-1",
    name: "Ravi",
    email: "ravi@example.com",
    organization_id: userOrg,
    org_name: "Searcher Org",
  };
  const link = (extra = {}, opts = { expiresIn: "24h" }) => jwt.sign({ ...claims, ...extra }, process.env.JWT_SECRET, opts);
  const status = (token) => request(app).get("/api/v1/client/invite-status").query({ token });
  const register = (body) => request(app).post("/api/v1/client/register").send(body);

  // Before any password: pending, and it says who it's for.
  const token = link();
  const pending = await status(token);
  assert.equal(pending.body.data.state, "pending");
  assert.equal(pending.body.data.email, "ravi@example.com");
  assert.equal(pending.body.data.org_name, "Searcher Org");

  // Bad links.
  assert.equal((await status("garbage")).body.data.state, "invalid");
  assert.equal((await status(jwt.sign(claims, "wrong-secret"))).body.data.state, "invalid");
  assert.equal((await status(link({}, { expiresIn: -10 }))).body.data.state, "expired");
  assert.equal((await register({ token: "garbage", password: "Valid@12345" })).status, 400);
  // The body can't pick who to register: no link, no account.
  assert.equal((await register({ email: "ravi@example.com", clientId: "CU-W1", clientPersonId: "CP-INVITE-1", password: "Valid@12345" })).status, 400);
  assert.equal((await register({ token, password: "weak" })).status, 400);

  // Setting the password works once and signs them in.
  const ok = await register({ token, password: "Valid@12345" });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.body.token);
  assert.equal(String(ok.body.org_id), String(userOrg));
  assert.equal(ok.body.data.password, undefined);
  assert.equal((await mongoose.model("clients").countDocuments({ email: "ravi@example.com" })), 1);

  // Opening the same link again: "registered", with the organisation to sign in to.
  const again = await status(token);
  assert.equal(again.body.data.state, "registered");
  assert.equal(String(again.body.data.organization_id), String(userOrg));
  assert.equal(again.body.data.email, undefined, "no address is revealed once registered");
  const second = await register({ token, password: "Other@12345" });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "ALREADY_REGISTERED");
  assert.equal(String(second.body.organization_id), String(userOrg));

  // The password they chose is the one that works, through the portal sign-in.
  const login = await request(app)
    .post("/api/v1/client/login")
    .send({ email: "ravi@example.com", password: "Valid@12345", role: "client", organization_id: userOrg });
  assert.equal(login.status, 200, login.text);

  // A withdrawn invitation stops working.
  await mongoose.model("contactDetails").create({
    contact_person_id: "CP-INVITE-2",
    admin_id: userId,
    contact_id: "CU-W1",
    organization_id: userOrg,
    first_name: "Meena",
    email: "meena@example.com",
    is_added_in_portal: false,
  });
  const withdrawn = link({ email: "meena@example.com", clientPersonId: "CP-INVITE-2" });
  assert.equal((await status(withdrawn)).body.data.state, "revoked");
  assert.equal((await register({ token: withdrawn, password: "Valid@12345" })).status, 400);
});
