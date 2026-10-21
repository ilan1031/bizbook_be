const mongoose = require("mongoose");
const COA_collection = mongoose.model("Chart_of_account");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { POSTED_JOURNALS } = require("../helpers/accountingHelper");
const MESSAGE = require("../helpers/messageHelpers");
const JournalCollection = mongoose.model("Journal");
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
        Object.entries(updateFields).filter(([key]) =>
          allowedFields.includes(key)
        )
      );
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
      console.log(getCOA,"getCOAgetCOAgetCOA");
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
      let lastAccId = coaData[coaData.length - 1].account_id;
      let uniqueId = lastAccId.split("_")[1];
      let nextUniqueNumber = Number(uniqueId) + 1;
      let formattedNextId = String(nextUniqueNumber).padStart(3, "0");
      let newAccountId = `AC_${formattedNextId}`;
      let newValue = {
        account_id: newAccountId,
        account_name: bData.account_name,
        account_code: bData.account_code,
        account_type: bData.account_type,
        account_type_formatted: bData.account_type_formatted,
        description: bData.description,
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
        Object.entries(updateFields).filter(([key]) =>
          allowedFields.includes(key)
        )
      );
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
                    total_amount: {
                      $sum: "$amount",
                    },
                  },
                },
              ],
            },
          },
          {
            $project: {
              transactions: 1,
              total_amount: {
                $ifNull: [
                  {
                    $arrayElemAt: ["$totals.total_amount", 0],
                  },
                  0,
                ],
              },
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
          COA: {
            account_type: "",
            account_type_formatted: "",
            description: "",
          },
        });
      }
      return res.status(ST_CODES.OK).send({
        status: true,
        message: MESSAGE.HISTORY_FETCHED,
        transaction_history: getCOA_transaction[0].transactions,
        total_amount: getCOA_transaction[0].total_amount,
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
