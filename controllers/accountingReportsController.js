// Accounting reports built from the books: Trial Balance, General Ledger and
// the aged receivables / payables. Like the Balance Sheet they read only posted
// journals (draft and void documents are left out) and do their sums in whole
// paise so totals compare exactly.
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { POSTED_JOURNALS, isDebitNormal, toPaise, fromPaise, getAccountsMap } = require("../helpers/accountingHelper");

const Journal = () => mongoose.model("Journal");
const Invoice = () => mongoose.model("Invoice");
const Bill = () => mongoose.model("PO_bill");
const Contact = () => mongoose.model("Contact");

// "YYYY-MM-DD" or "DD-MM-YYYY"; null when it isn't a real date.
const parseDate = (value) => {
  const s = String(value ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let y, mo, d;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = dayjs(new Date(y, mo - 1, d));
  return date.year() === y && date.month() === mo - 1 && date.date() === d ? date : null;
};

const bad = (res, message) => res.status(ST_CODES.BAD_REQUEST).json({ status: false, message });
const fail = (res, label, error) => {
  console.log(`${label} error`, error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: `Failed to generate ${label}` });
};

// Splits a signed paise balance (debit +, credit -) into its two columns.
const columns = (signed) => ({ debit: signed > 0 ? fromPaise(signed) : 0, credit: signed < 0 ? fromPaise(-signed) : 0 });

