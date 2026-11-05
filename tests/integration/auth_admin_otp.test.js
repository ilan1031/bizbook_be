// Integration tests for the superadmin's one-time sign-in codes (Users & Access)
// and for how a mail failure is reported. Runs against the real Express app and
// a throwaway database (TEST_DB_URL, dropped first).
//
//   TEST_DB_URL=mongodb://127.0.0.1:27017/bizbooks_test npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");

process.env.DB_Coll = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "1";
process.env.SUPERADMIN_EMAIL = "superadmin@test.local";
process.env.SUPERADMIN_PASSWORD = "Super@1234";
process.env.SUPERADMIN_MOBILE = "9000000002";
process.env.LOGIN_OTP_ENABLED = "true";
process.env.LOGIN_OTP_MODE = "new_device";
// Start with no mailbox (emails go to the log). Individual tests switch it on.
process.env.EMAIL_USER = "";
process.env.EMAIL_PASS = "";
delete process.env.EMAIL_HOST;
delete process.env.EMAIL_PORT;

const mongoose = require("mongoose");
const request = require("supertest");

const mailLog = [];
const auditLog = [];
const realLog = console.log;
const realError = console.error;
console.log = (...args) => {
  const line = args.join(" ");
  if (line.startsWith("[EMAIL:console]")) mailLog.push(line);
  if (line.startsWith("[audit]")) auditLog.push(line);
};
console.error = () => {}; // mail failures are expected in this file

const lastCode = () => {
  for (let i = mailLog.length - 1; i >= 0; i--) {
    const m = mailLog[i].match(/sign-in code is (\d{6})/);
    if (m) return m[1];
  }
  return null;
};

let app;
const SA = { email: "superadmin@test.local", password: "Super@1234" };
const PASSWORD = "Sign@1234";
const USER = {
  companyName: "Code Test Co",
  email: "codes.user@test.local",
  password: PASSWORD,
  phoneNumber: "98765 11111",
  country: "India",
  state: "Tamil Nadu",
  agreeToTerms: true,
};

const as = (ip) => ({
  post: (url, body, token) => {
    const r = request(app).post(url).set("X-Forwarded-For", ip);
    if (token) r.set("Authorization", `Bearer ${token}`);
    return r.send(body || {});
  },
  get: (url, token) => {
    const r = request(app).get(url).set("X-Forwarded-For", ip);
    if (token) r.set("Authorization", `Bearer ${token}`);
    return r;
  },
  patch: (url, body, token) =>
    request(app).patch(url).set("X-Forwarded-For", ip).set("Authorization", `Bearer ${token}`).send(body),
});
const login = (ip, creds) => as(ip).post("/api/v1/user/user-login", creds);
const verify = (ip, session, otp) => as(ip).post("/api/v1/user/verify-login-otp", { otp_session: session, otp });

const closedPort = () =>
  new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

let saToken;
let userId;
let userToken;

const User = () => mongoose.model("user");

