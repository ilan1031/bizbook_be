const mongoose = require("mongoose");
const COA_collection = mongoose.model("Chart_of_account");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { POSTED_JOURNALS } = require("../helpers/accountingHelper");
const MESSAGE = require("../helpers/messageHelpers");
const JournalCollection = mongoose.model("Journal");
const DEFAULT_ACCOUNTS = require("../helpers/chartOfAccounts.json");

// Account types the reports know about, with their display names.
const TYPE_LABELS = DEFAULT_ACCOUNTS.reduce((m, a) => {
  if (a.account_type) m[a.account_type] = a.account_type_formatted;
  return m;
}, {});
const MAX_ACCOUNT_NAME = 150;
const nameKey = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const checkAccountName = (raw, accounts, exceptId) => {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Account name is required" };
  if (name.length > MAX_ACCOUNT_NAME) return { error: `Account name can be at most ${MAX_ACCOUNT_NAME} characters` };
  const key = nameKey(name);
  if ((accounts || []).some((a) => a.account_id !== exceptId && nameKey(a.account_name) === key)) {
    return { error: "An account with this name already exists" };
  }
  return { name };
};
const hasTransactions = async (org_id, COA_ID) =>
  Boolean(
    await JournalCollection.exists({
      organization_id: `${org_id}`,
      "line_items.coa_account_id": `${COA_ID}`,
    })
  );