class AccountingReportsController {
  // GET /reports/trial-balance?org_id=&as_of=  (optional from= for the period's movement)
  async getTrialBalance(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const asOf = parseDate(req.query.as_of) || (req.query.as_of ? null : dayjs());
      if (!asOf) return bad(res, "as_of must be a valid date");
      const from = req.query.from ? parseDate(req.query.from) : null;
      if (req.query.from && !from) return bad(res, "from must be a valid date");
      if (from && from.isAfter(asOf)) return bad(res, "The start date must be on or before the end date");

      const [accounts, journals] = await Promise.all([
        getAccountsMap(organization_id, admin_id),
        Journal()
          .find(
            { organization_id: String(organization_id), admin_id, journal_date: { $lte: asOf.endOf("day").toDate() }, ...POSTED_JOURNALS },
            { journal_date: 1, line_items: 1 }
          )
          .lean(),
      ]);

      const fromDate = from ? from.startOf("day").toDate() : null;
      // account id -> { opening, debit, credit } in paise
      const rows = new Map();
      let netAll = 0;
      for (const journal of journals) {
        const inPeriod = !fromDate || journal.journal_date >= fromDate;
        for (const line of journal.line_items || []) {
          const paise = toPaise(line.amount || 0);
          const isDebit = line.creditOrDebit === "Debit";
          const key = line.coa_account_id || "(none)";
          const row = rows.get(key) || { name: line.coa_account_name || "Unknown account", opening: 0, debit: 0, credit: 0 };
          if (inPeriod) {
            if (isDebit) row.debit += paise;
            else row.credit += paise;
          } else {
            row.opening += isDebit ? paise : -paise;
          }
          netAll += isDebit ? paise : -paise;
          rows.set(key, row);
        }
      }

      const list = [];
      let totalDebit = 0;
      let totalCredit = 0;
      for (const [id, row] of rows) {
        const account = accounts.get(id);
        const closing = row.opening + row.debit - row.credit;
        if (row.opening === 0 && row.debit === 0 && row.credit === 0) continue;
        const cols = columns(closing);
        totalDebit += closing > 0 ? closing : 0;
        totalCredit += closing < 0 ? -closing : 0;
        list.push({
          account_id: id,
          account_name: account?.account_name || row.name,
          account_code: account?.account_code || "",
          account_type: account?.account_type || "unclassified",
          account_type_formatted: account?.account_type_formatted || "Unclassified",
          opening: fromPaise(row.opening),
          period_debit: fromPaise(row.debit),
          period_credit: fromPaise(row.credit),
          debit: cols.debit,
          credit: cols.credit,
          normal_side: account && isDebitNormal(account.account_type) ? "debit" : "credit",
        });
      }
      list.sort((a, b) => a.account_type.localeCompare(b.account_type) || a.account_name.localeCompare(b.account_name));

      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          as_of: asOf.format("YYYY-MM-DD"),
          from: from ? from.format("YYYY-MM-DD") : null,
          accounts: list,
          totals: { debit: fromPaise(totalDebit), credit: fromPaise(totalCredit), difference: fromPaise(totalDebit - totalCredit) },
          checks: { is_balanced: totalDebit === totalCredit && netAll === 0, journal_count: journals.length },
        },
      });
    } catch (error) {
      return fail(res, "trial balance", error);
    }
  }

  // GET /reports/general-ledger?org_id=&account_id=&from=&to=
  // Without account_id it lists the accounts to choose from.
  async getGeneralLedger(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const accounts = await getAccountsMap(organization_id, admin_id);
      const accountId = req.query.account_id ? String(req.query.account_id) : "";
      if (!accountId) {
        return res.status(ST_CODES.OK).json({
          status: true,
          data: {
            accounts: [...accounts.values()]
              .map((a) => ({ account_id: a.account_id, account_name: a.account_name, account_code: a.account_code || "", account_type: a.account_type }))
              .sort((a, b) => a.account_name.localeCompare(b.account_name)),
          },
        });
      }
      const account = accounts.get(accountId);
      if (!account) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Account not found" });

      const today = dayjs();
      const to = parseDate(req.query.to) || (req.query.to ? null : today.endOf("month"));
      const from = parseDate(req.query.from) || (req.query.from ? null : today.startOf("month"));
      if (!from || !to) return bad(res, "Dates must be valid (YYYY-MM-DD or DD-MM-YYYY)");
      if (from.isAfter(to)) return bad(res, "The start date must be on or before the end date");
      const fromDate = from.startOf("day").toDate();

      const journals = await Journal()
        .find(
          {
            organization_id: String(organization_id),
            admin_id,
            journal_date: { $lte: to.endOf("day").toDate() },
            "line_items.coa_account_id": accountId,
            ...POSTED_JOURNALS,
          },
          { journal_id: 1, journal_date: 1, type: 1, customer_name: 1, vendor_name: 1, reference_number: 1, notes: 1, line_items: 1 }
        )
        .sort({ journal_date: 1, createdAt: 1 })
        .lean();

      const debitNormal = isDebitNormal(account.account_type);
      // Running balance in the account's own direction (an asset grows with debits).
      let opening = 0;
      let running = 0;
      let totalDebit = 0;
      let totalCredit = 0;
      const entries = [];
      for (const journal of journals) {
        for (const line of journal.line_items || []) {
          if (line.coa_account_id !== accountId) continue;
          const paise = toPaise(line.amount || 0);
          const isDebit = line.creditOrDebit === "Debit";
          const signed = isDebit ? paise : -paise;
          const directional = debitNormal ? signed : -signed;
          if (journal.journal_date < fromDate) {
            opening += directional;
            running += directional;
            continue;
          }
          running += directional;
          if (isDebit) totalDebit += paise;
          else totalCredit += paise;
          entries.push({
            date: dayjs(journal.journal_date).format("YYYY-MM-DD"),
            journal_id: journal.journal_id,
            type: journal.type,
            name: journal.customer_name || journal.vendor_name || "",
            reference: journal.reference_number || "",
            notes: journal.notes || "",
            debit: isDebit ? fromPaise(paise) : 0,
            credit: isDebit ? 0 : fromPaise(paise),
            balance: fromPaise(running),
          });
        }
      }

      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          account: { account_id: account.account_id, account_name: account.account_name, account_code: account.account_code || "", account_type: account.account_type, normal_side: debitNormal ? "debit" : "credit" },
          from: from.format("YYYY-MM-DD"),
          to: to.format("YYYY-MM-DD"),
          opening_balance: fromPaise(opening),
          entries,
          totals: { debit: fromPaise(totalDebit), credit: fromPaise(totalCredit) },
          closing_balance: fromPaise(running),
        },
      });
    } catch (error) {
      return fail(res, "general ledger", error);
    }
  }

  // GET /reports/day-book?org_id=&from=&to=  every posted entry, day by day.
  async getDayBook(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const range = periodFrom(req);
      if (range.error) return bad(res, range.error);
      const LIMIT = 1000;
      const journals = await Journal()
        .find(
          { organization_id: String(organization_id), admin_id, journal_date: { $gte: range.from.startOf("day").toDate(), $lte: range.to.endOf("day").toDate() }, ...POSTED_JOURNALS },
          { journal_id: 1, journal_date: 1, type: 1, customer_name: 1, vendor_name: 1, reference_number: 1, notes: 1, line_items: 1 }
        )
        .sort({ journal_date: 1, createdAt: 1 })
        .limit(LIMIT + 1)
        .lean();
      const truncated = journals.length > LIMIT;
      if (truncated) journals.pop();

      const days = new Map();
      let totalDebit = 0;
      for (const journal of journals) {
        const key = dayjs(journal.journal_date).format("YYYY-MM-DD");
        const day = days.get(key) || { date: key, entries: [], debit: 0 };
        let debit = 0;
        const lines = (journal.line_items || []).map((l) => {
          const paise = toPaise(l.amount || 0);
          const isDebit = l.creditOrDebit === "Debit";
          if (isDebit) debit += paise;
          return { account_id: l.coa_account_id, account_name: l.coa_account_name || "", debit: isDebit ? fromPaise(paise) : 0, credit: isDebit ? 0 : fromPaise(paise) };
        });
        day.entries.push({ journal_id: journal.journal_id, type: journal.type, name: journal.customer_name || journal.vendor_name || "", reference: journal.reference_number || "", notes: journal.notes || "", amount: fromPaise(debit), lines });
        day.debit += debit;
        totalDebit += debit;
        days.set(key, day);
      }
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          from: range.from.format("YYYY-MM-DD"),
          to: range.to.format("YYYY-MM-DD"),
          days: [...days.values()].map((d) => ({ ...d, debit: fromPaise(d.debit) })),
          totals: { entries: journals.length, amount: fromPaise(totalDebit) },
          truncated,
          limit: LIMIT,
        },
      });
    } catch (error) {
      return fail(res, "day book", error);
    }
  }

  // GET /reports/cash-flow?org_id=&from=&to=
  // Cash and bank movement for the period, explained by what the money was
  // for: each journal's cash effect is traced to its other (non-cash) accounts.
  async getCashFlow(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const range = periodFrom(req, "year");
      if (range.error) return bad(res, range.error);
      const fromDate = range.from.startOf("day").toDate();

      const [accounts, journals] = await Promise.all([
        getAccountsMap(organization_id, admin_id),
        Journal()
          .find(
            { organization_id: String(organization_id), admin_id, journal_date: { $lte: range.to.endOf("day").toDate() }, ...POSTED_JOURNALS },
            { journal_date: 1, line_items: 1 }
          )
          .lean(),
      ]);

      const isCash = (id) => CASH_TYPES.includes(accounts.get(id)?.account_type);
      const sections = Object.fromEntries(CASH_FLOW_SECTIONS.map((sec) => [sec.key, new Map()]));
      const cashAccounts = new Map();
      let opening = 0;
      let net = 0;
      for (const journal of journals) {
        const before = journal.journal_date < fromDate;
        const lines = journal.line_items || [];
        for (const line of lines) {
          if (!isCash(line.coa_account_id)) continue;
          const signed = line.creditOrDebit === "Debit" ? toPaise(line.amount || 0) : -toPaise(line.amount || 0);
          const entry = cashAccounts.get(line.coa_account_id) || { opening: 0, change: 0 };
          if (before) {
            opening += signed;
            entry.opening += signed;
          } else {
            net += signed;
            entry.change += signed;
          }
          cashAccounts.set(line.coa_account_id, entry);
        }
        if (before) continue;
        // The journal's cash effect, spread over its non-cash lines.
        for (const line of lines) {
          if (isCash(line.coa_account_id)) continue;
          const account = accounts.get(line.coa_account_id);
          const signed = line.creditOrDebit === "Debit" ? toPaise(line.amount || 0) : -toPaise(line.amount || 0);
          const section = CASH_FLOW_SECTIONS.find((sec) => sec.types.includes(account?.account_type)) || CASH_FLOW_SECTIONS[0];
          const key = line.coa_account_id || "(none)";
          const item = sections[section.key].get(key) || { account_id: key, account_name: account?.account_name || line.coa_account_name || "Unknown account", amount: 0 };
          item.amount += -signed; // a credit elsewhere means cash came in
          sections[section.key].set(key, item);
        }
      }

      const outSections = CASH_FLOW_SECTIONS.map((sec) => {
        const items = [...sections[sec.key].values()].filter((i) => i.amount !== 0).sort((a, b) => a.account_name.localeCompare(b.account_name));
        return { key: sec.key, title: sec.title, items: items.map((i) => ({ ...i, amount: fromPaise(i.amount) })), total: fromPaise(items.reduce((t, i) => t + i.amount, 0)) };
      });
      const explained = outSections.reduce((t, sec) => t + toPaise(sec.total), 0);
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          from: range.from.format("YYYY-MM-DD"),
          to: range.to.format("YYYY-MM-DD"),
          opening_balance: fromPaise(opening),
          sections: outSections,
          net_change: fromPaise(net),
          closing_balance: fromPaise(opening + net),
          cash_accounts: [...cashAccounts.entries()].map(([id, c]) => ({ account_id: id, account_name: accounts.get(id)?.account_name || id, opening: fromPaise(c.opening), change: fromPaise(c.change), closing: fromPaise(c.opening + c.change) })),
          checks: { is_explained: explained === net, unexplained: fromPaise(net - explained) },
        },
      });
    } catch (error) {
      return fail(res, "cash flow", error);
    }
  }

  // GET /reports/gst-summary?org_id=&from=&to=  output tax on sales against input tax on purchases.
  async getGstSummary(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      if (!/^\d+$/.test(String(organization_id))) return bad(res, "Organization ID must be a number");
      const range = periodFrom(req);
      if (range.error) return bad(res, range.error);
      const orgNo = Number(organization_id);
      const inRange = (d) => d && d.isValid() && !d.isBefore(range.from.startOf("day")) && !d.isAfter(range.to.endOf("day"));

      const [invoices, bills] = await Promise.all([
        Invoice()
          .find({ organization_id: orgNo, admin_id, status: { $nin: ["draft", "Draft", "void", "Void"] } })
          .select("invoice_number date customer_name line_items gst_total cgst_total sgst_total igst_total")
          .lean(),
        Bill()
          .find({ organization_id: orgNo, admin_id, status_type: { $nin: ["DRAFT", "VOID"] }, billDate: { $gte: range.from.startOf("day").toDate(), $lte: range.to.endOf("day").toDate() } })
          .select("bill_number billDate items gst_total cgst_total sgst_total igst_total")
          .lean(),
      ]);

      const side = () => ({ documents: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, rates: new Map() });
      const sales = side();
      const purchases = side();
      const add = (target, lines, doc, taxableOf) => {
        target.documents += 1;
        target.cgst += toPaise(doc.cgst_total);
        target.sgst += toPaise(doc.sgst_total);
        target.igst += toPaise(doc.igst_total);
        target.tax += toPaise(doc.gst_total);
        for (const line of lines || []) {
          const rate = Number(line.gst_rate || 0);
          const taxable = toPaise(taxableOf(line));
          target.taxable += taxable;
          const row = target.rates.get(rate) || { rate, taxable: 0, tax: 0 };
          row.taxable += taxable;
          row.tax += toPaise(line.gst_amount);
          target.rates.set(rate, row);
        }
      };
      for (const inv of invoices) {
        const d = parseDate(inv.date) || (inv.date ? dayjs(inv.date) : null);
        if (inRange(d)) add(sales, inv.line_items, inv, (l) => l.taxable_amount ?? l.item_total);
      }
      for (const bill of bills) add(purchases, bill.items, bill, (l) => l.item_total);

      const finish = (t) => ({
        documents: t.documents,
        taxable: fromPaise(t.taxable),
        cgst: fromPaise(t.cgst),
        sgst: fromPaise(t.sgst),
        igst: fromPaise(t.igst),
        tax: fromPaise(t.tax),
        by_rate: [...t.rates.values()].sort((a, b) => a.rate - b.rate).map((r) => ({ rate: r.rate, taxable: fromPaise(r.taxable), tax: fromPaise(r.tax) })),
      });
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          from: range.from.format("YYYY-MM-DD"),
          to: range.to.format("YYYY-MM-DD"),
          sales: finish(sales),
          purchases: finish(purchases),
          net: { cgst: fromPaise(sales.cgst - purchases.cgst), sgst: fromPaise(sales.sgst - purchases.sgst), igst: fromPaise(sales.igst - purchases.igst), payable: fromPaise(sales.tax - purchases.tax) },
          notes: ["Credit notes and vendor credits are not netted off in this summary yet."],
        },
      });
    } catch (error) {
      return fail(res, "GST summary", error);
    }
  }

  // GET /reports/aged-receivables?org_id=&as_of=
  getAgedReceivables(req, res) {
    return aged(req, res, "receivables");
  }

  // GET /reports/aged-payables?org_id=&as_of=
  getAgedPayables(req, res) {
    return aged(req, res, "payables");
  }
}

