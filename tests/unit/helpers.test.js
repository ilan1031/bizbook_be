const test = require("node:test");
const assert = require("node:assert/strict");

test("smsHelper: console provider logs instead of sending", async (t) => {
  process.env.SMS_PROVIDER = "console";
  const { sendSms, isConfigured } = require("../../helpers/smsHelper");
  const logged = [];
  t.mock.method(console, "log", (...args) => logged.push(args.join(" ")));
  assert.equal(isConfigured(), true);
  const res = await sendSms("9876543210", "hello");
  assert.equal(res.ok, true);
  assert.ok(logged.some((l) => l.includes("9876543210") && l.includes("hello")));
});

test("smsHelper: rejects missing numbers and unconfigured providers without throwing", async () => {
  const sms = require("../../helpers/smsHelper");
  process.env.SMS_PROVIDER = "console";
  assert.equal((await sms.sendSms("", "x")).ok, false);
  assert.equal((await sms.sendSms("123", "x")).ok, false);

  process.env.SMS_PROVIDER = "fast2sms";
  delete process.env.FAST2SMS_API_KEY;
  assert.equal(sms.isConfigured(), false);
  const res = await sms.sendSms("9876543210", "x");
  assert.equal(res.ok, false);
  assert.match(res.error, /not configured/);

  process.env.SMS_PROVIDER = "2factor";
  delete process.env.TWOFACTOR_API_KEY;
  assert.equal(sms.isConfigured(), false);
  assert.equal(sms.canDeliver(), false);
  process.env.TWOFACTOR_API_KEY = "test-key";
  assert.equal(sms.canDeliver(), true);
  const notOtp = await sms.sendSms("9876543210", "Your account is approved");
  assert.equal(notOtp.ok, false, "2Factor sends sign-in codes only");
  delete process.env.TWOFACTOR_API_KEY;

  process.env.SMS_PROVIDER = "carrier-pigeon";
  assert.equal(sms.isConfigured(), false);
  process.env.SMS_PROVIDER = "console";
});

test("accountingHelper: paise conversion is exact", () => {
  const { toPaise, fromPaise, isDebitNormal } = require("../../helpers/accountingHelper");
  assert.equal(toPaise(0.1) + toPaise(0.2), toPaise(0.3));
  assert.equal(toPaise("4000.50"), 400050);
  assert.equal(fromPaise(400050), 4000.5);
  assert.equal(isDebitNormal("cash"), true);
  assert.equal(isDebitNormal("expense"), true);
  assert.equal(isDebitNormal("accounts_payable"), false);
  assert.equal(isDebitNormal("income"), false);
});

test("smsHelper: 2Factor sends the code to its OTP endpoint and reads the reply", async (t) => {
  const axios = require("axios");
  const sms = require("../../helpers/smsHelper");
  process.env.SMS_PROVIDER = "2factor";
  process.env.TWOFACTOR_API_KEY = "KEY-123";
  const calls = [];
  t.mock.method(axios, "get", async (url) => {
    calls.push(url);
    return { data: calls.length === 1 ? { Status: "Success", Details: "sess" } : { Status: "Error", Details: "Invalid API Key" } };
  });
  const ok = await sms.sendSms("+91 93604 74741", "code", { otp: "123456" });
  assert.deepEqual(ok, { ok: true, provider: "2factor" });
  assert.equal(calls[0], "https://2factor.in/API/V1/KEY-123/SMS/9360474741/123456");
  const bad = await sms.sendSms("9360474741", "code", { otp: "654321" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "Invalid API Key");
  delete process.env.TWOFACTOR_API_KEY;
  process.env.SMS_PROVIDER = "console";
});

test("smsHelper: SMS Gateway for Android posts the message to the phone app", async (t) => {
  const axios = require("axios");
  const sms = require("../../helpers/smsHelper");
  process.env.SMS_PROVIDER = "smsgate";
  process.env.SMSGATE_USERNAME = "USER1";
  process.env.SMSGATE_PASSWORD = "PASS1";
  const calls = [];
  t.mock.method(axios, "post", async (url, body, opts) => {
    calls.push({ url, body, opts });
    return { status: 202, data: { id: "m1", state: "Pending" } };
  });
  assert.equal(sms.canDeliver(), true);
  const r = await sms.sendSms("9360474741", "code 123456", { otp: "123456" });
  assert.deepEqual(r, { ok: true, provider: "smsgate" });
  assert.equal(calls[0].url, "https://api.sms-gate.app/3rdparty/v1/message");
  assert.deepEqual(calls[0].body, { message: "code 123456", phoneNumbers: ["+919360474741"] });
  assert.deepEqual(calls[0].opts.auth, { username: "USER1", password: "PASS1" });

  process.env.SMSGATE_URL = "http://192.168.1.20:8080/";
  await sms.sendSms("9360474741", "x");
  assert.equal(calls[1].url, "http://192.168.1.20:8080/message", "local server mode");
  for (const k of ["SMSGATE_URL", "SMSGATE_USERNAME", "SMSGATE_PASSWORD"]) delete process.env[k];
  process.env.SMS_PROVIDER = "console";
});