class COA_Controller {
  async COA_list(req, res) {
    try {
      let { org_id, filter, status, sort_column, sort_order } = req.query;
      let admin_id = res.locals.user_id;
      let sorting = {};
      sorting["chart_of_accounts." + sort_column] = sort_order == "A" ? 1 : -1;
      let isActive = status === "true";
      let type;
      if (filter === "All" || filter === "Active" || filter === "Inactive") {
        type = {
          "chart_of_accounts.is_active": isActive,
        };
      } else {
        type = {
          "chart_of_accounts.is_active": isActive,
          "chart_of_accounts.account_type": `${filter}`,
        };
      }

      let getCOA_List = await COA_collection.aggregate([
        {
          $match: {
            organization_id: org_id,
            admin_id: new mongoose.Types.ObjectId(admin_id),
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: type,
        },
        {
          $sort: sorting,
        },
        {
          $group: {
            _id: "$_id",
            organization_id: {
              $first: "$organization_id",
            },
            chart_of_accounts: {
              $push: "$chart_of_accounts",
            },
          },
        },
      ]);
      if (!getCOA_List.length) {
        return res.status(ST_CODES.OK).send({
          message: MESSAGE.HISTORY_FETCHED,
          data: [],
        });
      }
      return res.status(ST_CODES.OK).send({
        message: MESSAGE.HISTORY_FETCHED,
        data: getCOA_List[0],
      });
    } catch (error) {
      console.error("getCOAList error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: MESSAGE.SOMETHING_WRONG });
    }
  }
  async getCOAList(req, res) {
    try {
      let { org_id } = req.query;
      let admin_id = res.locals.user_id;
      let getCOA_List = await COA_collection.aggregate([
        {
          $match: {
            organization_id: org_id,
            admin_id: new mongoose.Types.ObjectId(admin_id),
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: {
            "chart_of_accounts.is_active": true,
          },
        },
        {
          $group: {
            _id: "$chart_of_accounts.account_type_formatted",
            accounts: {
              $push: {
                account_id: "$chart_of_accounts.account_id",
                account_name: "$chart_of_accounts.account_name",
                parent_account_id: "$chart_of_accounts.parent_account_id",
                depth: "$chart_of_accounts.depth",
              },
            },
          },
        },
      ]);
      return res.status(ST_CODES.OK).send({
        message: MESSAGE.HISTORY_FETCHED,
        data: getCOA_List,
      });
    } catch (error) {
      console.error("getCOAList error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: MESSAGE.SOMETHING_WRONG });
    }
  }
  async getPaidThroughAccount(req, res) {
    try {
      let { org_id } = req.query;
      let admin_id = res.locals.user_id;
      let getCOA_List = await COA_collection.aggregate([
        {
          $match: {
            organization_id: org_id,
            admin_id: new mongoose.Types.ObjectId(admin_id),
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: {
            "chart_of_accounts.is_active": true,
            "chart_of_accounts.is_ze_paid_through_account": true,
          },
        },
        {
          $group: {
            _id: "$chart_of_accounts.account_type_formatted",
            accounts: {
              $push: {
                account_id: "$chart_of_accounts.account_id",
                account_name: "$chart_of_accounts.account_name",
                parent_account_id: "$chart_of_accounts.parent_account_id",
                depth: "$chart_of_accounts.depth",
              },
            },
          },
        },
      ]);
      return res.status(ST_CODES.OK).send({
        message: MESSAGE.HISTORY_FETCHED,
        data: getCOA_List,
      });
    } catch (error) {
      console.error("getCOAList error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: MESSAGE.SOMETHING_WRONG });
    }
  }
  async IndividualView(req, res) {
    try {
      let { org_id, COA_ID } = req.query;
      let admin_id = res.locals.user_id;
      let getCOA = await COA_collection.aggregate([
        {
          $match: {
            organization_id: org_id,
            admin_id: new mongoose.Types.ObjectId(admin_id),
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: {
            "chart_of_accounts.is_active": true,
            "chart_of_accounts.account_id": `${COA_ID}`,
          },
        },
      ]);

      if (!getCOA.length) {
        return res.status(ST_CODES.OK).send({
          status: false,
          message: MESSAGE.NOT_FOUND,
          data: [],
        });
      }
      return res.status(ST_CODES.OK).send({
        status: true,
        message: MESSAGE.HISTORY_FETCHED,
        data: getCOA[0],
      });
    } catch (error) {
      console.error("individualView error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: MESSAGE.SOMETHING_WRONG });
    }
  }
  async edit_COA(req, res) {
    try {
      let { org_id, COA_ID } = req.query;
      let admin_id = res.locals.user_id;
      let updateFields = req.body;
      const allowedFields = ["account_name","description", "account_code"];
      const sanitizedUpdateFields = Object.fromEntries(
        Object.entries(updateFields || {}).filter(([key]) =>
          allowedFields.includes(key)
        )
      );
      const chart = await COA_collection.findOne(
        { organization_id: org_id, admin_id: new mongoose.Types.ObjectId(admin_id) },
        { chart_of_accounts: 1 }
      ).lean();
      const current = chart?.chart_of_accounts?.find((a) => a.account_id === `${COA_ID}`);
      if (!current) {
        return res.status(ST_CODES.NOT_FOUND).send({ status: false, message: "Account not found" });
      }
      if (sanitizedUpdateFields.account_name !== undefined) {
        const checked = checkAccountName(sanitizedUpdateFields.account_name, chart.chart_of_accounts, current.account_id);
        if (checked.error) return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: checked.error });
        sanitizedUpdateFields.account_name = checked.name;
      }
      if (sanitizedUpdateFields.description !== undefined) {
        sanitizedUpdateFields.description = String(sanitizedUpdateFields.description ?? "").slice(0, 500);
      }
      if (sanitizedUpdateFields.account_code !== undefined) {
        sanitizedUpdateFields.account_code = String(sanitizedUpdateFields.account_code ?? "").trim().slice(0, 30);
      }
      const result = await COA_collection.findOneAndUpdate(
        {
          organization_id: org_id,
          admin_id: new mongoose.Types.ObjectId(admin_id),
          // "chart_of_accounts.account_id": COA_ID,
        },
        {
          $set: Object.fromEntries(
            Object.entries(sanitizedUpdateFields).map(([key, val]) => [
              `chart_of_accounts.$[coa].${key}`,
              val,
            ])
          ),
        },
        {
          arrayFilters: [{ "coa.account_id": COA_ID }],
        }
      );
      let getCOA = await COA_collection.aggregate([
        {
          $match: {
            organization_id: org_id,
            admin_id: new mongoose.Types.ObjectId(admin_id),
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: {
            "chart_of_accounts.is_active": true,
            "chart_of_accounts.account_id": `${COA_ID}`,
          },
        },
      ]);
      if (!getCOA.length) {
        return res.status(ST_CODES.OK).send({
          status: false,
          message: MESSAGE.NOT_FOUND,
          data: [],
        });
      }
      return res.status(ST_CODES.OK).send({
        status: true,
        message: MESSAGE.UPDATED,
        data: getCOA[0],
      });
    } catch (error) {
      console.error("edit_COA error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: MESSAGE.SOMETHING_WRONG });
    }
  }
  async getCOA_types(req, res) {
    try {
      let { org_id } = req.query;
      let admin_id = res.locals.user_id;
      let getCOA_types = await COA_collection.aggregate([
        {
          $match: {
            organization_id: org_id,
            admin_id: new mongoose.Types.ObjectId(admin_id),
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: {
            "chart_of_accounts.is_active": true,
          },
        },
        {
          $project: {
            account_type: "$chart_of_accounts.account_type",
            account_formatted_type: "$chart_of_accounts.account_type_formatted",
            account_id: "$chart_of_accounts.account_id",
            description: "$chart_of_accounts.description",
          },
        },
        {
          $group: {
            _id: "$account_formatted_type",
            account_type: {
              $first: "$account_type",
            },
            account_id: {
              $first: "$account_id",
            },
            description: {
              $first: "$description",
            },
          },
        },
        {
          $sort: {
            _id: 1,
          },
        },
        {
          $project: {
            _id: 0,
            account_formatted_type: "$_id",
            account_type: 1,
            parent_id: 1,
            account_id: 1,
            description: 1,
          },
        },
      ]);
      if (!getCOA_types.length) {
        return res.status(ST_CODES.OK).send({
          status: false,
          message: MESSAGE.NOT_FOUND,
          data: [],
        });
      }
      return res.status(ST_CODES.OK).send({
        message: MESSAGE.HISTORY_FETCHED,
        data: getCOA_types,
      });
    } catch (error) {
      console.error("getCOA_types error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: MESSAGE.SOMETHING_WRONG });
    }
  }
  async add_COA(req, res) {
    try {
      let { org_id } = req.query;
      let admin_id = res.locals.user_id;
      let bData = req.body;
      let getCOA_List = await COA_collection.findOne({
        organization_id: org_id,
        admin_id: admin_id,
      });
      if (!getCOA_List) {
        return res.status(ST_CODES.OK).send({
          status: false,
          message: MESSAGE.NOT_FOUND,
          data: [],
        });
      }

      let coaData = getCOA_List.chart_of_accounts;
      const checked = checkAccountName(bData?.account_name, coaData);
      if (checked.error) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: checked.error });
      }
      const accountType = String(bData?.account_type ?? "").trim();
      const knownTypes = TYPE_LABELS;
      if (!accountType || !knownTypes[accountType]) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: "Choose a valid account type" });
      }
      // Next number after the highest existing one (ids are never reused).
      const maxNumber = coaData.reduce((m, a) => Math.max(m, Number(String(a.account_id || "").split("_")[1]) || 0), 0);
      let formattedNextId = String(maxNumber + 1).padStart(3, "0");
      let newAccountId = `AC_${formattedNextId}`;
      let newValue = {
        account_id: newAccountId,
        account_name: checked.name,
        account_code: String(bData.account_code ?? "").trim().slice(0, 30),
        account_type: accountType,
        account_type_formatted: knownTypes[accountType],
        description: String(bData.description ?? "").slice(0, 500),
        is_user_created: true,
        is_system_account: false,
        is_active: true,
        can_show_in_ze: false,
        parent_account_id: "",
        parent_account_name: "",
        depth: 0,
        has_attachment: false,
        is_child_present: false,
        child_count: null,
        is_standalone_account: false,
        is_ze_paid_through_account: false,
      };
      await COA_collection.findOneAndUpdate(
        {
          organization_id: org_id,
          admin_id: admin_id,
        },
        {
          $push: { chart_of_accounts: newValue },
        }
      );
      return res.status(ST_CODES.OK).send({
        message: MESSAGE.UPDATED,
        data: { account_id: newAccountId },
      });
    } catch (error) {
      console.error("add_COA error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: MESSAGE.SOMETHING_WRONG });
    }
  }
  async updateStatus(req, res) {
    try {
      let { org_id, COA_ID } = req.query;
      let admin_id = res.locals.user_id;
      let updateFields = req.body;
      const allowedFields = ["is_active"];
      const sanitizedUpdateFields = Object.fromEntries(
        Object.entries(updateFields || {}).filter(([key]) =>
          allowedFields.includes(key)
        )
      );
      if (typeof sanitizedUpdateFields.is_active !== "boolean") {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: "is_active must be true or false" });
      }
      const chart = await COA_collection.findOne(
        { organization_id: org_id, admin_id: new mongoose.Types.ObjectId(admin_id) },
        { chart_of_accounts: 1 }
      ).lean();
      const account = chart?.chart_of_accounts?.find((a) => a.account_id === `${COA_ID}`);
      if (!account) {
        return res.status(ST_CODES.NOT_FOUND).send({ status: false, message: "Account not found" });
      }
      if (sanitizedUpdateFields.is_active === false && account.is_system_account) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "This is a system account used by BizBooks itself, so it can't be marked inactive.",
        });
      }
      const result = await COA_collection.findOneAndUpdate(
        {
          organization_id: org_id,
          admin_id: new mongoose.Types.ObjectId(admin_id),
          // "chart_of_accounts.account_id": COA_ID,
        },
        {
          $set: Object.fromEntries(
            Object.entries(sanitizedUpdateFields).map(([key, val]) => [
              `chart_of_accounts.$[coa].${key}`,
              val,
            ])
          ),
        },
        {
          arrayFilters: [{ "coa.account_id": COA_ID }],
        }
      );
      let getCOA = await COA_collection.aggregate([
        {
          $match: {
            organization_id: org_id,
            admin_id: new mongoose.Types.ObjectId(admin_id),
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: {
            "chart_of_accounts.account_id": `${COA_ID}`,
          },
        },
      ]);
      if (!getCOA.length) {
        return res.status(ST_CODES.OK).send({
          status: false,
          message: MESSAGE.NOT_FOUND,
          data: [],
        });
      }
      console.log(getCOA[0]);
      return res.status(ST_CODES.OK).send({
        status: true,
        message: MESSAGE.UPDATED,
        data: getCOA[0],
      });
    } catch (error) {
      console.error("add_COA error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: MESSAGE.SOMETHING_WRONG });
    }
  }
  // POST /COA/delete-coa?org_id=&COA_ID= - removes an account the user
  // created, as long as nothing has been posted to it.
  async deleteCOA(req, res) {
    try {
      const { org_id, COA_ID } = req.query;
      const admin_id = res.locals.user_id;
      if (!org_id || !COA_ID) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: "org_id and COA_ID are required" });
      }
      const chart = await COA_collection.findOne(
        { organization_id: org_id, admin_id: new mongoose.Types.ObjectId(admin_id) },
        { chart_of_accounts: 1 }
      ).lean();
      const account = chart?.chart_of_accounts?.find((a) => a.account_id === `${COA_ID}`);
      if (!account) {
        return res.status(ST_CODES.NOT_FOUND).send({ status: false, message: "Account not found" });
      }
      if (account.is_system_account || account.is_user_created === false) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "This is a default account used by BizBooks itself, so it can't be deleted.",
        });
      }
      if (await hasTransactions(org_id, COA_ID)) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "This account has transactions, so it can't be deleted. Mark it as inactive instead.",
        });
      }
      await COA_collection.updateOne(
        { _id: chart._id },
        { $pull: { chart_of_accounts: { account_id: `${COA_ID}` } } }
      );
      return res.status(ST_CODES.OK).send({ status: true, message: "Account deleted" });
    } catch (error) {
      console.error("deleteCOA error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: MESSAGE.SOMETHING_WRONG });
    }
  }
  async getIndividual_COA_transaction(req, res) {
    try {
      let { org_id, COA_ID } = req.query;
      let admin_id = res.locals.user_id;
      if (!org_id || !COA_ID) {
        return res.status(ST_CODES.OK).send({
          status: false,
          message: MESSAGE.NOT_FOUND,
          transaction_history: [],
          total_amount: 0,
        });
      }
      let getCOA = await COA_collection.aggregate([
        {
          $match: {
            organization_id: org_id,
            admin_id: new mongoose.Types.ObjectId(admin_id),
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: {
            "chart_of_accounts.is_active": true,
            "chart_of_accounts.account_id": `${COA_ID}`,
          },
        },
      ]);

      if (!getCOA.length) {
        return res.status(ST_CODES.OK).send({
          status: false,
          message: MESSAGE.NOT_FOUND,
          data: [],
        });
      }

      let getCOA_transaction = await JournalCollection.aggregate([
        [
          {
            $match: {
              organization_id: `${org_id}`,
              ...POSTED_JOURNALS,
              // admin_id: new mongoose.Types.ObjectId(admin_id),
            },
          },
          {
            $unwind: {
              path: "$line_items",
            },
          },
          {
            $group: {
              _id: "$line_items",
              journal_date: {
                $first: "$journal_date",
              },
              coa_account_id: {
                $first: "$line_items.coa_account_id",
              },
              coa_account_name: {
                $first: "$line_items.coa_account_name",
              },
              creditOrDebit: {
                $first: "$line_items.creditOrDebit",
              },
              amount: {
                $first: "$line_items.amount",
              },
              amount_formatted: {
                $first: "$line_items.amount_formatted",
              },
              journal_obj_id: {
                $first: "$line_items._id",
              },
              vendor_name: {
                $first: "$vendor_name",
              },
              journal_date_formatted: {
                $first: "$journal_date_formatted",
              },
              type: {
                $first: "$type",
              },
            },
          },
          {
            $project: {
              _id: 0,
            },
          },
          {
            $match: {
              coa_account_id: `${COA_ID}`,
            },
          },
          {
            $facet: {
              transactions: [
                {
                  $sort: {
                    journal_date: -1,
                  },
                },
              ],
              totals: [
                {
                  $group: {
                    _id: null,
                    debit_total: {
                      $sum: { $cond: [{ $eq: ["$creditOrDebit", "Debit"] }, "$amount", 0] },
                    },
                    credit_total: {
                      $sum: { $cond: [{ $eq: ["$creditOrDebit", "Credit"] }, "$amount", 0] },
                    },
                  },
                },
              ],
            },
          },
          {
            $project: {
              transactions: 1,
              debit_total: { $ifNull: [{ $arrayElemAt: ["$totals.debit_total", 0] }, 0] },
              credit_total: { $ifNull: [{ $arrayElemAt: ["$totals.credit_total", 0] }, 0] },
            },
          },
        ],
      ]);
      // console.log(
      //   getCOA_transaction[0].transactions,
      //   getCOA_transaction[0].total_amount,
      //   "getCOA_transaction"
      // );
      if (!getCOA_transaction[0].transactions.length) {
        return res.status(ST_CODES.OK).send({
          status: true,
          message: "There is no data on file...",
          transaction_history: [],
          total_amount: 0,
          debit_total: 0,
          credit_total: 0,
          balance_type: "Dr",
          COA: getCOA[0].chart_of_accounts,
        });
      }
      // Closing balance: debits minus credits, shown as Dr or Cr.
      const debitPaise = Math.round((getCOA_transaction[0].debit_total || 0) * 100);
      const creditPaise = Math.round((getCOA_transaction[0].credit_total || 0) * 100);
      const net = debitPaise - creditPaise;
      return res.status(ST_CODES.OK).send({
        status: true,
        message: MESSAGE.HISTORY_FETCHED,
        transaction_history: getCOA_transaction[0].transactions,
        total_amount: Math.abs(net) / 100,
        debit_total: debitPaise / 100,
        credit_total: creditPaise / 100,
        balance_type: net < 0 ? "Cr" : "Dr",
        COA: getCOA[0].chart_of_accounts,
      });
    } catch (error) {
      console.error("getIndividualIdBasedCOA error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ status: false, message: MESSAGE.SOMETHING_WRONG });
    }
  }
}

module.exports = new COA_Controller();