// from/to of a period report; the default is this month (or this year when
// asked). { error } when a date isn't real or the range is backwards.
const periodFrom = (req, span = "month") => {
  const today = dayjs();
  const to = parseDate(req.query.to) || (req.query.to ? null : today.endOf(span));
  const from = parseDate(req.query.from) || (req.query.from ? null : today.startOf(span));
  if (!from || !to) return { error: "Dates must be valid (YYYY-MM-DD or DD-MM-YYYY)" };
  if (from.isAfter(to)) return { error: "The start date must be on or before the end date" };
  return { from, to };
};

const CASH_TYPES = ["cash", "bank"];
const CASH_FLOW_SECTIONS = [
  { key: "operating", title: "Operating activities", types: [] },
  { key: "investing", title: "Investing activities", types: ["fixed_asset", "other_asset"] },
  { key: "financing", title: "Financing activities", types: ["equity", "long_term_liability", "other_liability"] },
];

const BUCKETS = [
  { key: "current", label: "Current", test: (d) => d <= 0 },
  { key: "d1_30", label: "1-30 days", test: (d) => d >= 1 && d <= 30 },
  { key: "d31_60", label: "31-60 days", test: (d) => d >= 31 && d <= 60 },
  { key: "d61_90", label: "61-90 days", test: (d) => d >= 61 && d <= 90 },
  { key: "d90_plus", label: "Over 90 days", test: (d) => d > 90 },
];

