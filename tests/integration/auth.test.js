// Integration tests for sign-up, login, approval, device (IP) limits, emailed
// login codes and the superadmin API, run against the real Express app and a
// throwaway database (TEST_DB_URL, dropped first).
//
//   TEST_DB_URL=mongodb://127.0.0.1:27017/bizbooks_test npm test
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_Coll =
  process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "1"; // lets X-Forwarded-For simulate client IPs
process.env.SUPERADMIN_EMAIL = "superadmin@test.local";
process.env.SUPERADMIN_PASSWORD = "Super@1234";
process.env.SUPERADMIN_MOBILE = "9000000001";
process.env.LOGIN_OTP_ENABLED = "true";
process.env.LOGIN_OTP_MODE = "new_device"; // the every-login mode has its own test
delete process.env.EMAIL_USER; // emails go to the log in tests
delete process.env.EMAIL_PASS;

const mongoose = require("mongoose");
const request = require("supertest");

// Capture logged emails so tests can read login codes and notices.
const mailLog = [];
const realLog = console.log;
console.log = (...args) => {
  const line = args.join(" ");
  if (line.startsWith("[EMAIL:console]")) mailLog.push(line);
};
const lastCode = () => {
  for (let i = mailLog.length - 1; i >= 0; i--) {
    const m = mailLog[i].match(/sign-in code is (\d{6})/);
    if (m) return m[1];
  }
  return null;
};

let app;
const SA = { email: "superadmin@test.local", password: "Super@1234" };
const USER = {
  companyName: "Test Co",
  email: "User.One@Test.local", // mixed case on purpose
  password: "User@1234",
  phoneNumber: "98765 43210",
  country: "India",
  state: "Tamil Nadu",
  agreeToTerms: true,
};

const as = (ip) => ({
  post: (url, body, token) => {
    const r = request(app).post(url).set("X-Forwarded-For", ip);
    if (token) r.set("Authorization", `Bearer ${token}`);
    return r.send(body);
  },
  get: (url, token) => {
    const r = request(app).get(url).set("X-Forwarded-For", ip);
    if (token) r.set("Authorization", `Bearer ${token}`);
    return r;
  },
  patch: (url, body, token) =>
    request(app).patch(url).set("X-Forwarded-For", ip).set("Authorization", `Bearer ${token}`).send(body),
  del: (url, token, body) =>
    request(app).delete(url).set("X-Forwarded-For", ip).set("Authorization", `Bearer ${token}`).send(body || {}),
});
const login = (ip, creds) => as(ip).post("/api/v1/user/user-login", creds);

let saToken;
let userId;

test.before(async () => {
  // Start clean, then load the app (which connects and seeds the superadmin).
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
});

