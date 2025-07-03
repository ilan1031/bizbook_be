const mongoose = require("mongoose");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const ExpenseCollection = mongoose.model("Expense");
const RecurringExpenseCollection = mongoose.model("Recurring_Expense");

const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const userActivityHelper = require("../helpers/userActivityHelper");
const moment = require("moment");

function createComments(
  commented_by,
  commented_by_id,
  comment_type,
  id,
  description,
  operation_type = "",
  transaction_id = "",
  transaction_type = ""
) {
  const now = new Date();
  const date = now.toISOString().split("T")[0]; // yyyy-mm-dd
  const formattedDate = now.toLocaleDateString("en-GB"); // DD/MM/YYYY
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }); // e.g. 10:30 AM
  const formattedDateTime = `${formattedDate} ${time}`;

  const commentData = {
    recurring_expense_id: id,
    description: description,
    commented_by_id: commented_by_id,
    commented_by: commented_by,
    comment_type: comment_type,
    date: date,
    date_formatted: formattedDateTime,
    time: time,
    operation_type: operation_type,
    transaction_id: transaction_id,
    transaction_type: transaction_type,
    sentiment: "none", // fixed string instead of undefined variable
  };

  return commentData;
}

class RecurringExpenseController {
  async createRecurringExpense(req, res) {
    try {
      let bData = req.body;
      let orgId = req.query.org_id;
      const admin_id = res.locals.user_id;
      // bData["admin_id"] = admin_id;
      // bData["organization_id"] = orgId;
      let expenseUniqueId = await commonHelper.generateUniqueId(
        ExpenseCollection,
        "unique_EX_id",
        5,
        "EX"
      );
      let recurringExpenseUniqueId = await commonHelper.generateUniqueId(
        RecurringExpenseCollection,
        "recurring_expense_id",
        5,
        "RE"
      );
      let expenseData = {
        vendor_id: bData.vendor_id,
        admin_id: admin_id,
        organization_id: orgId,
        unique_EX_id: expenseUniqueId,
        paid_through_account_id: bData.paid_through_account_id,
        form_status: 0,
        date: bData.start_date,
        invoice_number: bData.invoice_number,
        tot_amount: bData.tot_amount,
        tot_amount_with_tax: bData.tot_amount_with_tax,
        expense_type: bData.expense_type,
        inclusive_exclusive: bData.inclusive_exclusive,
        base_amount: bData.base_amount,
        destination_of_supply: bData.destination_of_supply,
        source_of_supply: bData.source_of_supply,
        hsn_code: bData.hsn_code,
        sac_code: bData.sac_code,
        gst_treatment: bData.gst_treatment,
        gst_no: bData.gst_no,
        reverse_charge: bData.reverse_charge,
        expense_tax_percent: bData.expense_tax_percent,
        expense_tax_amount: bData.expense_tax_amount,
        lineItems: [
          {
            line_item_id: "",
            account_id: bData.account_name,
            description: bData.description,
            amount: bData.amount,
          },
        ],
        customer_id: bData.customer_id,
        currency_id: bData.currency_id,
        type: "expense",
        status: 0,
        is_Billable: false,
      };
      let createExpense = await queryHelper.insertData(
        ExpenseCollection,
        expenseData
      );
      // console.log("createExpense.msg", createExpense);
      // return;

      let nextDate =
        bData.end_date == "" ? bData.next_expense_date : bData.end_date;

      // console.log(
      //   "lets check",
      //   recurringExpenseData
      //   // "--------DATAS FROM API"
      // );
      // return;
      // console.log(recurringExpenseData, "recurringExpenseData");
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System";
      const description = `Recurring expense created for ₹${commonHelper.formatRupees(
        bData.tot_amount
      )}`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurringExpenseUniqueId,
        description,
        "Added", // operation_type
        "", // transaction_id
        "recurring_expense"
      );

      let recurringExpenseData = {
        vendor_id: bData.vendor_id,
        admin_id: admin_id,
        organization_id: orgId,
        unique_EX_id: expenseUniqueId,
        customer_id: bData.customer_id,
        recurring_expense_id: recurringExpenseUniqueId,
        item_list: [
          {
            expense_id: createExpense.msg._id,
            expense_number: expenseUniqueId,
          },
        ],
        recurrence_frequency: bData.recurrence_frequency, //bData.recurrence_frequency
        recurrence_frequency_formatted: bData.recurrence_frequency_formatted, //bData.recurrence_frequency_formatted
        repeat_every: bData.repeat_every,
        start_date: bData.start_date,
        start_date_formatted: commonHelper.formatDateString(bData.start_date),
        end_date: bData.end_date,
        end_date_formatted: commonHelper.formatDateString(bData.end_date),
        last_created_date: bData.start_date,
        last_created_date_formatted: commonHelper.formatDateString(
          bData.start_date
        ),
        next_expense_date: bData.next_expense_date
          ? moment(bData.next_expense_date, "DD-MM-YYYY").toDate()
          : null,
        next_expense_date_formatted: commonHelper.formatDateString(
          bData.next_expense_date
        ),
        profile_name: bData.profile_name,
        account_name: bData.expense_account,
        paid_through_account_name: bData.paid_through_account_id,
        description: bData.description,
        currency_id: bData.currency_id,
        currency_name: bData.currency_name,
        total: bData.tot_amount,
        total_formatted: commonHelper.formatRupee(bData.tot_amount),
        status: bData.status,
        status_formatted: bData.status == "active" ? "ACTIVE" : "STOPPED",
        invoice_number: bData.invoice_number,
        inclusive_exclusive: bData.inclusive_exclusive,
        base_amount: bData.base_amount,
        source_of_supply: bData.source_of_supply,
        destination_of_supply: bData.destination_of_supply,
        hsn_code: bData.hsn_code,
        sac_code: bData.sac_code,
        reverse_charge: bData.reverse_charge,
        expense_tax_percent: bData.expense_tax_percent,
        expense_tax_amount: bData.expense_tax_amount,
        expense_type: bData.expense_type,
        gst_treatment: bData.gst_treatment,
        gst_no: bData.gst_no,
        is_Billable: false,
        comments: comment,
      };
      let createRecurringExpense = await queryHelper.insertData(
        RecurringExpenseCollection,
        recurringExpenseData
      );
      await userActivityHelper(
        admin_id,
        orgId,
        bData.vendor_id,
        description,
        "Recurring expense created",
        createRecurringExpense.msg._id,
        "Recurring_Expense"
      );
      return res.status(ST_CODES.CREATED).json({
        success: true,
        message: "Recurring expense created successfully.",
        data: createRecurringExpense.msg,
      });
    } catch (error) {
      console.log("createExpense error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to expense. Please try again later.",
      });
    }
  }
  async getRecurringExpense(req, res) {
    try {
      const admin_id = res.locals.user_id;
      let {
        limit = 10,
        page = 1,
        sort_column = "created_time",
        sort_order = "D",
        filter = "Status.All",
        // customer_id = null, // Add support for customer_id filtering
        orgId,
      } = req.query;
      limit = parseInt(limit, 10);
      page = parseInt(page, 10);

      const query = {
        organization_id: orgId,
        admin_id: admin_id,
        is_deleted: false,
        // status: "active",
        // deleted_at: null,
      };

      switch (filter) {
        case "Status.Stopped":
          query.status = "stopped";
          break;
        case "Status.Expired":
          query.status = "expired";
          break;
        case "Status.Active":
          query.status = "active";
          break;
        // case "Status.All":
        // case "":
        //   // No additional filtering for 'All' or empty filter
        //   break;
        default:
          // Handle unknown filter or ignore
          break;
      }

      const allowedSortColumns = [
        "profile_name",
        "start_date",
        "createdAt",
        "account_name",
        "total",
      ];

      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;
      console.log("sort", sort);

      const projection = {
        // _id: 1,
        // customer_id: 1,
        // customer_name: 1,
        // company_name: 1,
        // status: 1,
        // status_formatted: 1,
        // order_status: 1,
        // order_status_formatted: 1,
        // invoiced_status: 1,
        // invoiced_status_formatted: 1,
        // paid_status: 1,
        // paid_status_formatted: 1,
      };
      // console.log(query, projection, sort, limit, page, "get params datas");
      // return;
      const results = await queryHelper.findData(
        RecurringExpenseCollection,
        query,
        projection,
        sort,
        limit,
        page
      );
      const recurringExpenseResult = results?.status ? results.msg : [];
      const totalCount = await queryHelper.countDocuments(
        RecurringExpenseCollection,
        query
      );
      const hasMorePage = page * limit < totalCount;

      return res.status(ST_CODES.OK).json({
        code: 0,
        message: "success",
        recurringExpense: recurringExpenseResult,
        totalCount: totalCount,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage,
          report_name: "Recurring Expense",
          applied_filter: filter,
          custom_fields: [],
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      console.log("getRecurringExpense error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to expense. Please try again later.",
      });
    }
  }
  async getIndiRecurringExpense(req, res) {
    try {
      const { org_id, recurring_expense_id } = req.query;
      if (!org_id || !recurring_expense_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Unauthorized route" });
      }
      let recurringExpenseData = await RecurringExpenseCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        recurring_expense_id: recurring_expense_id,
        is_deleted: false,
      })
        .populate("vendor_id")
        .populate("customer_id");

      if (!recurringExpenseData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Expense not found..." });
      }

      // Use a different field to find the organization - perhaps a numeric identifier
      let organizationData = await OrgCollection.findOne(
        {
          // Try various ways to match the organization
          $or: [
            { organization_number: Number(org_id) }, // If org_id is stored as a number
            { organization_code: org_id.toString() }, // If stored as string
            { organization_id: org_id }, // If there's a non-ObjectId field
          ],
        },
        {
          first_street: 1,
          second_street: 1,
          org_name: 1,
          email: 1,
          city: 1,
          country: 1,
          gst_in: 1,
          zip: 1,
          organizationName: 1,
          state: 1,
        }
      );

      if (!organizationData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Organization not found..." });
      }

      // Combine bill data with organization data
      const responseData = {
        ...recurringExpenseData.toObject(),
        organization: organizationData.toObject(),
      };

      return res
        .status(ST_CODES.OK)
        .send({ message: "Successfully fetched", data: responseData });
    } catch (error) {
      console.log("getIndiRecurringExpense error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to expense. Please try again later.",
      });
    }
  }
  
  async updateRecurringExpense(req, res) {
    try {




      const { org_id, recurring_expense_id } = req.query;
      let bData = req.body;
      let admin_id = res.locals.user_id;
      let recurringExpenseData = await RecurringExpenseCollection.findOne({
        organization_id: org_id,
        admin_id: admin_id,
        recurring_expense_id: recurring_expense_id,
      });
      if (!recurringExpenseData) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Can't find recurring expense.",
        });
      }
      // console.log(recurringExpenseData, "------recurringExpenseData");
      // return;
      // console.log(bData, "bData");
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System";
      const description = `Recurring expense updated for ${commonHelper.formatRupees(
        bData.tot_amount
      )}`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurringExpenseData.recurring_expense_id,
        description,
        "Updated", // operation_type
        "", // transaction_id
        "recurring_expense"
      );

      await userActivityHelper(
        admin_id,
        org_id,
        recurringExpenseData.vendor_id,
        description,
        "Recurring expense updated",
        recurringExpenseData._id,
        "Recurring_Expense"
      );

      let recurringExpenseUpdatedData = {
        vendor_id: bData.vendor_id,
        admin_id: admin_id,
        organization_id: org_id,
        customer_id: bData.customer_id,
        recurrence_frequency: bData.recurrence_frequency, //bData.recurrence_frequency
        recurrence_frequency_formatted: bData.recurrence_frequency_formatted, //bData.recurrence_frequency_formatted
        repeat_every: bData.repeat_every,
        start_date: bData.start_date,
        start_date_formatted: commonHelper.formatDateString(bData.start_date),
        end_date: bData.end_date,
        end_date_formatted: commonHelper.formatDateString(bData.end_date),
        last_created_date: bData.start_date,
        last_created_date_formatted: commonHelper.formatDateString(
          bData.start_date
        ),
        next_expense_date: bData.next_expense_date
          ? moment(bData.next_expense_date, "DD-MM-YYYY").toDate()
          : null,
        next_expense_date_formatted: commonHelper.formatDateString(
          bData.next_expense_date
        ),
        profile_name: bData.profile_name,
        account_name: bData.expense_account,
        paid_through_account_name: bData.paid_through_account_id,
        description: bData.description,
        currency_id: bData.currency_id,
        currency_name: bData.currency_name,
        total: bData.tot_amount,
        total_formatted: commonHelper.formatRupee(bData.tot_amount),
        status: bData.status,
        status_formatted: bData.status == "active" ? "ACTIVE" : "STOPPED",

        invoice_number: bData.invoice_number,
        inclusive_exclusive: bData.inclusive_exclusive,
        base_amount: bData.base_amount,
        source_of_supply: bData.source_of_supply,
        destination_of_supply: bData.destination_of_supply,
        hsn_code: bData.hsn_code,
        sac_code: bData.sac_code,
        reverse_charge: bData.reverse_charge,
        expense_tax_percent: bData.expense_tax_percent,
        expense_tax_amount: bData.expense_tax_amount,
        expense_type: bData.expense_type,
        gst_treatment: bData.gst_treatment,
        gst_no: bData.gst_no,
        is_Billable: false,
      };
      let updatedRecurringExpenseData =
        await RecurringExpenseCollection.findOneAndUpdate(
          {
            organization_id: org_id,
            admin_id: admin_id,
            recurring_expense_id: recurring_expense_id,
          },
          {
            $set: recurringExpenseUpdatedData,
            $push: { comments: comment },
          }
        );
      return res
        .status(ST_CODES.OK)
        .send({ message: "Recurring expense updated successfully" });
    } catch (error) {
      console.log("updateRecurringExpense error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to expense. Please try again later.",
      });
    }
  }
  async getChildRecurringExpense(req, res) {
    try {
      const { org_id, recurring_expense_id } = req.query;
      let admin_id = res.locals.user_id;
      let recurringExpenseData = await RecurringExpenseCollection.aggregate([
        {
          $match: {
            recurring_expense_id: `${recurring_expense_id}`,
            organization_id: Number(org_id),
            // admin_id: admin_id,
          },
        },
        {
          $unwind: {
            path: "$item_list",
          },
        },
        {
          $lookup: {
            from: "expenses",
            localField: "item_list.expense_id",
            foreignField: "_id",
            as: "expense_details",
          },
        },
        {
          $unwind: {
            path: "$expense_details",
          },
        },
        {
          $project: {
            _id: "$expense_details._id",
            expense_id: "$item_list.expense_id",
            expense_number: "$item_list.expense_number",
            timestamp: "$item_list.timestamp",
            date: "$expense_details.date",
            status: "$expense_details.status",
            paid_through: "$expense_details.paid_through_account_id",
            amount: "$expense_details.tot_amount",
            tax_amount: "$expense_details.expense_tax_amount",
          },
        },
      ]);
      // console.log(recurringExpenseData, "recurringExpenseData");
      if (!recurringExpenseData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Recurring expense not found..." });
      }
      return res
        .status(ST_CODES.OK)
        .send({ message: "Successfully fetched", data: recurringExpenseData });
    } catch (error) {
      console.log("getChildRecurringExpense error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to expense. Please try again later.",
      });
    }
  }
  async updateRecurringStatus(req, res) {
    try {
      const { org_id, recurring_expense_id } = req.query;
      let admin_id = res.locals.user_id;
      let bData = req.body;
      // console.log(
      //   "org_id, recurring_expense_id",
      //   org_id,
      //   recurring_expense_id,
      //   bData
      // );
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System";
      const description = `Recurring expense status has been updated as ${bData.status}`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurring_expense_id,
        description,
        "Status Updated", // operation_type
        "", // transaction_id
        "recurring_expense"
      );

      await RecurringExpenseCollection.findOneAndUpdate(
        {
          organization_id: org_id,
          admin_id: admin_id,
          recurring_expense_id: recurring_expense_id,
        },
        {
          $set: {
            status: bData.status,
            status_formatted: bData.status == "active" ? "ACTIVE" : "STOPPED",
          },
          $push: { comments: comment },
        }
      );
      return res
        .status(ST_CODES.OK)
        .send({ message: "Recurring expense updated successfully" });
    } catch (error) {
      console.log("updateRecurringStatus error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to expense. Please try again later.",
      });
    }
  }
  async deleteRecurringExpense(req, res) {
    try {
      const { org_id, recurring_expense_id } = req.query;
      let admin_id = res.locals.user_id;
      let bData = req.body;
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System";
      const description = `Recurring expense has been deleted`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurring_expense_id,
        description,
        "Status Deleted", // operation_type
        "", // transaction_id
        "recurring_expense"
      );
      await RecurringExpenseCollection.findOneAndUpdate(
        {
          organization_id: org_id,
          admin_id: admin_id,
          recurring_expense_id: recurring_expense_id,
        },
        {
          $set: {
            is_deleted: bData.is_deleted,
          },
          $push: { comments: comment },
        }
      );
      return res
        .status(ST_CODES.OK)
        .send({ message: "Recurring expense has been deleted." });
    } catch (error) {
      console.log("deleteRecurringExpense error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to expense. Please try again later.",
      });
    }
  }
}

module.exports = new RecurringExpenseController();
