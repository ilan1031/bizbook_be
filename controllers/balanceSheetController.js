const mongoose = require("mongoose");
const dayjs = require("dayjs");
const JournalCollection = mongoose.model("Journal");
const OrgCollection = mongoose.model("Organization");
const ST_CODES = require("../helpers/statusCodeHelpers");
const {
  BALANCE_SHEET_GROUPS,
  INCOME_TYPES,
  EXPENSE_TYPES,
  ASSET_TYPES,
  LIABILITY_TYPES,
  EQUITY_TYPES,
  isDebitNormal,
  toPaise,
  fromPaise,
  getAccountsMap,
  POSTED_JOURNALS,
} = require("../helpers/accountingHelper");

// Account types this report knows where to place.
const KNOWN_TYPES = [
  ...ASSET_TYPES,
  ...LIABILITY_TYPES,
  ...EQUITY_TYPES,
  ...INCOME_TYPES,
  ...EXPENSE_TYPES,
];

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

// Start of the fiscal year that contains `asOf` (defaults to an April start).
const getFiscalYearStart = (asOf, startMonthName) => {
  const index = MONTHS.indexOf(String(startMonthName || "").toUpperCase());
  const month = index >= 0 ? index : 3;
  let start = asOf.month(month).startOf("month");
  if (start.isAfter(asOf)) start = start.subtract(1, "year");
  return start;
};

class BalanceSheetController {
  // Balance sheet as of a date, built from every journal posted up to it.
  // Assets = Liabilities + Equity holds whenever every journal is itself
  // balanced; any difference is returned rather than hidden.
  async getBalanceSheet(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, message: "Organization ID is required" });
      }
      if (req.query.as_of && !dayjs(req.query.as_of).isValid()) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, message: "as_of must be a valid date" });
      }

      const asOf = dayjs(req.query.as_of || undefined).endOf("day");
      const org = await OrgCollection.findOne({
        organization_id: organization_id,
        admin_id,
      }).lean();
      const fiscalYearStart = getFiscalYearStart(asOf, org?.fiscal_year_start_month);

      const [accounts, journals] = await Promise.all([
        getAccountsMap(organization_id, admin_id),
        JournalCollection.find(
          {
            organization_id: String(organization_id),
            admin_id,
            journal_date: { $lte: asOf.toDate() },
            ...POSTED_JOURNALS,
          },
          { journal_id: 1, journal_date: 1, type: 1, line_items: 1 }
        ).lean(),
      ]);

      // Signed balances in paise: debits positive, credits negative.
      const balances = new Map();
      const unclassified = new Map();
      let currentEarnings = 0;
      let priorEarnings = 0;
      const unbalancedJournals = [];

      for (const journal of journals) {
        const inCurrentYear = !dayjs(journal.journal_date).isBefore(fiscalYearStart);
        let journalNet = 0;

        for (const line of journal.line_items || []) {
          const paise = toPaise(line.amount || 0);
          const signed = line.creditOrDebit === "Debit" ? paise : -paise;
          journalNet += signed;

          const account = accounts.get(line.coa_account_id);
          if (!account || !KNOWN_TYPES.includes(account.account_type)) {
            const key = line.coa_account_id || "(none)";
            const entry = unclassified.get(key) || {
              account_id: key,
              account_name: line.coa_account_name || "Unknown account",
              debit_balance: 0,
            };
            entry.debit_balance += signed;
            unclassified.set(key, entry);
            continue;
          }

          if (
            INCOME_TYPES.includes(account.account_type) ||
            EXPENSE_TYPES.includes(account.account_type)
          ) {
            // Earnings = credits - debits on income and expense accounts.
            if (inCurrentYear) currentEarnings -= signed;
            else priorEarnings -= signed;
          } else {
            balances.set(account.account_id, (balances.get(account.account_id) || 0) + signed);
          }
        }

        if (journalNet !== 0) {
          unbalancedJournals.push({
            journal_id: journal.journal_id,
            type: journal.type,
            difference: fromPaise(journalNet),
          });
        }
      }

      const buildSection = (groupDefs) =>
        groupDefs.map((group) => {
          const groupAccounts = [];
          for (const [accountId, signed] of balances) {
            const account = accounts.get(accountId);
            if (!group.types.includes(account.account_type) || signed === 0) continue;
            const amount = isDebitNormal(account.account_type) ? signed : -signed;
            groupAccounts.push({
              account_id: accountId,
              account_name: account.account_name,
              account_code: account.account_code || "",
              account_type: account.account_type,
              account_type_formatted: account.account_type_formatted,
              amount,
            });
          }
          groupAccounts.sort((a, b) => a.account_name.localeCompare(b.account_name));
          return {
            key: group.key,
            title: group.title,
            accounts: groupAccounts,
            total: groupAccounts.reduce((sum, a) => sum + a.amount, 0),
          };
        });

      const assets = buildSection(BALANCE_SHEET_GROUPS.assets);
      const liabilities = buildSection(BALANCE_SHEET_GROUPS.liabilities);
      const equity = buildSection(BALANCE_SHEET_GROUPS.equity);

      // Earnings from income/expense accounts belong to equity.
      const equityGroup = equity[0];
      if (priorEarnings !== 0) {
        equityGroup.accounts.push({
          account_id: "computed_retained_earnings",
          account_name: "Retained Earnings (prior years)",
          computed: true,
          amount: priorEarnings,
        });
      }
      equityGroup.accounts.push({
        account_id: "computed_current_year_earnings",
        account_name: "Current Year Earnings",
        computed: true,
        amount: currentEarnings,
      });
      equityGroup.total += priorEarnings + currentEarnings;

      const sum = (groups) => groups.reduce((s, g) => s + g.total, 0);
      const totalAssets = sum(assets);
      const totalLiabilities = sum(liabilities);
      const totalEquity = sum(equity);
      const difference = totalAssets - (totalLiabilities + totalEquity);

      // Convert every paise amount to rupees for the response.
      const toRupees = (groups) =>
        groups.map((g) => ({
          ...g,
          total: fromPaise(g.total),
          accounts: g.accounts.map((a) => ({ ...a, amount: fromPaise(a.amount) })),
        }));

      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          as_of: asOf.format("YYYY-MM-DD"),
          fiscal_year_start: fiscalYearStart.format("YYYY-MM-DD"),
          sections: {
            assets: toRupees(assets),
            liabilities: toRupees(liabilities),
            equity: toRupees(equity),
          },
          totals: {
            assets: fromPaise(totalAssets),
            liabilities: fromPaise(totalLiabilities),
            equity: fromPaise(totalEquity),
            liabilities_and_equity: fromPaise(totalLiabilities + totalEquity),
            difference: fromPaise(difference),
          },
          checks: {
            is_balanced: difference === 0,
            journal_count: journals.length,
            has_chart_of_accounts: accounts.size > 0,
            unbalanced_journals: unbalancedJournals,
            unclassified_accounts: [...unclassified.values()].map((u) => ({
              ...u,
              debit_balance: fromPaise(u.debit_balance),
            })),
          },
        },
      });
    } catch (error) {
      console.log("getBalanceSheet error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ status: false, message: "Failed to generate balance sheet" });
    }
  }
}

module.exports = new BalanceSheetController();
