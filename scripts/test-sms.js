// Sends one test sign-in code (the same way login does) and prints exactly
// what the SMS provider answered.
//
// Usage:  node scripts/test-sms.js 9876543210
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { sendSms, provider, canDeliver } = require("../helpers/smsHelper");

(async () => {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: node scripts/test-sms.js <mobile number>");
    process.exit(1);
  }
  console.log(`Provider: ${provider()}${canDeliver() ? "" : " (cannot reach phones: SMS is only logged or keys are missing)"}`);
  const result = await sendSms(to, "BizBooks: your sign-in code is 123456 (test).", { otp: "123456" });
  console.log(result.ok ? `Sent to ${to} via ${result.provider}.` : `Not sent: ${result.error}`);
  process.exit(result.ok && canDeliver() ? 0 : 1);
})();
