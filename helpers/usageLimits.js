// Create limits the superadmin sets per user:
//   limits: { per_day, per_month, per_year, max_organizations }
// A missing or null value means no limit. Periods are calendar day / month /
// year in India time (UTC+5:30). The superadmin is never limited.
const mongoose = require("mongoose");
const CreateEvent = require("../model/createEventSchema");

const LIMIT_KEYS = ["per_day", "per_month", "per_year", "max_organizations"];
const PERIODS = [
  ["per_day", "day"],
  ["per_month", "month"],
  ["per_year", "year"],
];
const IST_MS = 330 * 60 * 1000;

// Start of the current day / month / year in India time, as a Date.
const periodStart = (period, now = new Date()) => {
  const local = new Date(now.getTime() + IST_MS);
  const y = local.getUTCFullYear();
  const m = period === "year" ? 0 : local.getUTCMonth();
  const d = period === "day" ? local.getUTCDate() : 1;
  return new Date(Date.UTC(y, m, d) - IST_MS);
};

// Validates limits sent by the superadmin. Returns { limits } or { error }.
const sanitizeLimits = (input) => {
  if (!input || typeof input !== "object") return { error: "Limits must be an object" };
  const limits = {};
  for (const key of LIMIT_KEYS) {
    const v = input[key];
    if (v === undefined || v === null || v === "") {
      limits[key] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) {
      return { error: `${key.replace("_", " ")} must be a whole number from 0 to 1,000,000, or empty for no limit` };
    }
    limits[key] = n;
  }
  return { limits };
};

// Creates so far in each period, for one or many users.
const usageFor = async (userIds) => {
  const ids = userIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const out = Object.fromEntries(ids.map((id) => [String(id), { day: 0, month: 0, year: 0 }]));
  if (!ids.length) return out;
  const rows = await CreateEvent.aggregate([
    { $match: { user_id: { $in: ids }, at: { $gte: periodStart("year") } } },
    {
      $group: {
        _id: "$user_id",
        year: { $sum: 1 },
        month: { $sum: { $cond: [{ $gte: ["$at", periodStart("month")] }, 1, 0] } },
        day: { $sum: { $cond: [{ $gte: ["$at", periodStart("day")] }, 1, 0] } },
      },
    },
  ]);
  for (const r of rows) out[String(r._id)] = { day: r.day, month: r.month, year: r.year };
  return out;
};

const PERIOD_WORD = { day: "today", month: "this month", year: "this year" };

// null when the user may create another record, else { code, message }.
const checkCreateLimit = async (user) => {
  if (!user || user.role === "superadmin") return null;
  const limits = user.limits || {};
  if (!PERIODS.some(([key]) => Number.isInteger(limits[key]))) return null;
  const used = (await usageFor([user._id]))[String(user._id)];
  for (const [key, period] of PERIODS) {
    const max = limits[key];
    if (Number.isInteger(max) && used[period] >= max) {
      return {
        code: "CREATE_LIMIT",
        message: `You've reached your limit of ${max} new record${max === 1 ? "" : "s"} ${PERIOD_WORD[period]}. Ask your administrator to raise it.`,
      };
    }
  }
  return null;
};

const recordCreate = (userId, page, count = 1) =>
  CreateEvent.insertMany(Array.from({ length: count }, () => ({ user_id: userId, page: page || "" })));

// How many more records the user may create right now (Infinity if no limit).
const remainingCreates = async (user) => {
  if (!user || user.role === "superadmin") return Infinity;
  const limits = user.limits || {};
  if (!PERIODS.some(([key]) => Number.isInteger(limits[key]))) return Infinity;
  const used = (await usageFor([user._id]))[String(user._id)];
  return Math.max(
    0,
    Math.min(...PERIODS.map(([key, period]) => (Number.isInteger(limits[key]) ? limits[key] - used[period] : Infinity)))
  );
};

// null when the user may add another organisation, else { code, message }.
const checkOrgLimit = async (user) => {
  if (!user || user.role === "superadmin") return null;
  const max = user.limits?.max_organizations;
  if (!Number.isInteger(max)) return null;
  const owned = await mongoose.model("Organization").countDocuments({ admin_id: user._id });
  if (owned < max) return null;
  return {
    code: "ORG_LIMIT",
    message: `Your account can have ${max} organisation${max === 1 ? "" : "s"}. Ask your administrator to raise the limit.`,
  };
};

module.exports = {
  LIMIT_KEYS,
  periodStart,
  sanitizeLimits,
  usageFor,
  checkCreateLimit,
  recordCreate,
  remainingCreates,
  checkOrgLimit,
};
