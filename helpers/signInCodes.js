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

module.exports = { OTP_TTL_MS, OTP_MAX_ATTEMPTS, ISSUE_WINDOW_MS, ISSUE_MAX, AUDIT_KEEP, newCode, hashOtp };
