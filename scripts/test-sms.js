// Sends one test sign-in code exactly the way login does (SMS first, then
// email) and prints which way it went, or why it couldn't.
//
// Usage:  node scripts/test-sms.js <mobile> [email]
//   e.g.  node scripts/test-sms.js 9876543210 you@gmail.com
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const sms = require("../helpers/smsHelper");
const { isMailConfigured } = require("../helpers/mailer");
const { sendLoginCode } = require("../helpers/loginCode");

(async () => {
  const [mobile, email] = process.argv.slice(2);
  if (!mobile && !email) {
    console.error("Usage: node scripts/test-sms.js <mobile> [email]");
    process.exit(1);
  }
  console.log(`SMS:   ${sms.canDeliver() ? `on (${sms.provider()})` : `off (SMS_PROVIDER=${sms.provider()}${sms.provider() === "console" ? ", log only" : ", keys missing"})`}`);
  console.log(`Email: ${isMailConfigured() ? `on (${process.env.EMAIL_USER})` : "off (EMAIL_USER / EMAIL_PASS not set)"}`);
  const result = await sendLoginCode({ mobile, email }, "123456");
  if (result.ok && result.channel !== "console") {
    console.log(`Sent test code 123456 by ${result.channel} to ${result.sentTo}.`);
    process.exit(0);
  }
  console.log(result.ok ? "Only written to this log (no SMS or email set up)." : "Not sent: see the errors above.");
  process.exit(1);
})();