test.after(async () => {
  console.log = realLog;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("superadmin is seeded and can sign in from any IP", async () => {
  const a = await login("203.0.113.1", SA);
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.user.role, "superadmin");
  assert.equal(a.body.needs_org_setup, true);
  assert.equal(a.body.user.password, undefined);
  saToken = a.body.token;
  const b = await login("198.51.100.77", SA);
  assert.equal(b.status, 200);
});

test("superadmin seeding is idempotent and keeps the password", async () => {
  const { ensureSuperadmin } = require("../../helpers/superadminSeed");
  process.env.SUPERADMIN_PASSWORD = "Different@999";
  await ensureSuperadmin();
  process.env.SUPERADMIN_PASSWORD = SA.password;
  assert.equal(await mongoose.model("user").countDocuments({ role: "superadmin" }), 1);
  assert.equal((await login("203.0.113.1", SA)).status, 200);
});

test("sign-up validation", async () => {
  const ip = as("10.1.0.1");
  const base = { ...USER, email: "v@test.local" };
  const cases = [
    [{ ...base, email: "" }, /required/i],
    [{ ...base, password: "" }, /required/i],
    [{ ...base, phoneNumber: "" }, /required/i],
    [{ ...base, phoneNumber: "123" }, /mobile/i],
    [{ ...base, password: "password" }, /Password must/],
    [{ ...base, password: "Password1" }, /Password must/], // no special char
    [{ ...base, password: "Pa@1" }, /Password must/], // too short
  ];
  for (const [body, msg] of cases) {
    const r = await ip.post("/api/v1/user/user-register", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.message, msg);
  }
});

test("sign-up creates a pending account without a token and alerts the superadmin", async () => {
  mailLog.length = 0;
  const r = await as("10.0.0.1").post("/api/v1/user/user-register", USER);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.status, "pending");
  assert.equal(r.body.token, undefined);

  const saved = await mongoose.model("user").findOne({ email: "user.one@test.local" }).lean();
  assert.ok(saved, "email stored lower-case");
  userId = String(saved._id);

  // The superadmin alert is sent in the background after the response.
  for (let i = 0; i < 20 && !mailLog.some((l) => /waiting for approval/.test(l)); i++) {
    await new Promise((res) => setTimeout(res, 50));
  }
  const alert = mailLog.find((l) => /waiting for approval/.test(l));
  assert.ok(alert, "superadmin emailed");
  assert.match(alert, /^\[EMAIL:console\] to superadmin@test\.local: New BizBooks sign-up waiting for approval: user\.one@test\.local/);
  assert.match(alert, /\/admin\/users/, "links to Users & Access");
  assert.equal(saved.status, "pending");
  assert.equal(saved.mobile, "9876543210", "mobile stored as digits");
  assert.notEqual(saved.password, USER.password, "password hashed");
  assert.deepEqual(saved.allowed_ips.map((i) => i.ip), ["10.0.0.1"], "sign-up IP recorded");
  assert.deepEqual(saved.permissions, {});
});

test("every sign-up emails the superadmin", async () => {
  mailLog.length = 0;
  await as("10.3.0.1").post("/api/v1/user/user-register", { ...USER, email: "second@test.local" });
  for (let i = 0; i < 20 && !mailLog.some((l) => /second@test\.local/.test(l)); i++) {
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.ok(mailLog.some((l) => /to superadmin@test\.local: .*second@test\.local/.test(l)));
});

test("duplicate sign-up is refused (case-insensitive)", async () => {
  const r = await as("10.0.0.1").post("/api/v1/user/user-register", {
    ...USER,
    email: "USER.ONE@test.local",
  });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /already exists/);
});

test("login failures", async () => {
  const ip = "10.2.0.1";
  assert.equal((await login(ip, {})).status, 400);
  assert.equal((await login(ip, { email: "nobody@test.local", password: "x" })).status, 400);
  const wrong = await login(ip, { email: USER.email, password: "Wrong@1234" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.message, "Invalid credentials");
  // Operator injection can't match an account
  const inj = await login(ip, { email: { $gt: "" }, password: { $gt: "" } });
  assert.equal(inj.status, 400);
});

test("pending account cannot sign in", async () => {
  const r = await login("10.0.0.1", USER);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "ACCOUNT_PENDING");
});

test("superadmin approves the user and sets permissions; user is emailed", async () => {
  mailLog.length = 0;
  const r = await as("203.0.113.1").patch(
    `/api/v1/admin/users/${userId}`,
    { status: "active", ip_limit: 2, permissions: { invoices: ["view", "create"], madeUp: ["view"] } },
    saToken
  );
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.status, "active");
  assert.deepEqual(r.body.data.permissions, { invoices: ["view", "create"] });
  assert.equal(r.body.data.password, undefined);
  assert.ok(r.body.data.approved_at);
  const notice = mailLog.find((l) => /approved/.test(l));
  assert.match(notice, /^\[EMAIL:console\] to user\.one@test\.local: Your BizBooks account is approved/);
  assert.match(notice, /organisation\/login/, "links to sign in");

  // Saving again (already active) doesn't re-send it.
  mailLog.length = 0;
  await as("203.0.113.1").patch(`/api/v1/admin/users/${userId}`, { ip_limit: 2 }, saToken);
  assert.ok(!mailLog.some((l) => /approved/.test(l)));
});

