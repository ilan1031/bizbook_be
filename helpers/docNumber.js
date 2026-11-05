// Per-organisation document numbers (INV-DDMMYY000001, ...).
//
// The form asks for the next number (peekDocNumber) and shows it; on save the
// submitted number is kept when it is free in that organisation, otherwise
// the next one is allocated (nextDocNumber). A counter per organisation, kind
// and day makes sure a number is never handed out twice, even after the
// document holding it was deleted.
const mongoose = require("mongoose");

const counters = () => mongoose.connection.db.collection("doc_counters");

const datePart = (d = new Date()) =>
  `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getFullYear()).slice(-2)}`;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const orgFilter = (orgId) => ({ $in: [String(orgId), Number(orgId)].filter((v) => v === v) });

// Highest sequence already used in the organisation for `base` (e.g. "INV-021126").
const highestUsed = async (Collection, field, orgId, base, digits) => {
  const re = new RegExp(`^${escapeRe(base)}(\\d{${digits}})$`);
  const docs = await Collection.find({ organization_id: orgFilter(orgId), [field]: { $regex: re } }, { [field]: 1 }).lean();
  let max = 0;
  for (const d of docs) {
    const m = re.exec(String(d[field] || ""));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
};

const format = (base, n, digits) => `${base}${String(n).padStart(digits, "0")}`;

// The number the next document would get, without reserving it.
const peekDocNumber = async (Collection, field, orgId, prefix, digits = 6) => {
  const base = `${prefix}-${datePart()}`;
  const key = `${field}:${orgId}:${base}`;
  const [used, counter] = await Promise.all([highestUsed(Collection, field, orgId, base, digits), counters().findOne({ _id: key })]);
  return format(base, Math.max(used, counter?.seq || 0) + 1, digits);
};

// Reserves and returns the next number.
const nextDocNumber = async (Collection, field, orgId, prefix, digits = 6) => {
  const base = `${prefix}-${datePart()}`;
  const key = `${field}:${orgId}:${base}`;
  const used = await highestUsed(Collection, field, orgId, base, digits);
  await counters().updateOne({ _id: key }, { $max: { seq: used } }, { upsert: true });
  const r = await counters().findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { returnDocument: "after", upsert: true });
  const seq = (r && (r.value ? r.value.seq : r.seq)) || used + 1;
  return format(base, seq, digits);
};

// Marks a number the user typed as used so it isn't handed out later.
const noteUsedNumber = async (field, orgId, prefix, number, digits = 6) => {
  const m = new RegExp(`^(${escapeRe(prefix)}-\\d{6})(\\d{${digits}})$`).exec(String(number || ""));
  if (!m) return;
  await counters().updateOne({ _id: `${field}:${orgId}:${m[1]}` }, { $max: { seq: parseInt(m[2], 10) } }, { upsert: true });
};

// Globally unique internal ids (invoice_id, ...) that are never reused after a delete.
const nextGlobalId = async (Collection, field, digits = 6) => {
  const base = datePart();
  const key = `${field}:global:${base}`;
  const re = new RegExp(`^${base}(\\d{${digits}})$`);
  const last = await Collection.findOne({ [field]: { $regex: re } }, { [field]: 1 }).sort({ [field]: -1 }).lean();
  const used = last ? parseInt(re.exec(last[field])[1], 10) : 0;
  await counters().updateOne({ _id: key }, { $max: { seq: used } }, { upsert: true });
  const r = await counters().findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { returnDocument: "after", upsert: true });
  const seq = (r && (r.value ? r.value.seq : r.seq)) || used + 1;
  return format(base, seq, digits);
};

module.exports = { peekDocNumber, nextDocNumber, noteUsedNumber, nextGlobalId, datePart };
