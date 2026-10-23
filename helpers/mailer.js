// Account email: sign-in codes, sign-up alerts to the superadmin, approval
// notices. Gmail works for free with an App Password:
//   EMAIL_USER=you@gmail.com   EMAIL_PASS=<16-letter app password>
// Other SMTP servers: also set EMAIL_HOST (and EMAIL_PORT, default 465).
//
// Without EMAIL_USER/EMAIL_PASS, outside production the message is printed
// to the server log instead ("console"), so local sign-in still works.
// Never throws: returns { ok, channel?, error? }.
const nodemailer = require("nodemailer");

let transporter = null;

const isMailConfigured = () => Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
const isProduction = () => process.env.NODE_ENV === "production";
// Whether messages can go anywhere at all (a real mailbox, or the log locally).
const canSendMail = () => isMailConfigured() || !isProduction();

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

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const cleanList = (v) =>
  (Array.isArray(v) ? v : String(v || "").split(/[,;]/)).map((x) => String(x).trim()).filter(Boolean);

// Email to a customer or vendor on behalf of a business user. Gmail (and
// most SMTP servers) only deliver reliably from the authenticated mailbox,
// so the message is sent from it, shown under the business's name, and
// replies go to the user's own address (replyTo).
// Returns { ok, channel, messageId?, error? } - channel "console" means it
// was only printed (no mailbox configured) and nothing reached the customer.
const sendCustomerMail = async ({ to, cc, bcc, subject, html, text, businessName, replyTo, attachments }) => {
  const toList = cleanList(to);
  const bad = [...toList, ...cleanList(cc), ...cleanList(bcc)].find((a) => !EMAIL_RE.test(a));
  if (!toList.length) return { ok: false, error: "No recipient email address" };
  if (bad) return { ok: false, error: `"${bad}" isn't a valid email address` };
  if (!subject) return { ok: false, error: "Subject is required" };
  const mailbox = process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER;
  const name = String(businessName || "").replace(/["<>\r\n]/g, "").trim();
  const result = await sendMail({
    to: toList.join(", "),
    subject,
    html,
    text,
    from: mailbox ? (name ? `"${name}" <${mailbox}>` : mailbox) : undefined,
    extra: {
      cc: cleanList(cc).join(", ") || undefined,
      bcc: cleanList(bcc).join(", ") || undefined,
      replyTo: EMAIL_RE.test(String(replyTo || "")) ? replyTo : undefined,
      attachments,
    },
  });
  if (result.ok && result.channel !== "email") {
    return { ok: false, channel: result.channel, error: "Email isn't set up on the server (EMAIL_USER / EMAIL_PASS), so nothing was sent." };
  }
  return result;
};

const sendMail = async ({ to, subject, text, html, from, extra = {} }) => {
  if (!to) return { ok: false, error: "No email address" };
  if (!isMailConfigured()) {
    if (isProduction()) return { ok: false, error: "Email is not configured (EMAIL_USER / EMAIL_PASS)" };
    console.log(`[EMAIL:console] to ${to}: ${subject}\n${text}`);
    return { ok: true, channel: "console" };
  }
  try {
    const info = await getTransporter().sendMail({
      from: from || process.env.EMAIL_FROM || `BizBooks <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
      ...extra,
    });
    return { ok: true, channel: "email", messageId: info.messageId };
  } catch (err) {
    console.error("[mail] send failed:", err.message);
    return { ok: false, error: err.message };
  }
};

// The app's address for links in emails (first FRONTEND_URL).
const appUrl = (path = "") =>
  `${String(process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/+$/, "")}${path}`;

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A plain, readable email layout.
const layout = (title, bodyHtml) => `<!doctype html><html><body style="margin:0;background:#f6f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2430">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e5ec;border-radius:8px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e3e5ec;font-size:18px;font-weight:700;color:#1b7a2f">BizBooks</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;

module.exports = { isMailConfigured, canSendMail, sendMail, sendCustomerMail, appUrl, escapeHtml, layout };