test("admin input validation", async () => {
  const ip = as("203.0.113.1");
  assert.equal((await ip.patch(`/api/v1/admin/users/not-an-id`, {}, saToken)).status, 400);
  assert.equal((await ip.patch(`/api/v1/admin/users/${userId}`, { status: "boss" }, saToken)).status, 400);
  assert.equal((await ip.patch(`/api/v1/admin/users/${userId}`, { ip_limit: -1 }, saToken)).status, 400);
  assert.equal((await ip.patch(`/api/v1/admin/users/${userId}`, { ip_limit: 2.5 }, saToken)).status, 400);
  const missing = new mongoose.Types.ObjectId();
  assert.equal((await ip.patch(`/api/v1/admin/users/${missing}`, {}, saToken)).status, 404);
});

let userToken;
test("approved user signs in from the sign-up IP with email or mobile, no code", async () => {
  const byEmail = await login("10.0.0.1", { email: "user.one@test.local", password: USER.password });
  assert.equal(byEmail.status, 200, byEmail.text);
  assert.equal(byEmail.body.otp_required, undefined);
  assert.equal(byEmail.body.needs_org_setup, true);
  const byMobile = await login("10.0.0.1", { email: "9876543210", password: USER.password });
  assert.equal(byMobile.status, 200);
  userToken = byEmail.body.token;
});

test("/user/me returns role, status, permissions and the page catalog", async () => {
  const r = await as("10.0.0.1").get("/api/v1/user/me", userToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.role, "user");
  assert.equal(r.body.data.account_status, "active");
  assert.deepEqual(r.body.data.permissions, { invoices: ["view", "create"] });
  assert.ok(r.body.data.catalog.length > 20);
  assert.equal(r.body.data.password, undefined);
});

let otpToken;
test("a new IP within the limit needs the emailed code", async () => {
  mailLog.length = 0;
  const r = await login("10.0.0.2", USER);
  assert.equal(r.status, 200);
  assert.equal(r.body.otp_required, true);
  assert.equal(r.body.token, undefined);
  assert.equal(r.body.channel, "console", "no mailbox in tests: the email is in the log");
  const session = r.body.otp_session;
  const code = lastCode();
  assert.match(code, /^\d{6}$/);

  const verify = (ip, otp) => as(ip).post("/api/v1/user/verify-login-otp", { otp_session: session, otp });
  const wrong = await verify("10.0.0.2", code === "000000" ? "111111" : "000000");
  assert.equal(wrong.body.code, "OTP_WRONG");
  assert.equal((await verify("10.0.0.9", code)).body.code, "OTP_INVALID", "other IP");
  assert.equal((await as("10.0.0.2").post("/api/v1/user/verify-login-otp", { otp_session: "junk", otp: code })).body.code, "OTP_EXPIRED");

  const ok = await verify("10.0.0.2", code);
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.body.token);
  otpToken = ok.body.token;
  assert.equal((await verify("10.0.0.2", code)).status, 400, "code can't be reused");

  // The IP is remembered: no code next time.
  const again = await login("10.0.0.2", USER);
  assert.ok(again.body.token);
});

test("too many wrong codes expire the code", async () => {
  // Use a fresh slot: remove 10.0.0.2 then try from 10.0.0.5
  const u = await mongoose.model("user").findById(userId).lean();
  const entry = u.allowed_ips.find((i) => i.ip === "10.0.0.2");
  await as("203.0.113.1").del(`/api/v1/admin/users/${userId}/ips/${entry._id}`, saToken);
  const r = await login("10.0.0.5", USER);
  const session = r.body.otp_session;
  for (let i = 0; i < 5; i++) {
    await as("10.0.0.5").post("/api/v1/user/verify-login-otp", { otp_session: session, otp: "999999" === lastCode() ? "888888" : "999999" });
  }
  const after = await as("10.0.0.5").post("/api/v1/user/verify-login-otp", { otp_session: session, otp: lastCode() });
  assert.equal(after.body.code, "OTP_EXPIRED");
});

