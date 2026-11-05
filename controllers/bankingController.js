// Banking: import a bank or cash statement, match its lines to journal entries,
// and reconcile the account (does the statement agree with the books?).
// Everything is scoped to the organisation and its owner; sums are in paise.
const crypto = require("crypto");
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { POSTED_JOURNALS, toPaise, fromPaise, getAccountsMap } = require("../helpers/accountingHelper");

const Journal = () => mongoose.model("Journal");
const Tx = () => mongoose.model("BankTransaction");

const MAX_ROWS = 2000;
const CASH_TYPES = ["bank", "cash"];

const bad = (res, message, extra = {}) => res.status(ST_CODES.BAD_REQUEST).json({ status: false, message, ...extra });
const fail = (res, label, error) => {
  console.log(`${label} error`, error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: `Couldn't ${label}` });
};

// "YYYY-MM-DD", "DD-MM-YYYY" or "DD/MM/YYYY"; null when it isn't a real date.
const parseDate = (value) => {
  const s = String(value ?? "").trim();
  let y, mo, d;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = dayjs(new Date(y, mo - 1, d));
  return date.year() === y && date.month() === mo - 1 && date.date() === d ? date : null;
};

// Numbers as banks write them: "1,234.50", "(500.00)", "-500", "500 Dr".
const parseMoney = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim().replace(/[₹,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/dr$/i.test(s)) {
    negative = true;
    s = s.slice(0, -2);
  } else if (/cr$/i.test(s)) s = s.slice(0, -2);
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
};

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Looks up the account and refuses anything that isn't a bank or cash account.
const bankAccount = async (organization_id, admin_id, account_id) => {
  const accounts = await getAccountsMap(organization_id, admin_id);
  const account = accounts.get(String(account_id || ""));
  if (!account || !CASH_TYPES.includes(account.account_type)) return null;
  return account;
};

// Book balance of the account in paise as of a date (debits positive).
const bookLines = async (organization_id, admin_id, account_id, upTo) => {
  const journals = await Journal()
    .find(
      { organization_id: String(organization_id), admin_id, "line_items.coa_account_id": String(account_id), ...(upTo ? { journal_date: { $lte: upTo.endOf("day").toDate() } } : {}), ...POSTED_JOURNALS },
      { journal_id: 1, journal_date: 1, type: 1, customer_name: 1, vendor_name: 1, reference_number: 1, notes: 1, line_items: 1 }
    )
    .sort({ journal_date: 1 })
    .lean();
  return journals.map((j) => {
    let signed = 0;
    for (const l of j.line_items || []) {
      if (l.coa_account_id !== String(account_id)) continue;
      signed += l.creditOrDebit === "Debit" ? toPaise(l.amount || 0) : -toPaise(l.amount || 0);
    }
    return { journal: j, signed };
  });
};

const txOut = (t) => ({ _id: t._id, date: dayjs(t.date).format("YYYY-MM-DD"), description: t.description, reference: t.reference, amount: t.amount, status: t.status, matched_journal_id: t.matched_journal_id || "", account_id: t.account_id });

