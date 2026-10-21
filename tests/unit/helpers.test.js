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