test("device limit: a third IP is refused; removing one frees a slot", async () => {
  // Fill the second slot again (10.0.0.2 was removed above)
  const first = await login("10.0.0.2", USER);
  await as("10.0.0.2").post("/api/v1/user/verify-login-otp", { otp_session: first.body.otp_session, otp: lastCode() });

  const third = await login("10.0.0.3", USER);
  assert.equal(third.status, 403);
  assert.equal(third.body.code, "IP_LIMIT_REACHED");

  // A token used from an IP that isn't approved is refused
  const me = await as("10.0.0.3").get("/api/v1/user/me", userToken);
  assert.equal(me.body.code, "IP_NOT_ALLOWED");

  const u = await mongoose.model("user").findById(userId).lean();
  const entry = u.allowed_ips.find((i) => i.ip === "10.0.0.2");
  const del = await as("203.0.113.1").del(`/api/v1/admin/users/${userId}/ips/${entry._id}`, saToken);
  assert.equal(del.status, 200);
  assert.equal((await login("10.0.0.3", USER)).body.otp_required, true);
});

test("raising the IP limit lets another device in", async () => {
  await as("203.0.113.1").patch(`/api/v1/admin/users/${userId}`, { ip_limit: 3 }, saToken);
  const r = await login("10.0.0.4", USER);
  assert.equal(r.body.otp_required, true);
  await as("203.0.113.1").patch(`/api/v1/admin/users/${userId}`, { ip_limit: 2 }, saToken);
});

test("page permissions are enforced on the API", async () => {
  const ip = as("10.0.0.1");
  const org = await ip.post(
    "/api/v1/org/create-organisation",
    { organizationName: "Test Co", country: "India", state: "Tamil Nadu", currency: "INR", org_type: "default" },
    userToken
  );
  assert.equal(org.status, 200, org.text);
  const orgId = org.body.data.organization_id;

  assert.equal((await ip.get(`/api/v1/invoices?organization_id=${orgId}`, userToken)).status, 200);
  assert.equal((await ip.del("/api/v1/invoices", userToken, { organization_id: orgId })).body.code, "FORBIDDEN");
  assert.equal((await ip.get(`/api/v1/bills/get-bills?org_id=${orgId}`, userToken)).status, 403);
  assert.equal((await ip.get(`/api/v1/COA/get-coa-list?org_id=${orgId}`, userToken)).status, 200);
  assert.equal((await ip.get("/api/v1/admin/users", userToken)).status, 403);
  assert.equal(
    (await ip.patch(`/api/v1/admin/users/${userId}`, { permissions: { bills: ["view"] } }, userToken)).status,
    403,
    "can't grant themselves permissions"
  );

  // After login, the user's org is returned
  const again = await login("10.0.0.1", USER);
  assert.equal(String(again.body.ORG_ID), String(orgId));
  assert.equal(again.body.needs_org_setup, false);
});

test("superadmin can't change or lock out their own account", async () => {
  const sa = await mongoose.model("user").findOne({ role: "superadmin" }).lean();
  const r = await as("203.0.113.1").patch(`/api/v1/admin/users/${sa._id}`, { status: "inactive" }, saToken);
  assert.equal(r.status, 400);
});

test("deactivation cuts off open sessions and blocks login; reactivation restores", async () => {
  await as("203.0.113.1").patch(`/api/v1/admin/users/${userId}`, { status: "inactive" }, saToken);
  assert.equal((await as("10.0.0.1").get("/api/v1/user/me", userToken)).body.code, "ACCOUNT_INACTIVE");
  assert.equal((await login("10.0.0.1", USER)).body.code, "ACCOUNT_INACTIVE");
  await as("203.0.113.1").patch(`/api/v1/admin/users/${userId}`, { status: "active" }, saToken);
  assert.equal((await as("10.0.0.1").get("/api/v1/user/me", userToken)).status, 200);
});

