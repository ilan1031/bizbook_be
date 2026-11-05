// Guards the "send a document by email" endpoints (/email/send,
// /email/po-email/send, /email/po-email/resend/:id) so they can't be used as
// an open mail relay. Runs after authMiddleware, which has already checked
// that the user may email documents (helpers/rbac.js) and that the named
// organisation is theirs.
//
// - An organisation is required (so the tenant check above applies).
// - Recipients must be plain email addresses.
// - The From address is always the server's sender (EMAIL_FROM, or the
//   organisation's name with EMAIL_USER); whatever the client sent is
//   dropped, so nobody can spoof "ceo@bank.example".
const mongoose = require("mongoose");
const multer = require("multer");

// Some screens post the email as multipart/form-data; read its fields (and
// any attachments, kept in memory as req.files) before checking them.
const parseMultipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10 } }).any();
const fieldsReady = (req, res) =>
  new Promise((resolve, reject) => {
    if (!/multipart\/form-data/i.test(req.headers["content-type"] || "") || req._emailGuardParsed) return resolve();
    req._emailGuardParsed = true;
    parseMultipart(req, res, (err) => (err ? reject(err) : resolve()));
  });

const EMAIL_RE = /^[^\s@<>(),;:"\[\]\\]+@[^\s@<>(),;:"\[\]\\]+\.[A-Za-z]{2,}$/;
const MAX_RECIPIENTS = 20;

const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[,;]/))
    .map((s) => String(s).trim())
    .filter(Boolean);

const senderAddress = (orgName) => {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  const user = require("./mailer").fromAddress();
  if (!user) return '"BizBooks" <no-reply@bizbooks.local>';
  const name = String(orgName || "BizBooks").replace(/[<>"\r\n]/g, "").slice(0, 80);
  return `"${name}" <${user}>`;
};

const guardDocumentEmail = async (req, res, next) => {
  try {
    try {
      await fieldsReady(req, res);
    } catch (err) {
      return res.status(400).json({ status: false, success: false, message: `Couldn't read the attachments: ${err.message}` });
    }
    const orgId = String(
      req.query?.organization_id || req.query?.org_id || req.body?.organization_id || req.body?.org_id || ""
    );
    if (!/^\d+$/.test(orgId)) {
      return res.status(400).json({ status: false, success: false, message: "organization_id is required to send an email." });
    }
    const body = req.body || {};
    const to = list(body.to_email);
    const cc = list(body.cc_emails);
    const bcc = list(body.bcc_emails);
    if (!to.length) {
      return res.status(400).json({ status: false, success: false, message: "Enter the recipient's email address." });
    }
    const bad = [...to, ...cc, ...bcc].find((e) => !EMAIL_RE.test(e));
    if (bad) {
      return res.status(400).json({ status: false, success: false, message: `"${bad.slice(0, 80)}" isn't a valid email address.` });
    }
    if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) {
      return res.status(400).json({ status: false, success: false, message: `Send to at most ${MAX_RECIPIENTS} addresses at a time.` });
    }
    const org = await mongoose
      .model("Organization")
      .findOne({ organization_id: Number(orgId) }, { org_name: 1 })
      .lean();
    const from = senderAddress(org?.org_name);
    req.body = { ...body, organization_id: orgId, from_email: from };
    return next();
  } catch (error) {
    console.error("guardDocumentEmail error:", error);
    return res.status(500).json({ status: false, success: false, message: "Couldn't send the email." });
  }
};

module.exports = { guardDocumentEmail, senderAddress };
