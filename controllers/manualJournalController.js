const mongoose = require("mongoose");
const dayjs = require("dayjs");
const JournalCollection = mongoose.model("Journal");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const {
  toPaise,
  fromPaise,
  formatCurrency,
  getAccountsMap,
} = require("../helpers/accountingHelper");

const MANUAL_JOURNAL_TYPE = "Manual Journal";

class ManualJournalController {
  // List manual journal entries for an organisation, newest first.
  async getManualJournals(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, message: "Organization ID is required" });
      }

      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 200);
      const skip = (page - 1) * limit;

      const query = {
        organization_id: String(organization_id),
        admin_id,
        type: MANUAL_JOURNAL_TYPE,
      };
      if (req.query.from || req.query.to) {
        query.journal_date = {};
        if (req.query.from)
          query.journal_date.$gte = dayjs(req.query.from).startOf("day").toDate();
        if (req.query.to)
          query.journal_date.$lte = dayjs(req.query.to).endOf("day").toDate();
      }

      const [journals, totalCount] = await Promise.all([
        JournalCollection.find(query)
          .sort({ journal_date: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        JournalCollection.countDocuments(query),
      ]);

      res.status(ST_CODES.OK).json({
        status: true,
        data: journals,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalRecords: totalCount,
          recordsPerPage: limit,
        },
      });
    } catch (error) {
      console.log("getManualJournals error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ status: false, message: "Failed to retrieve journal entries" });
    }
  }

  // Create a manual journal entry. Every line must reference an active account
  // in this organisation's chart of accounts, and debits must equal credits.
  async createManualJournal(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      const { journal_date, reference_number, notes, line_items } = req.body || {};

      if (!organization_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, message: "Organization ID is required" });
      }
      if (!journal_date || !dayjs(journal_date).isValid()) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, message: "A valid journal date is required" });
      }
      if (!Array.isArray(line_items) || line_items.length < 2) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "A journal entry needs at least two lines",
        });
      }

      const accounts = await getAccountsMap(organization_id, admin_id);
      if (accounts.size === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "This organization has no chart of accounts set up",
        });
      }

      let debitPaise = 0;
      let creditPaise = 0;
      const lines = [];
      for (const [index, line] of line_items.entries()) {
        const lineNo = index + 1;
        const account = accounts.get(line?.coa_account_id);
        if (!account || account.is_active === false) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            status: false,
            message: `Line ${lineNo}: select a valid, active account`,
          });
        }
        if (!["Debit", "Credit"].includes(line.creditOrDebit)) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            status: false,
            message: `Line ${lineNo}: must be a Debit or a Credit`,
          });
        }
        const amount = Number(line.amount);
        const paise = toPaise(amount);
        if (!Number.isFinite(amount) || paise <= 0) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            status: false,
            message: `Line ${lineNo}: amount must be greater than zero`,
          });
        }
        if (Math.abs(paise - amount * 100) > 1e-6) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            status: false,
            message: `Line ${lineNo}: amount can have at most 2 decimal places`,
          });
        }

        if (line.creditOrDebit === "Debit") debitPaise += paise;
        else creditPaise += paise;

        lines.push({
          coa_account_id: account.account_id,
          // Use the name from the chart of accounts, not whatever the client sent.
          coa_account_name: account.account_name,
          creditOrDebit: line.creditOrDebit,
          amount: fromPaise(paise),
          amount_formatted: formatCurrency(fromPaise(paise)),
        });
      }

      if (debitPaise !== creditPaise) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: `Debits (${formatCurrency(
            fromPaise(debitPaise)
          )}) must equal credits (${formatCurrency(fromPaise(creditPaise))})`,
        });
      }

      const journal_id = await commonHelper.generateUniqueId(
        JournalCollection,
        "journal_id",
        5,
        "JL"
      );
      const date = dayjs(journal_date).startOf("day").toDate();
      const total = fromPaise(debitPaise);

      const journal = await JournalCollection.create({
        organization_id: String(organization_id),
        admin_id,
        journal_id,
        journal_date: date,
        journal_date_formatted: commonHelper.formatDateString(date),
        total_amount: total,
        total_amount_formatted: formatCurrency(total),
        type: MANUAL_JOURNAL_TYPE,
        reference_number: String(reference_number || "").trim().slice(0, 100),
        notes: String(notes || "").trim().slice(0, 1000),
        line_items: lines,
      });

      res.status(ST_CODES.CREATED).json({
        status: true,
        data: journal,
        message: "Journal entry created",
      });
    } catch (error) {
      console.log("createManualJournal error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ status: false, message: "Failed to create journal entry" });
    }
  }

  // Delete a manual journal entry. Journals generated by invoices, bills,
  // expenses, etc. are owned by those documents and can't be deleted here.
  async deleteManualJournal(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      const { journal_id } = req.params;
      if (!organization_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, message: "Organization ID is required" });
      }

      const deleted = await JournalCollection.findOneAndDelete({
        organization_id: String(organization_id),
        admin_id,
        journal_id,
        type: MANUAL_JOURNAL_TYPE,
      });
      if (!deleted) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({ status: false, message: "Manual journal entry not found" });
      }

      res
        .status(ST_CODES.OK)
        .json({ status: true, message: "Journal entry deleted" });
    } catch (error) {
      console.log("deleteManualJournal error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ status: false, message: "Failed to delete journal entry" });
    }
  }
}

module.exports = new ManualJournalController();