test.before(async () => {
  const conn = await mongoose.createConnection(process.env.DB_Coll).asPromise();
  await conn.dropDatabase();
  await conn.close();
  app = require("../../app");
  for (let i = 0; i < 100 && mongoose.connection.readyState !== 1; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (let i = 0; i < 50; i++) {
    if (await User().exists({ role: "superadmin" })) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  saToken = (await login("203.0.113.9", SA)).body.token;
  assert.ok(saToken, "superadmin signs in");
});

test.after(async () => {
  console.log = realLog;
  console.error = realError;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function registerAndApprove(email, ip = "10.20.0.1", phoneNumber = USER.phoneNumber) {
  const r = await as(ip).post("/api/v1/user/user-register", { ...USER, email, phoneNumber });
  assert.equal(r.status, 201, r.text);
  const id = String(r.body._id || (await User().findOne({ email: email.toLowerCase() }))._id);
  const a = await as("203.0.113.9").patch(`/api/v1/admin/users/${id}`, { status: "active" }, saToken);
  assert.equal(a.status, 200, a.text);
  return id;
}

test("setup: a user is approved and signs in once from a new device by emailed code", async () => {
  userId = await registerAndApprove(USER.email);
  const first = await login("10.9.0.1", { email: USER.email, password: PASSWORD });
  assert.equal(first.body.otp_required, true);
  assert.equal(first.body.channel, "console"); // no mailbox in this file: the code goes to the log
  const ok = await verify("10.9.0.1", first.body.otp_session, lastCode());
  assert.equal(ok.status, 200, ok.text);
  userToken = ok.body.token;
});

test("only the superadmin can issue a sign-in code", async () => {
  const none = await as("10.9.0.1").post(`/api/v1/admin/users/${userId}/sign-in-code`, {});
  assert.equal(none.status, 401);
  const notSuper = await as("10.9.0.1").post(`/api/v1/admin/users/${userId}/sign-in-code`, {}, userToken);
  assert.equal(notSuper.status, 403, notSuper.text);
});

test("the superadmin gets a 6-digit code once: hashed at rest, expires in 5 minutes, audited", async () => {
  mailLog.length = 0;
  auditLog.length = 0;
  const issued = await as("203.0.113.9").post(`/api/v1/admin/users/${userId}/sign-in-code`, {}, saToken);
  assert.equal(issued.status, 201, issued.text);
  assert.equal(issued.headers["cache-control"], "no-store");
  const { code, expires_at } = issued.body.data;
  assert.match(code, /^\d{6}$/);
  const minutes = (new Date(expires_at) - Date.now()) / 60000;
  assert.ok(minutes > 4.9 && minutes <= 5.01, `expires in ~5 minutes, got ${minutes}`);

  // Stored hashed, the same way as emailed codes; the plain code isn't kept.
  const { hashOtp } = require("../../helpers/signInCodes");
  const doc = await User().findById(userId).lean();
  assert.equal(doc.login_otp.code_hash, hashOtp(code));
  assert.equal(doc.login_otp.source, "admin");
  assert.ok(!JSON.stringify(doc.login_otp).includes(code));
  const issuedEntry = doc.sign_in_code_log.at(-1);
  assert.equal(issuedEntry.action, "issued");
  assert.equal(issuedEntry.by_email, SA.email);
  assert.ok(issuedEntry.at);

  // Never in the list, never in the log; the list shows who and when.
  const list = await as("203.0.113.9").get("/api/v1/admin/users", saToken);
  const row = list.body.data.find((u) => u.email === USER.email);
  assert.ok(!JSON.stringify(list.body).includes(code), "the code is not in the list");
  assert.ok(!JSON.stringify(list.body).includes("code_hash"));
  assert.equal(row.sign_in_code_log.at(-1).by_email, SA.email);
  assert.ok(auditLog.some((l) => l.includes(USER.email) && l.includes(SA.email)), "audit line names account and issuer");
  assert.ok(!auditLog.some((l) => l.includes(code)), "the code is not logged");
  assert.ok(!mailLog.some((l) => l.includes(code)), "the code is not emailed");
  global.__issued = code;
});

test("the code is asked for at the next sign-in, sends no email, and works once", async () => {
  const code = global.__issued;
  mailLog.length = 0;
  const step = await login("10.9.0.1", { email: USER.email, password: PASSWORD });
  assert.equal(step.status, 200);
  assert.equal(step.body.otp_required, true);
  assert.equal(step.body.channel, "admin");
  assert.equal(step.body.token, undefined);
  assert.ok(!mailLog.some((l) => l.includes(USER.email)), "no email for an admin code");

  const good = await verify("10.9.0.1", step.body.otp_session, code);
  assert.equal(good.status, 200, good.text);
  assert.ok(good.body.token);
  const doc = await User().findById(userId).lean();
  assert.equal(doc.login_otp, undefined, "the code is cleared when used");
  assert.equal(doc.sign_in_code_log.at(-1).action, "used");

  const again = await verify("10.9.0.1", step.body.otp_session, code);
  assert.notEqual(again.status, 200, "a used code can't sign in again");
  assert.equal(again.body.code, "OTP_INVALID");
});

test("wrong codes count down; after five the code is spent", async () => {
  const issued = await as("203.0.113.9").post(`/api/v1/admin/users/${userId}/sign-in-code`, {}, saToken);
  const code = issued.body.data.code;
  const step = await login("10.9.0.1", { email: USER.email, password: PASSWORD });
  const wrong = code === "000000" ? "111111" : "000000";
  const first = await verify("10.9.0.1", step.body.otp_session, wrong);
  assert.equal(first.body.code, "OTP_WRONG");
  assert.match(first.body.message, /4 attempt/);
  for (let i = 0; i < 4; i++) await verify("10.9.0.1", step.body.otp_session, wrong);
  const after = await verify("10.9.0.1", step.body.otp_session, code);
  assert.equal(after.body.code, "OTP_EXPIRED");
  assert.notEqual(after.status, 200);
});

test("an expired code can't be used, and is cleared at the next sign-in", async () => {
  const issued = await as("203.0.113.9").post(`/api/v1/admin/users/${userId}/sign-in-code`, {}, saToken);
  const code = issued.body.data.code;
  const step = await login("10.9.0.1", { email: USER.email, password: PASSWORD });
  assert.equal(step.body.channel, "admin");
  await User().updateOne({ _id: userId }, { $set: { "login_otp.expires_at": new Date(Date.now() - 1000) } });
  const late = await verify("10.9.0.1", step.body.otp_session, code);
  assert.equal(late.body.code, "OTP_EXPIRED");

  // A new sign-in after expiry doesn't ask for the old code (the device is known).
  const next = await login("10.9.0.1", { email: USER.email, password: PASSWORD });
  assert.equal(next.status, 200);
  assert.equal(next.body.otp_required, undefined);
  assert.equal((await User().findById(userId).lean()).login_otp, undefined);
});

test("five codes per account per 15 minutes; a pending account can't get one", async () => {
  const second = await registerAndApprove("codes.limit@test.local", "10.20.0.2", "98765 33333");
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    statuses.push((await as("203.0.113.9").post(`/api/v1/admin/users/${second}/sign-in-code`, {}, saToken)).status);
  }
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);

  const pending = await as("10.20.0.3").post("/api/v1/user/user-register", { ...USER, email: "codes.pending@test.local", phoneNumber: "98765 44444" });
  assert.equal(pending.status, 201);
  const pid = String((await User().findOne({ email: "codes.pending@test.local" }))._id);
  const r = await as("203.0.113.9").post(`/api/v1/admin/users/${pid}/sign-in-code`, {}, saToken);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "NOT_ACTIVE");
});

test("mail failure is reported clearly, and an issued code still gets the user in", async () => {
  const port = await closedPort();
  const secret = "s3cret-app-password-XYZ-987";
  process.env.EMAIL_USER = "mailer@test.local";
  process.env.EMAIL_PASS = secret;
  process.env.EMAIL_HOST = "127.0.0.1";
  process.env.EMAIL_PORT = String(port);
  // The sign-up IP and the setup device both count; allow a third for this test.
  await as("203.0.113.9").patch(`/api/v1/admin/users/${userId}`, { ip_limit: 5 }, saToken);
  try {
    // The superadmin's test email fails with the reason and where it went.
    const test1 = await as("203.0.113.9").post("/api/v1/admin/email/test", { email: "someone@test.local" }, saToken);
    assert.equal(test1.status, 400);
    assert.equal(test1.body.status, false);
    assert.match(test1.body.error, /ECONNREFUSED/);
    assert.match(test1.body.message, new RegExp(`Couldn't send the test email through 127\\.0\\.0\\.1:${port}`));
    assert.match(test1.body.message, /EMAIL_HOST/);

    // The list shows mail is failing, with when and why; never the password.
    const list = await as("203.0.113.9").get("/api/v1/admin/users", saToken);
    assert.equal(list.body.email.health.ok, false);
    assert.match(list.body.email.health.error, /ECONNREFUSED/);
    assert.equal(list.body.email.target, `127.0.0.1:${port}`);
    assert.ok(list.body.email.health.checked_at);
    assert.ok(!JSON.stringify(list.body).includes(secret), "the mail password is never sent to the browser");

    // The emailed code can't be sent. The sign-in isn't stuck: the person is
    // told to ask their administrator, and the code waits for the superadmin.
    const stuck = await login("10.9.0.8", { email: USER.email, password: PASSWORD });
    assert.equal(stuck.status, 200, JSON.stringify(stuck.body));
    assert.equal(stuck.body.otp_required, true);
    assert.equal(stuck.body.channel, "admin");
    assert.equal(stuck.body.fallback, true);
    assert.match(stuck.body.message, /Ask your administrator/);
    assert.ok(!JSON.stringify(stuck.body).match(/"\d{6}"/), "the code isn't in the person's response");

    // The superadmin's list shows that code; nobody else's request can see it.
    const waiting = await as("203.0.113.9").get("/api/v1/admin/users", saToken);
    assert.equal(waiting.headers["cache-control"], "no-store");
    const row = waiting.body.data.find((u) => String(u._id) === userId);
    assert.match(row.pending_sign_in_code.code, /^\d{6}$/);
    assert.equal(row.pending_sign_in_code.reason, "email_failed");
    assert.equal(row.login_otp, undefined, "the stored record isn't sent");
    assert.ok(waiting.body.data.filter((u) => u.pending_sign_in_code).length === 1, "only that user's code");
    assert.equal(waiting.body.pending_codes.length, 1);
    assert.equal(waiting.body.pending_codes[0].email, USER.email);
    assert.equal(waiting.body.pending_codes[0].code, row.pending_sign_in_code.code);
    // The banner list isn't limited by the status tab that is open.
    const otherTab = await as("203.0.113.9").get("/api/v1/admin/users?status=inactive", saToken);
    assert.equal(otherTab.body.pending_codes.length, 1);
    const stored = await User().findById(userId).lean();
    assert.ok(stored.login_otp.sealed, "kept encrypted");
    assert.ok(!JSON.stringify(stored.login_otp).includes(row.pending_sign_in_code.code), "never plain text in the database");
    assert.ok(stored.sign_in_code_log.some((e) => e.action === "email_failed"), "recorded in the audit trail");

    // A wrong code is refused; the code the superadmin passes on works once.
    const wrong = await verify("10.9.0.8", stuck.body.otp_session, row.pending_sign_in_code.code === "000000" ? "111111" : "000000");
    assert.equal(wrong.status, 400);
    const entered = await verify("10.9.0.8", stuck.body.otp_session, row.pending_sign_in_code.code);
    assert.equal(entered.status, 200, entered.text);
    assert.ok(entered.body.token);
    const after = await as("203.0.113.9").get("/api/v1/admin/users", saToken);
    assert.equal(after.body.data.find((u) => String(u._id) === userId).pending_sign_in_code, undefined, "gone once used");
    assert.equal((await verify("10.9.0.8", stuck.body.otp_session, row.pending_sign_in_code.code)).status, 400, "works once");

    // The superadmin can also issue a code on demand, which needs no mail.
    const issued = await as("203.0.113.9").post(`/api/v1/admin/users/${userId}/sign-in-code`, {}, saToken);
    assert.equal(issued.status, 201);
    const step = await login("10.9.0.7", { email: USER.email, password: PASSWORD });
    assert.equal(step.body.channel, "admin");
    const got = await verify("10.9.0.7", step.body.otp_session, issued.body.data.code);
    assert.equal(got.status, 200, got.text);
    assert.ok(got.body.token);
  } finally {
    process.env.EMAIL_USER = "";
    process.env.EMAIL_PASS = "";
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_PORT;
  }
});

test("with no mailbox set up, the test email is written to the log and nothing fails", async () => {
  mailLog.length = 0;
  const r = await as("203.0.113.9").post("/api/v1/admin/email/test", { email: "someone@test.local" }, saToken);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.channel, "console");
  assert.ok(mailLog.some((l) => l.includes("someone@test.local")));
});