class BankingController {
  // GET /banking/accounts?org_id=  the bank and cash accounts with their balances.
  async listAccounts(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const accounts = await getAccountsMap(organization_id, admin_id);
      const list = [...accounts.values()].filter((a) => CASH_TYPES.includes(a.account_type));
      const out = [];
      for (const a of list) {
        const lines = await bookLines(organization_id, admin_id, a.account_id);
        const book = lines.reduce((t, l) => t + l.signed, 0);
        const [counts] = await Tx().aggregate([
          { $match: { organization_id: String(organization_id), admin_id: new mongoose.Types.ObjectId(String(admin_id)), account_id: a.account_id } },
          { $group: { _id: null, total: { $sum: 1 }, unmatched: { $sum: { $cond: [{ $eq: ["$status", "unmatched"] }, 1, 0] } }, amount: { $sum: "$amount" } } },
        ]);
        out.push({ account_id: a.account_id, account_name: a.account_name, account_type: a.account_type, book_balance: fromPaise(book), statement_lines: counts?.total || 0, unmatched: counts?.unmatched || 0 });
      }
      out.sort((a, b) => a.account_name.localeCompare(b.account_name));
      res.status(ST_CODES.OK).json({ status: true, data: { accounts: out } });
    } catch (error) {
      return fail(res, "load the accounts", error);
    }
  }

  // POST /banking/transactions/import  { org_id, account_id, rows: [{date, description, reference, amount | debit, credit}] }
  async importTransactions(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id, account_id, rows } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      if (!Array.isArray(rows) || rows.length === 0) return bad(res, "There are no rows to import");
      if (rows.length > MAX_ROWS) return bad(res, `Import at most ${MAX_ROWS} rows at a time`);
      const account = await bankAccount(org_id, admin_id, account_id);
      if (!account) return bad(res, "Choose a bank or cash account from your chart of accounts");

      const batch_id = crypto.randomBytes(6).toString("hex");
      const errors = [];
      const seen = new Map();
      const docs = [];
      rows.forEach((row, index) => {
        const line = index + 1;
        const date = parseDate(row?.date);
        if (!date) return errors.push({ row: line, message: "The date isn't valid (use YYYY-MM-DD or DD-MM-YYYY)" });
        let amount;
        if (row.amount !== undefined && row.amount !== "" && row.amount !== null) amount = parseMoney(row.amount);
        else {
          const debit = parseMoney(row.debit) || 0; // money out
          const credit = parseMoney(row.credit) || 0; // money in
          amount = credit - Math.abs(debit);
        }
        if (amount === null || !Number.isFinite(amount)) return errors.push({ row: line, message: "The amount isn't a number" });
        const paise = toPaise(amount);
        if (paise === 0) return errors.push({ row: line, message: "The amount is zero" });
        const description = String(row.description || "").trim().slice(0, 300);
        const reference = String(row.reference || "").trim().slice(0, 100);
        // The same line twice in one file is two real transactions: number them.
        const base = `${date.format("YYYY-MM-DD")}|${paise}|${norm(reference || description)}`;
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        docs.push({
          organization_id: String(org_id), admin_id, account_id: account.account_id, date: date.toDate(), description, reference, amount: fromPaise(paise),
          fingerprint: crypto.createHash("sha1").update(`${base}#${n}`).digest("hex"), batch_id, created_by_id: String(res.locals.actor_id || admin_id),
        });
      });

      let imported = 0;
      if (docs.length) {
        const result = await Tx().bulkWrite(
          docs.map((d) => ({ updateOne: { filter: { organization_id: d.organization_id, account_id: d.account_id, fingerprint: d.fingerprint }, update: { $setOnInsert: d }, upsert: true } })),
          { ordered: false }
        );
        imported = result.upsertedCount || 0;
      }
      res.status(ST_CODES.OK).json({ status: true, data: { batch_id, imported, duplicates: docs.length - imported, errors }, message: `${imported} imported` });
    } catch (error) {
      return fail(res, "import the statement", error);
    }
  }

  // GET /banking/transactions?org_id=&account_id=&status=&from=&to=
  async listTransactions(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const query = { organization_id: String(organization_id), admin_id };
      if (req.query.account_id) query.account_id = String(req.query.account_id);
      if (["unmatched", "matched", "ignored"].includes(req.query.status)) query.status = req.query.status;
      const from = req.query.from ? parseDate(req.query.from) : null;
      const to = req.query.to ? parseDate(req.query.to) : null;
      if ((req.query.from && !from) || (req.query.to && !to)) return bad(res, "Dates must be valid (YYYY-MM-DD)");
      if (from || to) query.date = { ...(from ? { $gte: from.startOf("day").toDate() } : {}), ...(to ? { $lte: to.endOf("day").toDate() } : {}) };
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
      const [rows, total] = await Promise.all([
        Tx().find(query).sort({ date: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Tx().countDocuments(query),
      ]);
      res.status(ST_CODES.OK).json({ status: true, data: { transactions: rows.map(txOut), total, page, limit } });
    } catch (error) {
      return fail(res, "load the transactions", error);
    }
  }

  // GET /banking/transactions/:id/suggestions  journals that could be this line.
  async suggestions(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const tx = await Tx().findOne({ _id: req.params.id, organization_id: String(organization_id), admin_id }).lean();
      if (!tx) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Transaction not found" });
      const candidates = await candidateJournals(organization_id, admin_id, tx);
      res.status(ST_CODES.OK).json({ status: true, data: { suggestions: candidates } });
    } catch (error) {
      return fail(res, "find matches", error);
    }
  }

  // PATCH /banking/transactions/:id  { org_id, action: "match" | "unmatch" | "ignore" | "unignore", journal_id? }
  async updateTransaction(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id, action, journal_id } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      const tx = await Tx().findOne({ _id: req.params.id, organization_id: String(org_id), admin_id });
      if (!tx) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Transaction not found" });

      if (action === "match") {
        if (tx.status === "matched") return bad(res, "This line is already matched");
        const candidates = await candidateJournals(org_id, admin_id, tx.toObject(), { wide: true });
        const chosen = candidates.find((c) => c.journal_id === String(journal_id || ""));
        if (!chosen) return bad(res, "That entry doesn't match this line (same account, same amount and direction, not used already)");
        tx.status = "matched";
        tx.matched_journal_id = chosen.journal_id;
        tx.matched_at = new Date();
      } else if (action === "unmatch") {
        if (tx.status !== "matched") return bad(res, "This line isn't matched");
        tx.status = "unmatched";
        tx.matched_journal_id = "";
        tx.matched_at = undefined;
      } else if (action === "ignore") {
        if (tx.status === "matched") return bad(res, "Unmatch this line before ignoring it");
        tx.status = "ignored";
      } else if (action === "unignore") {
        if (tx.status !== "ignored") return bad(res, "This line isn't ignored");
        tx.status = "unmatched";
      } else {
        return bad(res, "action must be match, unmatch, ignore or unignore");
      }
      await tx.save();
      res.status(ST_CODES.OK).json({ status: true, data: txOut(tx.toObject()) });
    } catch (error) {
      return fail(res, "update the transaction", error);
    }
  }

  // DELETE /banking/transactions/:id?org_id=  removes an imported line that isn't matched.
  async deleteTransaction(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const tx = await Tx().findOne({ _id: req.params.id, organization_id: String(organization_id), admin_id });
      if (!tx) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Transaction not found" });
      if (tx.status === "matched") return bad(res, "Unmatch this line before deleting it");
      await tx.deleteOne();
      res.status(ST_CODES.OK).json({ status: true, message: "Deleted" });
    } catch (error) {
      return fail(res, "delete the transaction", error);
    }
  }

  // GET /banking/reconciliation?org_id=&account_id=&as_of=&statement_opening=
  async reconciliation(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const account = await bankAccount(organization_id, admin_id, req.query.account_id);
      if (!account) return bad(res, "Choose a bank or cash account");
      const asOf = req.query.as_of ? parseDate(req.query.as_of) : dayjs();
      if (!asOf) return bad(res, "as_of must be a valid date");
      const openingParam = req.query.statement_opening === undefined || req.query.statement_opening === "" ? 0 : parseMoney(req.query.statement_opening);
      if (openingParam === null) return bad(res, "statement_opening must be a number");

      const [lines, txs] = await Promise.all([
        bookLines(organization_id, admin_id, account.account_id, asOf),
        Tx().find({ organization_id: String(organization_id), admin_id, account_id: account.account_id, date: { $lte: asOf.endOf("day").toDate() } }).lean(),
      ]);
      const matchedIds = new Set(txs.filter((t) => t.status === "matched").map((t) => t.matched_journal_id));
      const book = lines.reduce((t, l) => t + l.signed, 0);
      const live = txs.filter((t) => t.status !== "ignored");
      const statement = toPaise(openingParam) + live.reduce((t, x) => t + toPaise(x.amount), 0);
      const unmatchedTx = live.filter((t) => t.status === "unmatched");
      // Entries in the books the statement doesn't show (yet): cheques not cleared, for instance.
      const uncleared = lines.filter((l) => !matchedIds.has(l.journal.journal_id) && l.signed !== 0);
      const unclearedNet = uncleared.reduce((t, l) => t + l.signed, 0);
      const unmatchedNet = unmatchedTx.reduce((t, x) => t + toPaise(x.amount), 0);
      // statement = book - uncleared book items + statement lines the books lack
      const difference = statement - (book - unclearedNet + unmatchedNet);
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          account: { account_id: account.account_id, account_name: account.account_name },
          as_of: asOf.format("YYYY-MM-DD"),
          book_balance: fromPaise(book),
          statement_balance: fromPaise(statement),
          statement_opening: fromPaise(toPaise(openingParam)),
          matched: { count: txs.filter((t) => t.status === "matched").length },
          unmatched_statement: { count: unmatchedTx.length, total: fromPaise(unmatchedNet), items: unmatchedTx.slice(0, 200).map(txOut) },
          uncleared_book: {
            count: uncleared.length,
            total: fromPaise(unclearedNet),
            items: uncleared.slice(0, 200).map((l) => ({ journal_id: l.journal.journal_id, date: dayjs(l.journal.journal_date).format("YYYY-MM-DD"), type: l.journal.type, name: l.journal.customer_name || l.journal.vendor_name || "", amount: fromPaise(l.signed) })),
          },
          ignored: txs.filter((t) => t.status === "ignored").length,
          difference: fromPaise(difference),
          is_reconciled: difference === 0 && unmatchedTx.length === 0,
        },
      });
    } catch (error) {
      return fail(res, "reconcile", error);
    }
  }
}