async function aged(req, res, kind) {
  try {
    const admin_id = res.locals.user_id;
    const organization_id = req.query.org_id;
    if (!organization_id) return bad(res, "Organization ID is required");
    if (!/^\d+$/.test(String(organization_id))) return bad(res, "Organization ID must be a number");
    const asOf = parseDate(req.query.as_of) || (req.query.as_of ? null : dayjs());
    if (!asOf) return bad(res, "as_of must be a valid date");
    const orgNo = Number(organization_id);
    const asOfDay = asOf.startOf("day");

    // [{ party_id, party_name, number, date, due_date, total, balance }]
    let docs;
    if (kind === "receivables") {
      const invoices = await Invoice()
        .find({ organization_id: orgNo, admin_id, status: { $nin: ["draft", "Draft", "void", "Void"] }, balance: { $gt: 0 } })
        .select("invoice_number customer_id customer_name date due_date total balance")
        .lean();
      docs = invoices.map((i) => ({
        party_id: i.customer_id || "",
        party_name: i.customer_name || "Unknown customer",
        number: i.invoice_number,
        date: i.date,
        due_date: i.due_date || i.date,
        total: i.total || 0,
        balance: i.balance || 0,
      }));
    } else {
      const bills = await Bill()
        .find({ organization_id: orgNo, admin_id, status_type: { $nin: ["DRAFT", "VOID", "PAID"] }, balance: { $gt: 0 } })
        .select("bill_number vendor_id billDate due_date total balance")
        .lean();
      const vendorIds = [...new Set(bills.map((b) => String(b.vendor_id)).filter(Boolean))];
      const vendors = vendorIds.length ? await Contact().find({ _id: { $in: vendorIds } }).select("contact_name").lean() : [];
      const names = new Map(vendors.map((v) => [String(v._id), v.contact_name]));
      docs = bills.map((b) => ({
        party_id: String(b.vendor_id || ""),
        party_name: names.get(String(b.vendor_id)) || "Unknown vendor",
        number: b.bill_number,
        date: b.billDate,
        due_date: b.due_date || b.billDate,
        total: b.total || 0,
        balance: b.balance || 0,
      }));
    }

    const byParty = new Map();
    const totals = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));
    let grand = 0;
    for (const doc of docs) {
      const due = parseDate(doc.due_date) || (doc.due_date ? dayjs(doc.due_date) : null);
      if (!due || !due.isValid()) continue;
      // The document must already exist on the as-of date.
      const issued = parseDate(doc.date) || (doc.date ? dayjs(doc.date) : null);
      if (issued && issued.isValid() && issued.isAfter(asOf.endOf("day"))) continue;
      const daysPast = asOfDay.diff(due.startOf("day"), "day");
      const bucket = BUCKETS.find((b) => b.test(daysPast));
      const paise = toPaise(doc.balance);
      const key = doc.party_id || doc.party_name;
      const party = byParty.get(key) || { party_id: doc.party_id, party_name: doc.party_name, total: 0, ...Object.fromEntries(BUCKETS.map((b) => [b.key, 0])), documents: [] };
      party[bucket.key] += paise;
      party.total += paise;
      party.documents.push({ number: doc.number, due_date: due.format("YYYY-MM-DD"), days_past_due: Math.max(daysPast, 0), bucket: bucket.key, total: doc.total, balance: fromPaise(paise) });
      byParty.set(key, party);
      totals[bucket.key] += paise;
      grand += paise;
    }

    const parties = [...byParty.values()]
      .map((p) => ({ ...p, ...Object.fromEntries(BUCKETS.map((b) => [b.key, fromPaise(p[b.key])])), total: fromPaise(p.total) }))
      .sort((a, b) => b.total - a.total);

    res.status(ST_CODES.OK).json({
      status: true,
      data: {
        kind,
        as_of: asOf.format("YYYY-MM-DD"),
        buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label })),
        parties,
        totals: { ...Object.fromEntries(BUCKETS.map((b) => [b.key, fromPaise(totals[b.key])])), total: fromPaise(grand) },
      },
    });
  } catch (error) {
    return fail(res, `aged ${kind}`, error);
  }
}

module.exports = new AccountingReportsController();
