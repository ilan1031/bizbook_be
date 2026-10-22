// Account email (sign-in codes) through SMTP. Gmail works for free with an
// App Password: EMAIL_USER=you@gmail.com, EMAIL_PASS=<16-letter app password>.
// Other SMTP servers: also set EMAIL_HOST (and EMAIL_PORT, default 465).
// Never throws: returns { ok, error? }.
const nodemailer = require("nodemailer");

let transporter = null;

const isMailConfigured = () => Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const getTransporter = () => {
  if (!transporter) {
    const port = Number(process.env.EMAIL_PORT || 465);
    transporter = nodemailer.createTransport(
      process.env.EMAIL_HOST
        ? { host: process.env.EMAIL_HOST, port, secure: port === 465, auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } }
        : { service: "gmail", auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } }
    );
  }
  return transporter;
};

const sendMail = async ({ to, subject, text, html }) => {
  if (!isMailConfigured()) return { ok: false, error: "Email is not configured (EMAIL_USER / EMAIL_PASS)" };
  if (!to) return { ok: false, error: "No email address" };
  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || `BizBooks <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (err) {
    console.error("[mail] send failed:", err.message);
    return { ok: false, error: err.message };
  }
};

module.exports = { isMailConfigured, sendMail };
