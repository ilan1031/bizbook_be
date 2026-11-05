// Sends mail through an email provider's HTTPS API instead of SMTP.
//
// Some hosts (Render's free plan, among others) block outbound SMTP ports
// 25, 465 and 587, so Gmail/SMTP just times out there. An HTTPS API uses
// port 443, which is never blocked.
//
//   BREVO_API_KEY=...   (Brevo, free 300 emails/day)   or
//   RESEND_API_KEY=...  (Resend)
//   EMAIL_FROM_ADDRESS=you@yourdomain.com   a sender the provider has verified
//
// This is a nodemailer transport (see mailer.getTransporter), so everything
// that already calls transporter.sendMail({ from, to, cc, bcc, subject, text,
// html, replyTo, attachments }) works unchanged.
const fs = require("fs");
const addressParser = require("nodemailer/lib/addressparser");

const PROVIDERS = {
  brevo: { label: "Brevo", keyEnv: "BREVO_API_KEY", url: "https://api.brevo.com/v3/smtp/email" },
  resend: { label: "Resend", keyEnv: "RESEND_API_KEY", url: "https://api.resend.com/emails" },
};
const TIMEOUT_MS = 15000;

// "brevo" | "resend" | null (SMTP). EMAIL_PROVIDER=smtp forces SMTP.
const apiProvider = (env = process.env) => {
  const wanted = String(env.EMAIL_PROVIDER || "").toLowerCase();
  if (wanted === "smtp") return null;
  if (PROVIDERS[wanted] && env[PROVIDERS[wanted].keyEnv]) return wanted;
  return Object.keys(PROVIDERS).find((name) => env[PROVIDERS[name].keyEnv]) || null;
};

const providerLabel = (name) => PROVIDERS[name]?.label || name;

// [{ name, address }] from a string, an address object, or an array of them.
const toList = (value) => {
  const out = [];
  for (const item of [].concat(value || [])) {
    if (!item) continue;
    if (typeof item === "string") {
      for (const a of addressParser(item)) {
        if (a.group) out.push(...a.group);
        else if (a.address) out.push({ name: a.name || "", address: a.address });
      }
    } else if (item.address) {
      out.push({ name: item.name || "", address: item.address });
    }
  }
  return out;
};

const attachmentList = (attachments) =>
  (attachments || []).map((a) => {
    let content = a.content;
    if (a.path && content === undefined) content = fs.readFileSync(a.path);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ""), a.encoding === "base64" ? "base64" : "utf8");
    return { name: a.filename || "attachment", content: buf.toString("base64") };
  });

// The provider's request body for one message.
const buildPayload = (name, data) => {
  const from = toList(data.from)[0];
  if (!from) throw new Error("No sender address (set EMAIL_FROM_ADDRESS)");
  const to = toList(data.to);
  if (!to.length) throw new Error("No recipient email address");
  const cc = toList(data.cc);
  const bcc = toList(data.bcc);
  const replyTo = toList(data.replyTo)[0];
  const files = attachmentList(data.attachments);
  const plain = (list) => list.map((a) => a.address);

  if (name === "brevo") {
    const person = (a) => (a.name ? { email: a.address, name: a.name } : { email: a.address });
    return {
      sender: person(from),
      to: to.map(person),
      ...(cc.length ? { cc: cc.map(person) } : {}),
      ...(bcc.length ? { bcc: bcc.map(person) } : {}),
      ...(replyTo ? { replyTo: person(replyTo) } : {}),
      subject: data.subject || "",
      ...(data.html ? { htmlContent: String(data.html) } : {}),
      ...(data.text ? { textContent: String(data.text) } : {}),
      ...(!data.html && !data.text ? { textContent: " " } : {}),
      ...(files.length ? { attachment: files } : {}),
    };
  }
  const display = (a) => (a.name ? `${a.name.replace(/["<>\r\n]/g, "")} <${a.address}>` : a.address);
  return {
    from: display(from),
    to: plain(to),
    ...(cc.length ? { cc: plain(cc) } : {}),
    ...(bcc.length ? { bcc: plain(bcc) } : {}),
    ...(replyTo ? { reply_to: replyTo.address } : {}),
    subject: data.subject || "",
    ...(data.html ? { html: String(data.html) } : {}),
    ...(data.text ? { text: String(data.text) } : {}),
    ...(files.length ? { attachments: files.map((f) => ({ filename: f.name, content: f.content })) } : {}),
  };
};

const request = async (name, payload, env = process.env) => {
  const provider = PROVIDERS[name];
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (name === "brevo") headers["api-key"] = env[provider.keyEnv];
  else headers.authorization = `Bearer ${env[provider.keyEnv]}`;

  let res;
  try {
    res = await fetch(provider.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new Error(`${provider.label} didn't answer${timedOut ? ` within ${TIMEOUT_MS / 1000}s` : `: ${err.message}`}`);
  }
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text.slice(0, 200) };
  }
  if (!res.ok) {
    const reason = body.message || body.error?.message || body.error || `HTTP ${res.status}`;
    throw new Error(`${provider.label} refused the email (${res.status}): ${reason}`);
  }
  return body.messageId || body.id || "";
};

// A nodemailer transport for the configured provider.
const httpTransport = (name = apiProvider()) => ({
  name: `${name}-api`,
  version: "1.0.0",
  send(mail, callback) {
    (async () => {
      const data = mail.data;
      const messageId = await request(name, buildPayload(name, data));
      const recipients = toList(data.to).map((a) => a.address);
      return { messageId, envelope: { from: toList(data.from)[0]?.address, to: recipients }, accepted: recipients, rejected: [], pending: [], response: `${providerLabel(name)} API accepted` };
    })().then((info) => callback(null, info), (err) => callback(err));
  },
});

module.exports = { apiProvider, providerLabel, buildPayload, httpTransport, PROVIDERS };
