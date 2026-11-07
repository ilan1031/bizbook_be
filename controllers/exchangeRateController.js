// Exchange rates: the rate book for foreign currencies against the
// organisation's base currency, and a converter that uses it. Each rate says
// what one unit of the currency was worth in base currency on a date; a
// conversion uses the latest rate on or before the date asked for.
const mongoose = require("mongoose");
const ST_CODES = require("../helpers/statusCodeHelpers");
const ExchangeRate = require("../model/exchangeRateSchema");

const MAX_RATE = 1e7;
const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const orgOf = (req) => {
  const raw = String(req.query.org_id || req.body?.org_id || "");
  return /^\d+$/.test(raw) ? raw : null;
};
const CODE = /^[A-Za-z]{3}$/;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

const strictDate = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
};
const today = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};

const baseCurrency = async (org) => {
  const o = await mongoose.model("Organization").findOne({ organization_id: Number(org) }, { currency_code: 1 }).lean();
  return String(o?.currency_code || "INR").toUpperCase();
};

// Base-currency value of one unit of `code` on `date`, or null when no rate is on or before it.
const rateOn = async (org, base, code, date) => {
  if (code === base) return { rate: 1, date };
  const r = await ExchangeRate.findOne({ organization_id: org, currency_code: code, date: { $lte: date } }).sort({ date: -1 }).lean();
  return r ? { rate: r.rate, date: r.date } : null;
};

class ExchangeRateController {
  // GET /currencies/rates?org_id=&currency=
  async list(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const q = { organization_id: org };
      if (req.query.currency) {
        if (!CODE.test(req.query.currency)) return bad(res, "Currency codes have three letters, like USD");
        q.currency_code = String(req.query.currency).toUpperCase();
      }
      const [rows, base] = await Promise.all([ExchangeRate.find(q).sort({ date: -1, currency_code: 1 }).limit(500).lean(), baseCurrency(org)]);
      res.status(ST_CODES.OK).json({ status: true, data: rows, base_currency: base });
    } catch (error) {
      console.error("rates list error", error);
      return bad(res, "Couldn't load exchange rates", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /currencies/summary?org_id=  the latest rate of each currency
  async summary(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const latest = await ExchangeRate.aggregate([
        { $match: { organization_id: org } },
        { $sort: { date: -1 } },
        { $group: { _id: "$currency_code", rate: { $first: "$rate" }, date: { $first: "$date" }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      res.status(ST_CODES.OK).json({ status: true, base_currency: await baseCurrency(org), data: latest.map((l) => ({ currency_code: l._id, rate: l.rate, date: l.date, rates_recorded: l.count })) });
    } catch (error) {
      console.error("rates summary error", error);
      return bad(res, "Couldn't load currencies", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /currencies/rates  { org_id, currency_code, date, rate, note? }  (same currency and date: updated)
  async save(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const code = String(req.body?.currency_code || "").trim();
      if (!CODE.test(code)) return bad(res, "Currency codes have three letters, like USD");
      const base = await baseCurrency(org);
      if (code.toUpperCase() === base) return bad(res, `${base} is your base currency, so it needs no rate`);
      const date = strictDate(req.body?.date);
      if (!date) return bad(res, "Enter a valid date");
      if (date > today()) return bad(res, "A rate can't be dated in the future");
      const rate = Number(req.body?.rate);
      if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_RATE) return bad(res, "The rate must be more than zero");
      if (Math.abs(rate * 1e6 - Math.round(rate * 1e6)) > 1e-4) return bad(res, "Rates can have at most 6 decimal places");
      const doc = await ExchangeRate.findOneAndUpdate(
        { organization_id: org, currency_code: code.toUpperCase(), date },
        { $set: { rate, note: String(req.body?.note || "").trim().slice(0, 200), admin_id: res.locals?.user_id } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
      res.status(ST_CODES.OK).json({ status: true, data: doc });
    } catch (error) {
      console.error("rates save error", error);
      return bad(res, "Couldn't save the rate", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // DELETE /currencies/rates/:id
  async remove(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Rate not found", ST_CODES.NOT_FOUND);
      const r = await ExchangeRate.findOneAndDelete({ _id: req.params.id, organization_id: org });
      if (!r) return bad(res, "Rate not found", ST_CODES.NOT_FOUND);
      res.status(ST_CODES.OK).json({ status: true, message: "Rate removed" });
    } catch (error) {
      console.error("rates remove error", error);
      return bad(res, "Couldn't remove the rate", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /currencies/convert?org_id=&from=USD&to=INR&amount=100&date=YYYY-MM-DD
  async convert(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const base = await baseCurrency(org);
      const from = String(req.query.from || base).trim().toUpperCase();
      const to = String(req.query.to || base).trim().toUpperCase();
      if (!CODE.test(from) || !CODE.test(to)) return bad(res, "Currency codes have three letters, like USD");
      const amount = Number(req.query.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1e13) return bad(res, "Enter a valid amount");
      const date = req.query.date ? strictDate(req.query.date) : today();
      if (!date) return bad(res, "Enter a valid date");
      const [a, b] = await Promise.all([rateOn(org, base, from, date), rateOn(org, base, to, date)]);
      if (!a) return bad(res, `No ${from} rate is on file for ${req.query.date || "today"} or earlier`, ST_CODES.NOT_FOUND);
      if (!b) return bad(res, `No ${to} rate is on file for ${req.query.date || "today"} or earlier`, ST_CODES.NOT_FOUND);
      const rate = round6(a.rate / b.rate);
      res.status(ST_CODES.OK).json({
        status: true,
        data: { from, to, amount, rate, result: Math.round(amount * (a.rate / b.rate) * 100) / 100, base_currency: base, from_rate_date: a.date, to_rate_date: b.date },
      });
    } catch (error) {
      console.error("convert error", error);
      return bad(res, "Couldn't convert", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}

module.exports = new ExchangeRateController();
