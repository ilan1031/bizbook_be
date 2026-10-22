// Delivers sign-in codes. Tries, in order:
//   1. SMS, when a provider that reaches phones is set (SMS_PROVIDER) and the
//      user has a mobile number;
//   2. email, when EMAIL_USER / EMAIL_PASS are set;
//   3. outside production only, the server log (SMS_PROVIDER=console).
// Returns { ok, channel, sentTo } where sentTo is a masked mobile/email.
const sms = require("./smsHelper");
const mailer = require("./mailer");

const isProduction = () => process.env.NODE_ENV === "production";

const maskMobile = (m) => {
  const d = String(m || "").replace(/\D/g, "");
  return d ? `******${d.slice(-4)}` : "";
};
const maskEmail = (e) => {
  const [name, domain] = String(e || "").split("@");
  if (!domain) return "";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(name.length - 2, 1))}@${domain}`;
};

// Whether any way of delivering a code is set up.
const canSendCodes = () =>
  sms.canDeliver() || mailer.isMailConfigured() || (!isProduction() && sms.provider() === "console");

const sendLoginCode = async (user, code) => {
  const text = `BizBooks: your sign-in code is ${code}. It expires in 5 minutes. Don't share it with anyone.`;
  const errors = [];

  if (sms.canDeliver() && user.mobile) {
    const r = await sms.sendSms(user.mobile, text, { otp: code });
    if (r.ok) return { ok: true, channel: "sms", sentTo: maskMobile(user.mobile) };
    errors.push(`sms: ${r.error}`);
  }

  if (mailer.isMailConfigured() && user.email) {
    const r = await mailer.sendMail({
      to: user.email,
      subject: `${code} is your BizBooks sign-in code`,
      text: `${text}\n\nIf you didn't try to sign in, change your password.`,
      html: `<p>Your BizBooks sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 5 minutes. Don't share it with anyone.</p><p style="color:#777">If you didn't try to sign in, change your password.</p>`,
    });
    if (r.ok) return { ok: true, channel: "email", sentTo: maskEmail(user.email) };
    errors.push(`email: ${r.error}`);
  }

  if (!isProduction() && sms.provider() === "console") {
    await sms.sendSms(user.mobile || "0000000000", text, { otp: code });
    return { ok: true, channel: "console", sentTo: "the server log" };
  }

  if (errors.length) console.error("[login code] not delivered:", errors.join("; "));
  return { ok: false, channel: null, sentTo: "" };
};

module.exports = { canSendCodes, sendLoginCode, maskEmail, maskMobile };
