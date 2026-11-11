// Checks every field of every JSON request body against the shared rules in
// helpers/fieldRules.js. A wrong value is refused with a message that names the
// field and shows the expected format; clean values (GSTIN, PAN, IFSC and the
// like in capitals, names with tidy spacing) are stored in their clean form.
const { kindForName, validate, normalize, KINDS } = require("../helpers/fieldRules");

const MAX_DEPTH = 7;
const MAX_ARRAY = 1000;
// Bodies that are not form fields.
// Sign-in takes an email or a mobile number in its "email" box.
const SIGN_IN = /^\/api\/v1\/(user\/(user-login|verify-login-otp)|client\/login)$/;
// Bank statement import reports bad rows itself, row by row.
const EXEMPT = [/^\/api\/v1\/webhooks\//, /^\/api\/v1\/import(\/|-|$)/, /^\/api\/v1\/ask$/, /^\/api\/v1\/banking\/transactions\/import$/, SIGN_IN];

const pretty = (path) =>
  String(path)
    .split(".")
    .pop()
    .replace(/\[\d*\]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

// Walks a value; returns { path, message } for the first bad field, or null.
const walk = (node, path, depth, parent) => {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < Math.min(node.length, MAX_ARRAY); i++) {
      const v = node[i];
      if (v !== null && typeof v === "object") {
        const hit = walk(v, `${path}[${i}]`, depth + 1, node);
        if (hit) return hit;
      }
    }
    return null;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    const here = path ? `${path}.${key}` : key;
    if (value !== null && typeof value === "object") {
      const hit = walk(value, here, depth + 1, node);
      if (hit) return hit;
      continue;
    }
    const kind = kindForName(key);
    if (!kind) continue;
    const error = validate(kind, value, { country: node.country || parent?.country });
    if (error) return { path: here, message: `${pretty(key)}: ${error}` };
    if (typeof value === "string" && KINDS[kind]?.normalize) {
      const clean = normalize(kind, value);
      if (clean !== value) node[key] = clean;
    }
  }
  return null;
};

const fieldValidation = (req, res, next) => {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();
  if (!req.body || typeof req.body !== "object") return next();
  if (EXEMPT.some((re) => re.test(req.path) || re.test(req.originalUrl.split("?")[0]))) return next();
  const hit = walk(req.body, "", 0, null);
  if (!hit) return next();
  return res.status(400).json({ status: false, success: false, message: hit.message, field: hit.path });
};

module.exports = fieldValidation;
