// controllers/profitLossController.js
const mongoose = require("mongoose");
const JournalCollection = mongoose.model("Journal");
// const COA = mongoose.model("COA");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");

class ProfitLossController {
  async getProfitLossReport(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      const from = req.query.from; // e.g. "2025-06-15"
      const to = req.query.to; // e.g. "2025-06-21"

      if (!admin_id || !organization_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Missing org_id or admin_id" });
      }

      const fromDate = dayjs(from).startOf("day").toDate();
      const toDate = dayjs(to).endOf("day").toDate();

      // Step 1: Fetch COA
      const coaList = await COA.find({ organization_id });
      const coaMap = new Map();
      coaList.forEach((acc) =>
        coaMap.set(acc._id.toString(), acc.account_type)
      );

      // Step 2: Fetch relevant journal entries
      const journals = await JournalCollection.find({
        organization_id,
        admin_id,
        journal_date: { $gte: fromDate, $lte: toDate },
      });

      // Step 3: Group and calculate
      const accountSummary = {};
      let totalIncome = 0;
      let totalExpense = 0;

      for (const journal of journals) {
        for (const line of journal.line_items) {
          const coaId = line.coa_account_id;
          const accType = coaMap.get(coaId);

          if (!accType) continue; // skip unknown accounts

          const amount = line.amount || 0;
          const effect = line.creditOrDebit === "Credit" ? 1 : -1;
          const signedAmount = amount * effect;

          if (!accountSummary[coaId]) {
            accountSummary[coaId] = {
              account_name: line.coa_account_name,
              account_type: accType,
              total: 0,
            };
          }

          accountSummary[coaId].total += signedAmount;

          if (accType === "Income") totalIncome += signedAmount;
          else if (accType === "Expense") totalExpense += -signedAmount; // expenses are usually debits
        }
      }

      const netProfit = totalIncome - totalExpense;

      res.status(ST_CODES.OK).json({
        data: Object.values(accountSummary),
        summary: {
          totalIncome,
          totalExpense,
          netProfit,
        },
      });
    } catch (err) {
      console.error("Profit & Loss Error:", err);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Error generating P&L report" });
    }
  }
}

module.exports = new ProfitLossController();