test("when mail is down the superadmin's own code goes to the server log, not a list", async () => {
  const port = await closedPort();
  process.env.EMAIL_USER = "mailer@test.local";
  process.env.EMAIL_PASS = "app-password";
  process.env.EMAIL_HOST = "127.0.0.1";
  process.env.EMAIL_PORT = String(port);
  process.env.LOGIN_OTP_MODE = "every_login";
  const warned = [];
  const realWarn = console.warn;
  const realErr = console.error;
  console.warn = (...a) => warned.push(a.join(" "));
  console.error = () => {};
  try {
    const step = await login("203.0.113.9", { email: "superadmin@test.local", password: "Super@1234" });
    assert.equal(step.status, 200, JSON.stringify(step.body));
    assert.equal(step.body.channel, "admin");
    assert.equal(step.body.fallback, true);
    assert.match(step.body.message, /server log/);
    const line = warned.find((l) => /superadmin code for superadmin@test\.local: \d{6}/.test(l));
    assert.ok(line, `expected the code in the log, got: ${warned.join(" | ")}`);
    const code = line.match(/: (\d{6})/)[1];
    const stored = await User().findOne({ email: "superadmin@test.local" }).lean();
    assert.equal(stored.login_otp.sealed, undefined, "no readable copy kept for the superadmin");
    const got = await verify("203.0.113.9", step.body.otp_session, code);
    assert.equal(got.status, 200, got.text);
    assert.ok(got.body.token);
  } finally {
    console.warn = realWarn;
    console.error = realErr;
    process.env.EMAIL_USER = "";
    process.env.EMAIL_PASS = "";
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_PORT;
    process.env.LOGIN_OTP_MODE = "new_device";
  }
});