// Journals with a line on the line's account of the same amount and direction
// (money in = a debit to the account), not already matched to another line.
async function candidateJournals(organization_id, admin_id, tx, { wide = false } = {}) {
  const paise = toPaise(tx.amount);
  const wantSigned = paise; // a deposit is a debit (+), a withdrawal a credit (-)
  const day = dayjs(tx.date);
  const windowDays = wide ? 60 : 10;
  const lines = await bookLines(organization_id, admin_id, tx.account_id);
  const taken = new Set(
    (await Tx().find({ organization_id: String(organization_id), admin_id, account_id: tx.account_id, status: "matched", _id: { $ne: tx._id } }).select("matched_journal_id").lean()).map((t) => t.matched_journal_id)
  );
  return lines
    .filter((l) => l.signed === wantSigned && !taken.has(l.journal.journal_id) && Math.abs(dayjs(l.journal.journal_date).diff(day, "day")) <= windowDays)
    .map((l) => ({
      journal_id: l.journal.journal_id,
      date: dayjs(l.journal.journal_date).format("YYYY-MM-DD"),
      type: l.journal.type,
      name: l.journal.customer_name || l.journal.vendor_name || "",
      reference: l.journal.reference_number || "",
      notes: l.journal.notes || "",
      amount: fromPaise(l.signed),
      days_apart: Math.abs(dayjs(l.journal.journal_date).diff(day, "day")),
    }))
    .sort((a, b) => a.days_apart - b.days_apart)
    .slice(0, 10);
}

module.exports = new BankingController();
