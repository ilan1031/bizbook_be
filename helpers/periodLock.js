// The "books locked up to" date and the guard that enforces it.
//
// The guard is a route middleware (not a database hook) on purpose: it refuses
// the request before anything is saved, so a refused change never leaves a
// half-changed document behind, and unrelated work (stock revaluation, payments
// today against an old invoice) is never blocked. It looks at two things:
//   - dates in the request itself (a new or edited entry dated in a closed period)
//   - the existing entry the request changes, removes or voids (its own date)
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("./statusCodeHelpers");

const TTL_MS = 15 * 1000;
const cache = new Map(); // "admin:org" -> { at, locked_until }

const keyOf = (admin_id, org) => `${admin_id}:${org}`;
const forget = (admin_id, org) => cache.delete(keyOf(admin_id, org));

const lockedUntil = async (admin_id, organization_id) => {
  const key = keyOf(admin_id, organization_id);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.locked_until;
  const doc = await mongoose.model("PeriodLock").findOne({ organization_id: String(organization_id), admin_id }).select("locked_until").lean();
  const value = doc?.locked_until ? dayjs(doc.locked_until) : null;
  cache.set(key, { at: Date.now(), locked_until: value });
  return value;
};

// "YYYY-MM-DD…", "DD-MM-YYYY", a Date, or null when it isn't a date.
const toDay = (value) => {
  if (!value) return null;
  if (value instanceof Date) return dayjs(value).isValid() ? dayjs(value) : null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dayjs(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if ((m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/))) return dayjs(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  const d = dayjs(s);
  return d.isValid() ? d : null;
};

// Request body fields that carry the date an entry is booked on.
const BODY_DATE_KEYS = ["date", "billDate", "bill_date", "invoice_date", "journal_date", "payment_date", "expense_date", "transaction_date"];

const orgOf = (req) => req.query?.org_id || req.query?.organization_id || req.query?.orgId || req.body?.org_id || req.body?.organization_id || req.params?.org_id;

// How to find the date of the entry a request points at, per kind of entry.
const RESOLVERS = {
  invoice: async (req, org) => {
    const id = req.query?.invoice_id;
    if (!id || !/^\d+$/.test(String(org))) return null;
    const doc = await mongoose.model("Invoice").findOne({ organization_id: Number(org), invoice_id: String(id) }).select("date").lean();
    return doc?.date;
  },
  bill: async (req, org) => {
    const id = req.query?.bill_id;
    if (!id || !/^\d+$/.test(String(org))) return null;
    const filter = { organization_id: Number(org), $or: [{ bill_number: String(id) }, ...(mongoose.isValidObjectId(id) ? [{ _id: id }] : [])] };
    const doc = await mongoose.model("PO_bill").findOne(filter).select("billDate").lean();
    return doc?.billDate;
  },
  expense: async (req, org) => {
    const id = req.query?.expense_id;
    if (!id) return null;
    const doc = await mongoose.model("Expense").findOne({ organization_id: String(org), unique_EX_id: String(id) }).select("date").lean();
    return doc?.date;
  },
  customerPayment: async (req, org) => {
    const id = req.query?.payment_id;
    if (!id) return null;
    const doc = await mongoose.model("CustomerPayment").findOne({ organization_id: String(org), payment_id: String(id) }).select("date").lean();
    return doc?.date;
  },
  paymentMade: async (req, org) => {
    const id = req.query?.payment_id;
    if (!id || !/^\d+$/.test(String(org))) return null;
    const doc = await mongoose.model("Payment").findOne({ organization_id: Number(org), payment_id: String(id) }).select("date").lean();
    return doc?.date;
  },
  manualJournal: async (req, org) => {
    const id = req.params?.journal_id;
    if (!id) return null;
    const doc = await mongoose.model("Journal").findOne({ organization_id: String(org), journal_id: String(id) }).select("journal_date").lean();
    return doc?.journal_date;
  },
  creditDocument: (modelName) => async (req, org) => {
    const id = req.params?.id;
    if (!id) return null;
    const { CreditNote, VendorCredit } = require("../model/creditDocumentModels");
    const Model = modelName === "vendor" ? VendorCredit : CreditNote;
    const doc = await Model.findOne({ organization_id: String(org), credit_number: String(id) }).select("date").lean();
    return doc?.date;
  },
};

RESOLVERS.creditNote = RESOLVERS.creditDocument("customer");
RESOLVERS.vendorCredit = RESOLVERS.creditDocument("vendor");

const message = (locked) => `The books are locked up to ${locked.format("DD-MM-YYYY")}. Entries dated on or before that day can't be added, changed or removed. Ask for the lock to be moved first.`;

// periodLock("invoice") etc. Put it after the auth middleware (and after the
// file-upload middleware, so a multipart body has been read).
const guard = (kind) => async (req, res, next) => {
  try {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const org = orgOf(req);
    const admin_id = res.locals.user_id;
    if (!org || !admin_id) return next();
    const locked = await lockedUntil(admin_id, org);
    if (!locked) return next();

    const days = [];
    for (const key of BODY_DATE_KEYS) {
      const d = toDay(req.body?.[key]);
      if (d) days.push(d);
    }
    const resolve = typeof kind === "function" ? kind : RESOLVERS[kind];
    if (resolve) {
      const existing = toDay(await resolve(req, org));
      if (existing) days.push(existing);
    }
    if (days.some((d) => !d.startOf("day").isAfter(locked.startOf("day")))) {
      return res.status(ST_CODES.FORBIDDEN).json({ status: false, success: false, code: "PERIOD_LOCKED", message: message(locked), locked_until: locked.format("YYYY-MM-DD") });
    }
    return next();
  } catch (error) {
    // A failure of the guard itself must not open the books: refuse and say so.
    console.log("period lock guard error", error);
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, success: false, message: "Couldn't check the period lock. Please try again." });
  }
};

// For code that posts entries itself (depreciation): throws a clear error.
const assertUnlocked = async (admin_id, organization_id, dates) => {
  const locked = await lockedUntil(admin_id, organization_id);
  if (!locked) return;
  const hit = (dates || []).map(toDay).filter(Boolean).find((d) => !d.startOf("day").isAfter(locked.startOf("day")));
  if (hit) {
    const error = new Error(message(locked));
    error.code = "PERIOD_LOCKED";
    throw error;
  }
};

module.exports = { guard, assertUnlocked, lockedUntil, forget, toDay, message };
