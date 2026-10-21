const mongoose = require("mongoose");

// Chart-of-accounts `account_type` values grouped the way a balance sheet
// presents them. Anything not listed here is reported as unclassified rather
// than silently dropped.
const BALANCE_SHEET_GROUPS = {
  assets: [
    {
      key: "current_assets",
      title: "Current Assets",
      types: ["cash", "bank", "accounts_receivable", "other_current_asset", "stock"],
    },
    { key: "fixed_assets", title: "Fixed Assets", types: ["fixed_asset"] },
    { key: "other_assets", title: "Other Assets", types: ["other_asset"] },
  ],
  liabilities: [
    {
      key: "current_liabilities",
      title: "Current Liabilities",
      types: ["accounts_payable", "other_current_liability", "credit_card"],
    },
    {
      key: "long_term_liabilities",
      title: "Long Term Liabilities",
      types: ["long_term_liability"],
    },
    { key: "other_liabilities", title: "Other Liabilities", types: ["other_liability"] },
  ],
  equity: [{ key: "equity", title: "Equity", types: ["equity"] }],
};

const INCOME_TYPES = ["income", "other_income"];
const EXPENSE_TYPES = ["expense", "cost_of_goods_sold", "other_expense"];

const ASSET_TYPES = BALANCE_SHEET_GROUPS.assets.flatMap((g) => g.types);
const LIABILITY_TYPES = BALANCE_SHEET_GROUPS.liabilities.flatMap((g) => g.types);
const EQUITY_TYPES = BALANCE_SHEET_GROUPS.equity.flatMap((g) => g.types);

// Debit-normal accounts grow with debits; credit-normal ones with credits.
const isDebitNormal = (accountType) =>
  ASSET_TYPES.includes(accountType) || EXPENSE_TYPES.includes(accountType);

// All money maths is done in integer paise so totals can be compared exactly.
const toPaise = (amount) => Math.round(Number(amount) * 100);
const fromPaise = (paise) => paise / 100;

const formatCurrency = (amount) =>
  `₹${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Returns a Map of account_id -> account for an organisation's chart of accounts.
const getAccountsMap = async (organization_id, admin_id) => {
  const COA_collection = mongoose.model("Chart_of_account");
  const coa = await COA_collection.findOne({
    organization_id: String(organization_id),
    admin_id,
  }).lean();
  const map = new Map();
  (coa?.chart_of_accounts || []).forEach((acc) => map.set(acc.account_id, acc));
  return map;
};

// Lenient name key: case/space-insensitive and ignores a trailing "s", so
// "Shipping Charges" finds "Shipping Charge".
const nameKey = (name) =>
  String(name || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/s$/, "");

// Makes journal lines point at real chart-of-accounts IDs. Some screens send
// an account *name* where the ID belongs (e.g. the recurring expense form),
// which leaves the line unclassifiable in reports. Lines whose ID is already
// valid are left alone; lines that can't be matched are also left alone (the
// balance sheet reports them as unclassified). Mutates `lines` in place.
const resolveJournalLines = async (organization_id, admin_id, lines) => {
  if (!organization_id || !admin_id || !Array.isArray(lines) || !lines.length) return;
  const accounts = await getAccountsMap(organization_id, admin_id);
  if (!accounts.size) return;
  const byName = new Map();
  for (const acc of accounts.values()) byName.set(nameKey(acc.account_name), acc);

  for (const line of lines) {
    if (!line || accounts.has(line.coa_account_id)) continue;
    const match =
      byName.get(nameKey(line.coa_account_id)) ||
      byName.get(nameKey(line.coa_account_name));
    if (match) {
      line.coa_account_id = match.account_id;
      line.coa_account_name = match.account_name;
    }
  }
};

// Journals that count in the books. Draft and void documents keep their
// journal (so it can be re-posted) but are left out of every report.
const POSTED_JOURNALS = { posting_status: { $nin: ["draft", "void"] } };

// Posting state of a document's journal from the document's own status:
// invoices use "draft"/"void"/..., bills use "DRAFT"/"VOID"/...
const postingStatusFor = (documentStatus) => {
  const s = String(documentStatus || "").toLowerCase();
  if (s === "draft") return "draft";
  if (s === "void") return "void";
  return "posted";
};

// Keeps a document's journal in step with the document's status.
const syncJournalPosting = async (journal_id, organization_id, documentStatus) => {
  if (!journal_id) return;
  const JournalCollection = mongoose.model("Journal");
  await JournalCollection.updateOne(
    { journal_id, organization_id: String(organization_id) },
    { $set: { posting_status: postingStatusFor(documentStatus) } }
  );
};

module.exports = {
  POSTED_JOURNALS,
  postingStatusFor,
  syncJournalPosting,
  resolveJournalLines,
  BALANCE_SHEET_GROUPS,
  INCOME_TYPES,
  EXPENSE_TYPES,
  ASSET_TYPES,
  LIABILITY_TYPES,
  EQUITY_TYPES,
  isDebitNormal,
  toPaise,
  fromPaise,
  formatCurrency,
  getAccountsMap,
};
