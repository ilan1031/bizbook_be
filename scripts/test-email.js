// Sends a test sign-in code by email, exactly as login does, and says
// whether it went out.
//
// Usage:  node scripts/test-email.js you@example.com
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { isMailConfigured } = require("../helpers/mailer");
const { sendLoginCode } = require("../helpers/accountEmails");

(async () => {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: node scripts/test-email.js <email address>");
    process.exit(1);
  }
  console.log(`Email: ${isMailConfigured() ? `on (sending as ${process.env.EMAIL_USER})` : "off (EMAIL_USER / EMAIL_PASS not set)"}`);
  const result = await sendLoginCode({ email: to }, "123456");
  if (result.ok && result.channel === "email") {
    console.log(`Sent test code 123456 to ${to}. Check the inbox (and spam folder).`);
    process.exit(0);
  }
  console.log(result.ok ? "Only written to this log: set EMAIL_USER / EMAIL_PASS to send for real." : `Not sent: ${result.error}`);
  process.exit(1);
})();
