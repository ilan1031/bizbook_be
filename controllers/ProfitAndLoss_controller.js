// controllers/profitLossController.js
const mongoose = require("mongoose");
const JournalCollection = mongoose.model("Journal");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const {
  INCOME_TYPES,
  toPaise,
  fromPaise,
  getAccountsMap,
} = require("../helpers/accountingHelper");

const COGS_TYPES = ["cost_of_goods_sold"];
const OPERATING_EXPENSE_TYPES = ["expense", "other_expense"];

class ProfitLossController {
  // Profit & loss for a date range, built from every journal in the range and
  // classified by each line's account type in the chart of accounts — the
  // same classification the balance sheet uses, so this period's net profit
  // equals the balance sheet's earnings for the same dates.
  //
  // The response keeps its original shape for the P&L page:
  //   invoices = operating income, bills = cost of goods sold,
  //   expenses = operating expenses.
  async getProfitLossReport(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.organization_id;
      const { from, to } = req.query;

      if (!admin_id || !organization_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Missing organization_id or admin_id" });
      }
      if ((from && !dayjs(from).isValid()) || (to && !dayjs(to).isValid())) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ success: false, message: "from/to must be valid dates" });
      }

      // Default to the current month.
      const fromDate = from
        ? dayjs(from).startOf("day").toDate()
        : dayjs().startOf("month").toDate();
      const toDate = to
        ? dayjs(to).endOf("day").toDate()
        : dayjs().endOf("month").toDate();

      const [accounts, journals] = await Promise.all([
        getAccountsMap(organization_id, admin_id),
        JournalCollection.find(
          {
            organization_id: String(organization_id),
            admin_id,
            journal_date: { $gte: fromDate, $lte: toDate },
          },
          { journal_id: 1, type: 1, line_items: 1 }
        ).lean(),
      ]);

      // Amounts are accumulated in paise and converted at the end.
      const newSection = () => ({ debit: 0, credit: 0, count: 0, accounts: new Map() });
      const sections = {
        invoices: newSection(), // operating income
        bills: newSection(), // cost of goods sold
        expenses: newSection(), // operating expenses
      };
      const documentCounts = { Invoice: 0, Bill: 0, Expense: 0 };
      const unclassified = new Map();

      const sectionFor = (accountType) => {
        if (INCOME_TYPES.includes(accountType)) return "invoices";
        if (COGS_TYPES.includes(accountType)) return "bills";
        if (OPERATING_EXPENSE_TYPES.includes(accountType)) return "expenses";
        return null; // balance sheet account: not part of P&L
      };

      for (const journal of journals) {
        if (journal.type in documentCounts) documentCounts[journal.type]++;

        for (const line of journal.line_items || []) {
          const paise = toPaise(line.amount || 0);
          const isDebit = line.creditOrDebit === "Debit";
          const account = accounts.get(line.coa_account_id);

          if (!account) {
            const key = line.coa_account_id || "(none)";
            const u = unclassified.get(key) || {
              account_id: key,
              account_name: line.coa_account_name || "Unknown account",
              debit_balance: 0,
            };
            u.debit_balance += isDebit ? paise : -paise;
            unclassified.set(key, u);
            continue;
          }

          const sectionKey = sectionFor(account.account_type);
          if (!sectionKey) continue;
          const section = sections[sectionKey];
          if (isDebit) section.debit += paise;
          else section.credit += paise;

          const acc = section.accounts.get(account.account_id) || {
            account_name: account.account_name,
            account_type: account.account_type,
            debit_amount: 0,
            credit_amount: 0,
            transaction_count: 0,
          };
          if (isDebit) acc.debit_amount += paise;
          else acc.credit_amount += paise;
          acc.transaction_count++;
          section.accounts.set(account.account_id, acc);
        }
      }

      // Income is credit-normal; COGS and expenses are debit-normal.
      const build = (section, creditNormal) => {
        const coa_accounts = {};
        for (const [id, a] of section.accounts) {
          const net = creditNormal ? a.credit_amount - a.debit_amount : a.debit_amount - a.credit_amount;
          coa_accounts[id] = {
            account_name: a.account_name,
            account_type: a.account_type,
            total_amount: fromPaise(net),
            debit_amount: fromPaise(a.debit_amount),
            credit_amount: fromPaise(a.credit_amount),
            transaction_count: a.transaction_count,
          };
        }
        const net = creditNormal ? section.credit - section.debit : section.debit - section.credit;
        return { coa_accounts, netPaise: net };
      };

      const income = build(sections.invoices, true);
      const cogs = build(sections.bills, false);
      const expenses = build(sections.expenses, false);

      const grossProfit = income.netPaise - cogs.netPaise;
      const netProfit = grossProfit - expenses.netPaise;

      const data = {
        invoices: {
          // Sales and other income; debits on income accounts (e.g. discounts) reduce it.
          totalCredits: fromPaise(sections.invoices.credit),
          totalDiscounts: fromPaise(sections.invoices.debit),
          netAmount: fromPaise(income.netPaise),
          count: documentCounts.Invoice,
          coa_accounts: income.coa_accounts,
        },
        bills: {
          totalDebits: fromPaise(sections.bills.debit),
          totalDiscounts: fromPaise(sections.bills.credit),
          netAmount: fromPaise(cogs.netPaise),
          count: documentCounts.Bill,
          coa_accounts: cogs.coa_accounts,
        },
        expenses: {
          totalDebits: fromPaise(sections.expenses.debit),
          totalCredits: fromPaise(sections.expenses.credit),
          netAmount: fromPaise(expenses.netPaise),
          count: documentCounts.Expense,
          coa_accounts: expenses.coa_accounts,
        },
        summary: {
          operatingIncome: fromPaise(income.netPaise),
          costOfGoodsSold: fromPaise(cogs.netPaise),
          grossProfit: fromPaise(grossProfit),
          operatingExpenses: fromPaise(expenses.netPaise),
          operatingProfit: fromPaise(netProfit),
          netProfitLoss: fromPaise(netProfit),
        },
        profit_loss: {
          amount: fromPaise(netProfit),
          status: netProfit >= 0 ? "Profit" : "Loss",
          calculation: `Operating Income (${fromPaise(income.netPaise)}) - COGS (${fromPaise(
            cogs.netPaise
          )}) - Expenses (${fromPaise(expenses.netPaise)}) = ${fromPaise(netProfit)}`,
        },
        checks: {
          journal_count: journals.length,
          has_chart_of_accounts: accounts.size > 0,
          unclassified_accounts: [...unclassified.values()].map((u) => ({
            ...u,
            debit_balance: fromPaise(u.debit_balance),
          })),
        },
      };

      const dateRange = {
        from: dayjs(fromDate).format("YYYY-MM-DD"),
        to: dayjs(toDate).format("YYYY-MM-DD"),
      };
      // dateRange is also inside `data`, which is where the P&L page reads it.
      res.status(ST_CODES.OK).json({ success: true, data: { ...data, dateRange }, dateRange });
    } catch (err) {
      console.error("Profit & Loss error:", err);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: "Error generating profit & loss report" });
    }
  }
}

module.exports = new ProfitLossController();