test("admin user list never exposes passwords or OTP hashes", async () => {
  const r = await as("203.0.113.1").get("/api/v1/admin/users", saToken);
  assert.equal(r.status, 200);
  for (const u of r.body.data) {
    assert.equal(u.password, undefined);
    assert.equal(u.login_otp, undefined);
  }
  assert.ok(r.body.counts.active >= 1);
  const pending = await as("203.0.113.1").get("/api/v1/admin/users?status=pending", saToken);
  assert.ok(pending.body.data.every((u) => u.status === "pending"));
});

test("requests without a valid token are rejected", async () => {
  assert.equal((await as("10.0.0.1").get("/api/v1/user/me")).status, 401);
  assert.equal((await as("10.0.0.1").get("/api/v1/user/me", "not-a-token")).status, 400);
  assert.equal((await as("10.0.0.1").get("/api/v1/admin/users")).status, 401);
});

test("health check reports the database", async () => {
  const r = await request(app).get("/api-health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, db: "connected" });
});

test("every-login mode asks for a code each time, the superadmin's included", async () => {
  process.env.LOGIN_OTP_MODE = "every_login";
  try {
    mailLog.length = 0;
    const sa = await login("203.0.113.1", SA);
    assert.equal(sa.body.otp_required, true, JSON.stringify(sa.body));
    assert.equal(sa.body.token, undefined);
    const ok = await as("203.0.113.1").post("/api/v1/user/verify-login-otp", { otp_session: sa.body.otp_session, otp: lastCode() });
    assert.equal(ok.status, 200, ok.text);
    assert.ok(ok.body.token);

    // A known device still needs a code in this mode.
    const user = await login("10.0.0.1", USER);
    assert.equal(user.body.otp_required, true, JSON.stringify(user.body));
  } finally {
    process.env.LOGIN_OTP_MODE = "new_device";
  }
  // In new-device mode known devices sign straight in.
  assert.ok((await login("10.0.0.1", USER)).body.token);
});

test("with a mailbox set up, the code is emailed and the address is masked", async (t) => {
  const mailer = require("../../helpers/mailer");
  const sent = [];
  t.mock.method(mailer, "sendMail", async (mail) => {
    sent.push(mail);
    return { ok: true, channel: "email" };
  });
  process.env.LOGIN_OTP_MODE = "every_login";
  try {
    const r = await login("10.0.0.1", USER);
    assert.equal(r.body.channel, "email", JSON.stringify(r.body));
    assert.equal(r.body.sent_to, "us******@test.local");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "user.one@test.local");
    const code = sent[0].text.match(/sign-in code is (\d{6})/)[1];
    const ok = await as("10.0.0.1").post("/api/v1/user/verify-login-otp", { otp_session: r.body.otp_session, otp: code });
    assert.equal(ok.status, 200, ok.text);
  } finally {
    process.env.LOGIN_OTP_MODE = "new_device";
  }
});

test("customer-portal tokens can't reach business APIs", async () => {
  const jwt = require("jsonwebtoken");
  const Client = mongoose.model("clients");
  const client = await Client.create({ email: "portal@test.local", password: "x", role: "client", client_id: "CU-NOPE", status: "active" });
  const token = jwt.sign({ userId: client._id, role: "client" }, process.env.JWT_SECRET);
  const business = await as("10.9.0.1").get("/api/v1/invoices?organization_id=100000", token);
  assert.equal(business.status, 403);
  assert.equal(business.body.code, "FORBIDDEN");
  const portal = await as("10.9.0.1").get("/api/v1/clientestimates", token);
  assert.equal(portal.status, 403);
  assert.equal(portal.body.code, "PORTAL_DISABLED", "no business has the portal on for this customer");
});
