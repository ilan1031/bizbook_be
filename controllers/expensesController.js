const mongoose = require("mongoose");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const ExpenseCollection = mongoose.model("Expense");
const JournalCollection = mongoose.model("Journal");

const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const userActivityHelper = require("../helpers/userActivityHelper");

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return "₹0.00";
  return `₹${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

class ExpensesController {
  async createExpense(req, res) {
    try {
      let bData = req.body;
      let orgId = req.query.org_id;
      const admin_id = res.locals.user_id;
      bData["admin_id"] = admin_id;
      bData["organization_id"] = orgId;
      if (req.file) {
        bData["document"] = req.file.filename;
      }
      let expenseUniqueId = await commonHelper.generateUniqueId(
        ExpenseCollection,
        "unique_EX_id",
        5,
        "EX"
      );
      bData["unique_EX_id"] = expenseUniqueId;

      const journalAmt =
        req.body.type == "expense"
          ? bData.tot_amount_with_tax
          : bData.tot_amount;

let Journal_line_items_expense =[]
      if(bData.type == "expense"){
        Journal_line_items_expense = [
          {
            coa_account_id: bData?.paid_through_account_id,
            coa_account_name: bData?.paid_through_account_name,
            creditOrDebit: "Credit",
            amount: bData.tot_amount_with_tax,
            amount_formatted: formatCurrency(bData.tot_amount_with_tax),
          },
          ...bData.lineItems.map((item) => ({
            coa_account_id: item.account_id,
            coa_account_name: item.account_name,
            creditOrDebit: "Debit",
            amount: item.amount || 0,
            amount_formatted: formatCurrency(item.amount),
          })),
        ];
      }

      const Journal_line_items_mileage = [
        {
          coa_account_id: bData?.paid_through_account_id,
          coa_account_name: bData?.paid_through_account_name,
          creditOrDebit: "Credit",
          amount: journalAmt,
          amount_formatted: formatCurrency(journalAmt),
        },
        {
          coa_account_id: "AC_051",
          coa_account_name: "Travel Expense",
          creditOrDebit: "Debit",
          amount: journalAmt || 0,
          amount_formatted: formatCurrency(journalAmt),
        },
      ];

      let journalUniqueId = await commonHelper.generateUniqueId(
        JournalCollection,
        "journal_id",
        5,
        "JL"
      );

      if (req.body.inclusive_exclusive === "exclusive") {
        Journal_line_items_expense.push({
          coa_account_id: "AC_011",
          coa_account_name: "Input IGST",
          creditOrDebit: "Debit",
          amount: bData.expense_tax_amount,
          amount_formatted: formatCurrency(bData.expense_tax_amount),
        });
      }

      const journalData = {
        organization_id: orgId,
        admin_id: admin_id,
        journal_id: journalUniqueId,
        journal_date: bData.date,
        journal_date_formatted: commonHelper.formatDateString(bData.date),
        total_amount: journalAmt,
        total_amount_formatted: formatCurrency(journalAmt),
        type: "Expense",
        vendor_name: bData?.vendor_Name,
        line_items:
          bData.type == "expense"
            ? Journal_line_items_expense
            : Journal_line_items_mileage,
      };

      // console.log("The Journal Data", journalData);
      bData["journal_id"] = journalUniqueId;

      const savedJournal = await JournalCollection.create(journalData);

      let createExpense = await queryHelper.insertData(
        ExpenseCollection,
        bData
      );
      await userActivityHelper(
        admin_id,
        orgId,
        bData.vendor_id,
        `Expense created for ₹${bData.tot_amount}`,
        "Expense created",
        createExpense.msg._id,
        "Expense"
      );

      console.log("The Data saved for the Expense", bData);

      return res.status(ST_CODES.CREATED).json({
        success: true,
        message: "Expense created successfully.",
        data: createExpense.msg,
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

  async getExpense(req, res) {
    try {
      let { org_id, filter = "", sort_column, sort_order } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      if (!org_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required field: org_id is mandatory.",
        });
      }

      // Create filter object
      const query = {
        admin_id: res.locals.user_id,
        organization_id: org_id,
        is_deleted: { $ne: true }, // Exclude deleted expenses
      };

      switch (filter) {
        case "Status.Nonbillable":
          query.status_text = "NON-BILLABLE";
          break;
        case "Status.Unbilled":
          query.status_text = "UNBILLED";
          break;
        case "Status.Invoiced":
          query.status_text = "INVOICED";
          break;
        case "Status.Reimbursed":
          query.status_text = "REIMBURSED";
          break;
        case "Status.Withreceipts":
          query.status_text = "WITHRECEIPTS";
          break;
        case "Status.Withoutreceipts":
          query.status_text = "WITHOUTRECEIPTS";
          break;
        case "Status.All":
        default:
          break;
      }

      // Apply any additional filters from query params
      const additionalFilters = ["vendor_id", "customer_id", "status", "type"];

      additionalFilters.forEach((field) => {
        if (req.query[field] !== undefined) {
          filter[field] = req.query[field];
        }
      });

      // Add date range filter if provided
      if (req.query.start_date && req.query.end_date) {
        filter.date = {
          $gte: new Date(req.query.start_date),
          $lte: new Date(req.query.end_date),
        };
      }

      // Get total count for pagination
      const totalCount = await ExpenseCollection.countDocuments(query);

      //sort function
      const allowedSortColumns = [
        "customer_name",
        "vendor_name",
        "date",
        "createdAt",
        "invoice_number",
        "paid_through_account_id",
        "tot_amount",
      ];

      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      // Get expenses with pagination using queryHelper
      const results = await queryHelper.findDataWithPopulate(
        ExpenseCollection,
        query,
        {},
        {},
        limit,
        page,
        ["vendor_id", "customer_id"]
      );

      // Check if results or results.msg is undefined or not an array
      if (!results || !results.msg || !Array.isArray(results.msg)) {
        return res.status(ST_CODES.OK).send({
          status: true,
          data: [],
          pagination: {
            totalCount: 0,
            totalPages: 0,
            currentPage: page,
            hasNextPage: false,
            hasPrevPage: false,
          },
          message: "No expenses found",
        });
      }

      // Post-sort if sort_column is 'contact_name'
      if (sort_column === "vendor_name") {
        results.msg.sort((a, b) => {
          const nameA = a.vendor_id?.contact_name?.toLowerCase() || "";
          const nameB = b.vendor_id?.contact_name?.toLowerCase() || "";
          return sort_order === "A"
            ? nameA.localeCompare(nameB)
            : nameB.localeCompare(nameA);
        });
      } else if (sort_column === "customer_name") {
        results.msg.sort((a, b) => {
          const nameA = a.customer_id?.contact_name?.toLowerCase() || "";
          const nameB = b.customer_id?.contact_name?.toLowerCase() || "";
          return sort_order === "A"
            ? nameA.localeCompare(nameB)
            : nameB.localeCompare(nameA);
        });
      } else {
        // Otherwise sort normally
        results.msg.sort((a, b) => {
          const valA = a[sort_column];
          const valB = b[sort_column];
          if (valA == null) return 1;
          if (valB == null) return -1;
          return sort_order === "A"
            ? valA > valB
              ? 1
              : -1
            : valA < valB
            ? 1
            : -1;
        });
      }

      // Map status codes to descriptive strings
      const statusMap = {
        0: "NON-BILLABLE",
        1: "UNBILLED",
        2: "INVOICED",
        3: "REIMBURSED",
      };

      // Format the results to include formatted date, vendor name, client name, and status text
      const formattedResults = results.msg.map((expense) => {
        // Format the date
        const formattedDate = expense.date
          ? new Date(expense.date).toLocaleDateString("en-GB")
          : "";

        // Get vendor name
        let vendorName = "";
        if (expense.vendor_id) {
          if (
            typeof expense.vendor_id === "object" &&
            expense.vendor_id !== null
          ) {
            vendorName =
              expense.vendor_id.contact_name || expense.vendor_id.name || "";
          } else {
            vendorName = expense.vendor_id.toString();
          }
        }

        // Get client/customer name
        let clientName = "";
        if (expense.customer_id) {
          if (
            typeof expense.customer_id === "object" &&
            expense.customer_id !== null
          ) {
            clientName =
              expense.customer_id.contact_name ||
              expense.customer_id.name ||
              "";
          } else {
            clientName = expense.customer_id.toString();
          }
        }

        // Get status text based on status code
        const statusText = statusMap[expense.status] || "Unknown";
        const formattedAmount = formatCurrency(expense.tot_amount);

        // Extract account information from lineItems if they exist
        let accountName = "";
        if (
          expense.lineItems &&
          Array.isArray(expense.lineItems) &&
          expense.lineItems.length > 0
        ) {
          const firstLineItem = expense.lineItems[0];

          if (expense.type === "mileage") {
            accountName = "Mileage Expenses ⏲";
          } else {
            accountName = firstLineItem.account_id || "Other Expenses";
          }
        }

        // Return the enhanced expense object with account_name from lineItems
        return {
          ...expense._doc,
          date: formattedDate,
          vendor_name: vendorName,
          customer_name: clientName,
          status_text: statusText,
          tot_amount: formattedAmount,
          amount: expense.tot_amount,
          account_name: accountName || "Fuel/Mileage Expenses ⏲",
        };
      });

      // Prepare pagination info
      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return res.status(ST_CODES.OK).send({
        status: results.status || true,
        data: formattedResults,
        pagination: {
          totalCount,
          totalPages,
          currentPage: page,
          hasNextPage,
          hasPrevPage,
        },
        message: "Successfully fetched",
      });
    } catch (error) {
      console.error("getExpense Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          error.message || "Something went wrong while retrieving expenses",
      });
    }
  }

  async getIndividualExpense(req, res) {
    try {
      const { org_id, expense_id } = req.query;
      if (!org_id || !expense_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Unauthorized route" });
      }
      let expenseData = await ExpenseCollection.findOne({
        admin_id: res.locals.user_id,
        unique_EX_id: expense_id,
        organization_id: org_id,
      })
        .populate("vendor_id")
        .populate("customer_id");
      if (!expenseData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Expense not found..." });
      }
      return res
        .status(ST_CODES.OK)
        .send({ message: "Successfully fetched", data: expenseData });
    } catch (error) {
      console.log("getIndividualExpense error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to expense. Please try again later.",
      });
    }
  }

  async updateExpense(req, res) {
    try {
      let bData = req.body;
      let { orgId, expense_id } = req.query;

      if (!orgId || !expense_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Organization ID and expense ID are required" });
      }

      const journalAmt =
        req.body.type == "expense"
          ? bData.tot_amount_with_tax
          : bData.tot_amount;

let Journal_line_items_expense =[]
      if(bData.type == "expense"){
      Journal_line_items_expense = [
        {
          coa_account_id: bData.paid_through_account_id,
          coa_account_name: bData.paid_through_account_name,
          creditOrDebit: "Credit",
          amount: bData.tot_amount_with_tax,
          amount_formatted: formatCurrency(bData.tot_amount_with_tax),
        },
        ...bData.lineItems.map((item) => ({
          coa_account_id: item.account_id,
          coa_account_name: item.account_name,
          creditOrDebit: "Debit",
          amount: item.amount || 0,
          amount_formatted: formatCurrency(item.amount),
        })),
      ];}

      if (req.body.inclusive_exclusive === "exclusive") {
        Journal_line_items_expense.push({
          coa_account_id: "AC_011",
          coa_account_name: "Input IGST",
          creditOrDebit: "Debit",
          amount: bData.expense_tax_amount,
          amount_formatted: formatCurrency(bData.expense_tax_amount),
        });
      }

      const Journal_line_items_mileage = [
        {
          coa_account_id: bData?.paid_through_account_id,
          coa_account_name: bData?.paid_through_account_name,
          creditOrDebit: "Credit",
          amount: journalAmt,
          amount_formatted: formatCurrency(journalAmt),
        },
        {
          coa_account_id: "AC_051",
          coa_account_name: "Travel Expense",
          creditOrDebit: "Debit",
          amount: journalAmt || 0,
          amount_formatted: formatCurrency(journalAmt),
        },
      ];

      const updatedJournal = {
        total_amount: journalAmt,
        total_amount_formatted: formatCurrency(journalAmt),
        vendor_name: bData.vendor_Name,
        line_items:
          bData.type == "expense"
            ? Journal_line_items_expense
            : Journal_line_items_mileage,
      };

      const updateJournal = await JournalCollection.findOneAndUpdate(
        { journal_id: bData.journal_id },
        { $set: updatedJournal },
        { new: true, runValidators: true }
      );

      // console.log(bData, "------expense");
      // return;
      const updatedExpense = await ExpenseCollection.findOneAndUpdate(
        {
          admin_id: res.locals.user_id,
          unique_EX_id: expense_id,
          organization_id: orgId,
        },
        {
          $set: bData,
        }
      );

      if (!updatedExpense) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Expense not found for update" });
      }

      return res.status(ST_CODES.OK).json({
        success: true,
        message: "Expense updated successfully",
        data: updatedExpense,
      });
    } catch (error) {
      console.log("Error in Expense Update", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to update expense. Please try again later.",
      });
    }
  }
  async deleteExpense(req, res) {
    try {
      let { org_id, expense_id, journal_id } = req.query;

      if (!journal_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "The Journal ID is required for delete expense." });
      }

      const deleteExpense = await ExpenseCollection.findOneAndDelete({
        admin_id: res.locals.user_id,
        unique_EX_id: expense_id,
        organization_id: org_id,
      });

      const deleteJournal = await JournalCollection.findOneAndDelete({
        journal_id: journal_id,
      });

      if (!deleteExpense) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Expense not found for update" });
      }

      return res.status(ST_CODES.OK).json({
        success: true,
        message: "Expense delete successfully",
        data: deleteExpense,
      });
    } catch (error) {
      console.log("Error in Expense delete", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to delete expense. Please try again later.",
      });
    }
  }
}

module.exports = new ExpensesController();
