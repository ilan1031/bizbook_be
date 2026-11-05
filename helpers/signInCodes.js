// One-time sign-in codes (the second step of sign-in). Emailed codes and codes
// a superadmin issues from Users & Access share everything here: the hash
// (HMAC with JWT_SECRET, never the plain code), the 5-minute expiry, the
// attempt limit, and the rule that a code is used once (completeLogin clears it).
const crypto = require("crypto");

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// Superadmin-issued codes: at most this many per account in the window.
const ISSUE_WINDOW_MS = 15 * 60 * 1000;
const ISSUE_MAX = 5;
// The audit trail kept on each user (newest entries win).
const AUDIT_KEEP = 50;

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const hashOtp = (code) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(String(code)).digest("hex");

// A code that could not be emailed is kept readable, for its 5 minutes only,
// so the superadmin can pass it on from Users & Access. It is encrypted
// (AES-256-GCM, keyed from JWT_SECRET) so it is never plain text in the
// database, and only the superadmin's list decrypts it.
const sealKey = () => crypto.createHash("sha256").update(`sign-in-code:${process.env.JWT_SECRET}`).digest();
const sealCode = (code) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const body = Buffer.concat([cipher.update(String(code), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
};
const unsealCode = (sealed) => {
  try {
    const [iv, tag, body] = String(sealed).split(".").map((p) => Buffer.from(p, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", sealKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};

module.exports = {
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  ISSUE_WINDOW_MS,
  ISSUE_MAX,
  AUDIT_KEEP,
  newCode,
  hashOtp,
  sealCode,
  unsealCode,
};
