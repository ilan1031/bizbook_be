// Account email: sign-in codes, sign-up alerts to the superadmin, approval
// notices. Gmail works for free with an App Password:
//   EMAIL_USER=you@gmail.com   EMAIL_PASS=<16-letter app password>
// Other SMTP servers: also set EMAIL_HOST (and EMAIL_PORT, default 465).
//
// Hosts that block SMTP (Render's free plan blocks ports 25/465/587) need an
// HTTPS provider instead: BREVO_API_KEY or RESEND_API_KEY plus
// EMAIL_FROM_ADDRESS (a sender the provider has verified); see httpMail.js.
//
// Without EMAIL_USER/EMAIL_PASS, outside production the message is printed
// to the server log instead ("console"), so local sign-in still works.
// Never throws: returns { ok, channel?, error? }.
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const { apiProvider, providerLabel, httpTransport } = require("./httpMail");

let transporter = null;

// The address mail is sent from: EMAIL_FROM_ADDRESS, or the SMTP login.
const fromAddress = () => process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER || "";
const isMailConfigured = () =>
  apiProvider() ? Boolean(fromAddress()) : Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
// What to set, for messages shown to the person fixing the setup.
const MAIL_SETUP_HINT = "set EMAIL_USER and EMAIL_PASS (Gmail App Password), or BREVO_API_KEY / RESEND_API_KEY with EMAIL_FROM_ADDRESS";
const isProduction = () => process.env.NODE_ENV === "production";
// Whether messages can go anywhere at all (a real mailbox, or the log locally).
const canSendMail = () => isMailConfigured() || !isProduction();

// Give up on a mail server that doesn't answer in seconds, not nodemailer's
// default 2 minutes: a sign-in must not hang that long while mail is down.
const TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 };

// Where mail goes, without credentials: "smtp.example.com:587", or Gmail.
const mailTarget = () =>
  apiProvider()
    ? `${providerLabel(apiProvider())} API (HTTPS)`
    : process.env.EMAIL_HOST
    ? `${process.env.EMAIL_HOST}:${Number(process.env.EMAIL_PORT || 465)}`
    : "smtp.gmail.com:465 (EMAIL_HOST not set)";

// Render's free plan (RENDER is set on Render) blocks SMTP, so a timeout there
// is that block, not the credentials.
const withHint = (message) =>
  !apiProvider() && process.env.RENDER && /timeout|ETIMEDOUT|ECONNREFUSED|ENETUNREACH/i.test(message)
    ? `${message}. Render's free plan blocks SMTP ports (25, 465, 587): send through an HTTPS provider instead by setting BREVO_API_KEY (or RESEND_API_KEY) and EMAIL_FROM_ADDRESS`
    : message;

const getTransporter = () => {
  if (!transporter && apiProvider()) transporter = nodemailer.createTransport(httpTransport());
  if (!transporter) {
    const port = Number(process.env.EMAIL_PORT || 465);
    const auth = { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS };
    transporter = nodemailer.createTransport(
      process.env.EMAIL_HOST
        ? { host: process.env.EMAIL_HOST, port, secure: port === 465, auth, ...TIMEOUTS }
        : { service: "gmail", auth, ...TIMEOUTS }
    );
  }
  return transporter;
};

// The result of the last real send, kept in Mongo (one document) so the
// superadmin's Users & Access page can show whether mail is working.
const HEALTH_DOC = "account";
const recordMailHealth = (fields) => {
  try {
    if (mongoose.connection.readyState !== 1) return;
    mongoose.connection.db
      .collection("mail_status")
      .updateOne({ _id: HEALTH_DOC }, { $set: { ...fields, checked_at: new Date() } }, { upsert: true })
      .catch(() => {});
  } catch (_) {
    // Bookkeeping must never break a send.
  }
};
const getMailHealth = async () => {
  try {
    if (mongoose.connection.readyState !== 1) return null;
    return await mongoose.connection.db.collection("mail_status").findOne({ _id: HEALTH_DOC }, { projection: { _id: 0 } });
  } catch (_) {
    return null;
  }
};

// Email to a customer or vendor on behalf of a business user. (Added on the
// uat branch.) The EMAIL_RE / cleanList helpers and sendCustomerMail follow.
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

// fromName shows as the sender's name (the address stays EMAIL_USER, or
// EMAIL_FROM when set); replyTo sends replies somewhere else. `from` and
// `extra` (cc, bcc, attachments) are for customer mail (sendCustomerMail).
const sendMail = async ({ to, subject, text, html, from, fromName, replyTo, extra = {} }) => {
  if (!to) return { ok: false, error: "No email address" };
  if (!isMailConfigured()) {
    if (isProduction()) return { ok: false, error: `Email is not configured: ${MAIL_SETUP_HINT}` };
    console.log(`[EMAIL:console] to ${to}: ${subject}\n${text}`);
    return { ok: true, channel: "console" };
  }
  const target = mailTarget();
  try {
    const info = await getTransporter().sendMail({
      from: from || process.env.EMAIL_FROM || `${String(fromName || "BizBooks").replace(/[<>"]/g, "")} <${fromAddress()}>`,
      ...(replyTo ? { replyTo } : {}),
      to,
      subject,
      text,
      html,
      ...extra,
    });
    recordMailHealth({ ok: true, target, error: "" });
    return { ok: true, channel: "email", target, messageId: info.messageId };
  } catch (err) {
    const message = withHint(err.message);
    console.error(`[mail] send failed via ${target}:`, message);
    recordMailHealth({ ok: false, target, error: message });
    return { ok: false, error: message, target };
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

module.exports = { isMailConfigured, fromAddress, canSendMail, sendMail, sendCustomerMail, appUrl, escapeHtml, layout, getTransporter, getMailHealth, mailTarget };
