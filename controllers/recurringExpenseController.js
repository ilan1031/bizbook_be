const mongoose = require("mongoose");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const ExpenseCollection = mongoose.model("Expense");
const RecurringExpenseCollection = mongoose.model("Recurring_Expense");
const JournalCollection = mongoose.model("Journal");
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
    const session = await mongoose.startSession();
    try {
      const formatCurrency = (amount) => {
        return `₹${amount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      };

      let bData = req.body;
      let orgId = req.query.org_id;
      const admin_id = res.locals.user_id;

      console.log("Processing Recurring Expense Creation...");
      console.log("Request data:", bData);

      // Validate required parameters
      if (!orgId || !bData || Object.keys(bData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and expense data are mandatory.",
        });
      }

      await session.startTransaction();

      try {
        // Generate unique IDs
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

        // Generate unique Journal ID
        let journalUniqueId = await commonHelper.generateUniqueId(
          JournalCollection,
          "journal_id",
          5,
          "JL"
        );

        // Calculate journal amount based on expense type
        const journalAmt =
          bData.type == "expense"
            ? bData.tot_amount_with_tax
            : bData.tot_amount;

        // Create Journal Line Items based on expense type (following expense controller pattern)
        let Journal_line_items_expense = [];

        if (bData.type == "expense") {
          Journal_line_items_expense = [
            {
              coa_account_id: bData?.paid_through_account_id,
              coa_account_name:
                bData?.paid_through_account_name || "Cash/Bank Account",
              creditOrDebit: "Credit",
              amount: bData.tot_amount_with_tax,
              amount_formatted: formatCurrency(bData.tot_amount_with_tax),
            },
            // Add line items as debits
            {
              coa_account_id:
                bData.account_name || bData.account_id || "AC_078",
              coa_account_name: bData.expense_account || "General Expense",
              creditOrDebit: "Debit",
              amount: bData.amount || bData.tot_amount || 0,
              amount_formatted: formatCurrency(
                bData.amount || bData.tot_amount || 0
              ),
            },
          ];
        }

        // Journal line items for mileage type
        const Journal_line_items_mileage = [
          {
            coa_account_id: bData?.paid_through_account_id,
            coa_account_name:
              bData?.paid_through_account_name || "Cash/Bank Account",
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

        // Add tax entry if exclusive and has tax
        if (
          bData.inclusive_exclusive === "exclusive" &&
          bData.expense_tax_amount > 0
        ) {
          Journal_line_items_expense.push({
            coa_account_id: "AC_011",
            coa_account_name: "Input IGST",
            creditOrDebit: "Debit",
            amount: bData.expense_tax_amount,
            amount_formatted: formatCurrency(bData.expense_tax_amount),
          });
        }

        // Create journal data
        const journalData = {
          organization_id: orgId,
          admin_id: admin_id,
          journal_id: journalUniqueId,
          journal_date: bData.start_date,
          journal_date_formatted: commonHelper.formatDateString(
            bData.start_date
          ),
          total_amount: journalAmt,
          total_amount_formatted: formatCurrency(journalAmt),
          type: "Recurring Expense",
          vendor_name: bData?.vendor_Name || bData?.vendor_name || "",
          line_items:
            bData.type == "expense"
              ? Journal_line_items_expense
              : Journal_line_items_mileage,
        };

        console.log("The Journal Data for Recurring Expense:", journalData);

        // Save journal entry within transaction
        const savedJournal = await JournalCollection.create([journalData], {
          session,
        });

        // Prepare expense data
        let expenseData = {
          vendor_id: bData.vendor_id,
          admin_id: admin_id,
          organization_id: orgId,
          unique_EX_id: expenseUniqueId,
          journal_id: journalUniqueId, // Link to journal entry
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
          type: bData.type || "expense",
          status: 0,
          is_Billable: false,
        };

        // Create expense within transaction
        let createExpense = await ExpenseCollection.create([expenseData], {
          session,
        });

        if (!createExpense || createExpense.length === 0) {
          throw new Error("Failed to create expense");
        }

        let nextDate =
          bData.end_date == "" ? bData.next_expense_date : bData.end_date;

        // Create comment for recurring expense
        const commented_by_id = res.locals.user_id || "";
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
          "Added",
          "",
          "recurring_expense"
        );

        // Prepare recurring expense data
        let recurringExpenseData = {
          vendor_id: bData.vendor_id,
          admin_id: admin_id,
          organization_id: orgId,
          unique_EX_id: expenseUniqueId,
          customer_id: bData.customer_id,
          recurring_expense_id: recurringExpenseUniqueId,
          journal_id: journalUniqueId, // Link to journal entry
          item_list: [
            {
              expense_id: createExpense[0]._id,
              expense_number: expenseUniqueId,
            },
          ],
          recurrence_frequency: bData.recurrence_frequency,
          recurrence_frequency_formatted: bData.recurrence_frequency_formatted,
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

        // Create recurring expense within transaction
        let createRecurringExpense = await RecurringExpenseCollection.create(
          [recurringExpenseData],
          { session }
        );

        if (!createRecurringExpense || createRecurringExpense.length === 0) {
          throw new Error("Failed to create recurring expense");
        }

        // Log user activity within transaction
        try {
          await userActivityHelper(
            admin_id,
            orgId,
            bData.vendor_id,
            description,
            "Recurring expense created",
            createRecurringExpense[0]._id,
            "Recurring_Expense",
            session // Pass session if supported
          );
        } catch (error) {
          console.error("Failed to log user activity:", error.message);
          // Don't fail the entire transaction if activity logging fails
        }

        // If everything is successful, commit the transaction
        await session.commitTransaction();

        console.log("Recurring expense creation completed successfully");

        return res.status(ST_CODES.CREATED).json({
          success: true,
          message: "Recurring expense and journal entry created successfully.",
          data: {
            recurring_expense: createRecurringExpense[0],
            expense: createExpense[0],
            journal: savedJournal[0],
          },
        });
      } catch (transactionError) {
        // Rollback transaction on any error
        await session.abortTransaction();
        console.error(
          "Transaction rolled back due to error:",
          transactionError.message
        );

        // Handle specific error types
        if (transactionError.message === "Failed to create expense") {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "Failed to create expense. Please check your data.",
          });
        }

        if (transactionError.message === "Failed to create recurring expense") {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message:
              "Failed to create recurring expense. Please check your data.",
          });
        }

        // Generic transaction error
        return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Transaction failed and was rolled back. Please try again.",
          error: transactionError.message,
        });
      }
    } catch (error) {
      console.error("createRecurringExpense error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to create recurring expense. Please try again later.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } finally {
      // Always end the session
      await session.endSession();
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
  async updateRecurringExpense(req, res) {
    const session = await mongoose.startSession();
    try {
      const formatCurrency = (amount) => {
        // Ensure amount is a number before formatting
        const numAmount = parseFloat(amount) || 0;
        return `₹${numAmount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      };

      // Helper function to safely convert to number
      const toNumber = (value) => {
        if (value === null || value === undefined || value === '') return 0;
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
      };

      const { org_id, recurring_expense_id } = req.query;
      let bData = req.body;
      let admin_id = res.locals.user_id;

      console.log(
        "Update request received for recurring_expense_id:",
        recurring_expense_id
      );
      console.log("Organization ID:", org_id);
      console.log("Request body:", bData);

      if (!org_id || !recurring_expense_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: org_id and recurring_expense_id are mandatory.",
        });
      }

      await session.startTransaction();

      try {
        // Step 1: Find existing recurring expense with journal_id
        let recurringExpenseData = await RecurringExpenseCollection.findOne(
          {
            organization_id: org_id,
            admin_id: admin_id,
            recurring_expense_id: recurring_expense_id,
          },
          null,
          { session }
        );

        if (!recurringExpenseData) {
          throw new Error("Recurring expense not found");
        }

        console.log(
          "Found recurring expense:",
          recurringExpenseData.recurring_expense_id
        );
        console.log("Associated journal_id:", recurringExpenseData.journal_id);

        // Step 2: Check if any financial fields have changed to determine if journal needs updating
        let shouldUpdateJournal = false;

        const financialFields = [
          "tot_amount",
          "tot_amount_with_tax",
          "expense_tax_amount",
          "paid_through_account_id",
          "account_name",
          "expense_account",
          "vendor_id",
          "vendor_name",
          "expense_type",
          "inclusive_exclusive",
          "amount",
          "description",
          "start_date",
          "type",
        ];

        for (const field of financialFields) {
          if (
            bData.hasOwnProperty(field) &&
            bData[field] !== recurringExpenseData[field]
          ) {
            shouldUpdateJournal = true;
            console.log(
              `Field ${field} changed from ${recurringExpenseData[field]} to ${bData[field]}, will update journal`
            );
            break;
          }
        }

        // Step 3: Update journal entries if there's a journal_id and financial data has changed
        if (recurringExpenseData.journal_id && shouldUpdateJournal) {
          console.log(
            "Updating journal entries for journal_id:",
            recurringExpenseData.journal_id
          );

          // Calculate journal amount based on expense type - CONVERT TO NUMBERS
          const expenseType = bData.type || recurringExpenseData.type || "expense";
          
          // Convert all amounts to proper numbers
          const baseAmount = toNumber(
            bData.tot_amount || 
            bData.amount || 
            recurringExpenseData.total || 
            recurringExpenseData.tot_amount
          );
          
          const taxAmount = toNumber(
            bData.expense_tax_amount ||
            recurringExpenseData.expense_tax_amount
          );
          
          const inclusiveExclusive =
            bData.inclusive_exclusive ||
            recurringExpenseData.inclusive_exclusive ||
            "inclusive";

          console.log("baseAmount (converted to number):", baseAmount, "type:", typeof baseAmount);
          console.log("taxAmount (converted to number):", taxAmount, "type:", typeof taxAmount);
          console.log("inclusiveExclusive:", inclusiveExclusive);

          let journalAmt = baseAmount;

          if (expenseType === "expense") {
            // Try to get tot_amount_with_tax first, then calculate
            const totAmountWithTax = toNumber(
              bData.tot_amount_with_tax ||
              recurringExpenseData.tot_amount_with_tax
            );
            
            if (totAmountWithTax > 0) {
              journalAmt = totAmountWithTax;
            } else {
              journalAmt = baseAmount;
              if (inclusiveExclusive === "exclusive") {
                // Proper mathematical addition, not string concatenation
                journalAmt = baseAmount + taxAmount;
              }
            }
          }

          console.log("Final journalAmt:", journalAmt, "type:", typeof journalAmt);

          // Validate that journalAmt is a valid number
          if (isNaN(journalAmt) || journalAmt < 0) {
            throw new Error(`Invalid journal amount calculated: ${journalAmt}`);
          }

          // Create updated Journal Line Items
          let journalLineItems = [];

          if (expenseType === "expense") {
            // Credit entry - Cash/Bank Account (Money going out)
            journalLineItems.push({
              coa_account_id:
                bData.paid_through_account_id ||
                recurringExpenseData.paid_through_account_id ||
                "AC_001",
              coa_account_name:
                bData.paid_through_account_name ||
                recurringExpenseData.paid_through_account_name ||
                "Cash/Bank Account",
              creditOrDebit: "Credit",
              amount: journalAmt,
              amount_formatted: formatCurrency(journalAmt),
            });

            // Debit entry - Expense Account
            journalLineItems.push({
              coa_account_id:
                bData.account_name ||
                recurringExpenseData.account_name ||
                "AC_078",
              coa_account_name:
                bData.expense_account ||
                recurringExpenseData.expense_account ||
                "General Expense",
              creditOrDebit: "Debit",
              amount: baseAmount,
              amount_formatted: formatCurrency(baseAmount),
            });

            // Add tax entry if exclusive and has tax
            if (inclusiveExclusive === "exclusive" && taxAmount > 0) {
              journalLineItems.push({
                coa_account_id: "AC_011",
                coa_account_name: "Input IGST",
                creditOrDebit: "Debit",
                amount: taxAmount,
                amount_formatted: formatCurrency(taxAmount),
              });
            }
          } else {
            // Journal line items for mileage type
            journalLineItems = [
              {
                coa_account_id:
                  bData.paid_through_account_id ||
                  recurringExpenseData.paid_through_account_id ||
                  "AC_001",
                coa_account_name:
                  bData.paid_through_account_name ||
                  recurringExpenseData.paid_through_account_name ||
                  "Cash/Bank Account",
                creditOrDebit: "Credit",
                amount: journalAmt,
                amount_formatted: formatCurrency(journalAmt),
              },
              {
                coa_account_id: "AC_051",
                coa_account_name: "Travel Expense",
                creditOrDebit: "Debit",
                amount: journalAmt,
                amount_formatted: formatCurrency(journalAmt),
              },
            ];
          }

          // Get vendor name properly
          let vendor_name = "";
          if (bData.vendor_name) {
            vendor_name = bData.vendor_name;
          } else if (bData.vendor_Name) {
            vendor_name = bData.vendor_Name;
          } else if (recurringExpenseData.vendor_name) {
            vendor_name = recurringExpenseData.vendor_name;
          } else {
            vendor_name = "Unknown Vendor";
          }

          // Prepare journal update data
          const updatedJournalData = {
            journal_date: bData.start_date || recurringExpenseData.start_date,
            journal_date_formatted: commonHelper.formatDateString(
              bData.start_date || recurringExpenseData.start_date
            ),
            total_amount: journalAmt,
            total_amount_formatted: formatCurrency(journalAmt),
            vendor_name: vendor_name,
            description:
              bData.description ||
              recurringExpenseData.description ||
              `Recurring expense - ${vendor_name}`,
            line_items: journalLineItems,
            updated_at: new Date(),
            last_modified_by: admin_id,
            modification_reason: "Recurring expense update",
          };

          console.log(
            "Updating Journal Data for journal_id:",
            recurringExpenseData.journal_id
          );
          console.log(
            "Journal update data:",
            JSON.stringify(updatedJournalData, null, 2)
          );

          // Step 4: Update the journal entry using the journal_id from recurring expense
          const updatedJournal = await JournalCollection.findOneAndUpdate(
            {
              journal_id: recurringExpenseData.journal_id,
              organization_id: org_id,
            },
            { $set: updatedJournalData },
            { session, new: true, runValidators: true }
          );

          if (updatedJournal) {
            console.log(
              "Journal entry updated successfully for journal_id:",
              recurringExpenseData.journal_id
            );
          } else {
            console.warn(
              "Journal entry not found for journal_id:",
              recurringExpenseData.journal_id
            );
            // Don't throw error here, as the journal might have been deleted separately
            // Just log the warning and continue with recurring expense update
          }
        } else if (!recurringExpenseData.journal_id) {
          console.log(
            "No journal_id found in recurring expense, skipping journal update"
          );
        } else {
          console.log("No financial changes detected, skipping journal update");
        }

        // Step 5: Create comment for update
        const commented_by_id = res.locals.user_id || "";
        const commented_by = res.user?.company_name || "System";
        const finalAmount = toNumber(
          bData.tot_amount || bData.amount || recurringExpenseData.total
        );
        const description = `Recurring expense updated for ${commonHelper.formatRupees(finalAmount)}`;

        const comment = createComments(
          commented_by,
          commented_by_id,
          "system",
          recurringExpenseData.recurring_expense_id,
          description,
          "Updated",
          "",
          "recurring_expense"
        );

        // Step 6: Prepare updated recurring expense data - Convert amounts to numbers
        let recurringExpenseUpdatedData = {
          vendor_id: bData.vendor_id || recurringExpenseData.vendor_id,
          vendor_name:
            bData.vendor_name ||
            bData.vendor_Name ||
            recurringExpenseData.vendor_name,
          admin_id: admin_id,
          organization_id: org_id,
          customer_id: bData.customer_id || recurringExpenseData.customer_id,
          recurrence_frequency:
            bData.recurrence_frequency ||
            recurringExpenseData.recurrence_frequency,
          recurrence_frequency_formatted:
            bData.recurrence_frequency_formatted ||
            recurringExpenseData.recurrence_frequency_formatted,
          repeat_every: bData.repeat_every || recurringExpenseData.repeat_every,
          start_date: bData.start_date || recurringExpenseData.start_date,
          start_date_formatted: commonHelper.formatDateString(
            bData.start_date || recurringExpenseData.start_date
          ),
          end_date:
            bData.end_date !== undefined
              ? bData.end_date
              : recurringExpenseData.end_date,
          end_date_formatted: bData.end_date
            ? commonHelper.formatDateString(bData.end_date)
            : recurringExpenseData.end_date_formatted,
          last_created_date:
            bData.start_date || recurringExpenseData.last_created_date,
          last_created_date_formatted: commonHelper.formatDateString(
            bData.start_date || recurringExpenseData.last_created_date
          ),
          next_expense_date: bData.next_expense_date
            ? moment(bData.next_expense_date, "DD-MM-YYYY").toDate()
            : recurringExpenseData.next_expense_date,
          next_expense_date_formatted: commonHelper.formatDateString(
            bData.next_expense_date || recurringExpenseData.next_expense_date
          ),
          profile_name: bData.profile_name || recurringExpenseData.profile_name,
          account_name:
            bData.expense_account ||
            bData.account_name ||
            recurringExpenseData.account_name,
          expense_account:
            bData.expense_account || recurringExpenseData.expense_account,
          paid_through_account_id:
            bData.paid_through_account_id ||
            recurringExpenseData.paid_through_account_id,
          paid_through_account_name:
            bData.paid_through_account_name ||
            recurringExpenseData.paid_through_account_name,
          description: bData.description || recurringExpenseData.description,
          currency_id: bData.currency_id || recurringExpenseData.currency_id,
          currency_name:
            bData.currency_name || recurringExpenseData.currency_name,
          
          // Convert all amount fields to proper numbers
          total: toNumber(bData.tot_amount || bData.amount || recurringExpenseData.total),
          tot_amount: toNumber(bData.tot_amount || bData.amount || recurringExpenseData.tot_amount),
          tot_amount_with_tax: toNumber(bData.tot_amount_with_tax || recurringExpenseData.tot_amount_with_tax),
          base_amount: toNumber(bData.base_amount || recurringExpenseData.base_amount),
          amount: toNumber(bData.amount || recurringExpenseData.amount),
          expense_tax_amount: toNumber(bData.expense_tax_amount || recurringExpenseData.expense_tax_amount),
          expense_tax_percent: toNumber(bData.expense_tax_percent || recurringExpenseData.expense_tax_percent),
          
          total_formatted: commonHelper.formatRupee(
            toNumber(bData.tot_amount || bData.amount || recurringExpenseData.total)
          ),
          status: bData.status || recurringExpenseData.status,
          status_formatted:
            (bData.status || recurringExpenseData.status) == "active"
              ? "ACTIVE"
              : "STOPPED",
          invoice_number:
            bData.invoice_number || recurringExpenseData.invoice_number,
          inclusive_exclusive:
            bData.inclusive_exclusive ||
            recurringExpenseData.inclusive_exclusive,
          source_of_supply:
            bData.source_of_supply || recurringExpenseData.source_of_supply,
          destination_of_supply:
            bData.destination_of_supply ||
            recurringExpenseData.destination_of_supply,
          hsn_code: bData.hsn_code || recurringExpenseData.hsn_code,
          sac_code: bData.sac_code || recurringExpenseData.sac_code,
          reverse_charge:
            bData.reverse_charge !== undefined
              ? bData.reverse_charge
              : recurringExpenseData.reverse_charge,
          expense_type: bData.expense_type || recurringExpenseData.expense_type,
          type: bData.type || recurringExpenseData.type,
          gst_treatment:
            bData.gst_treatment || recurringExpenseData.gst_treatment,
          gst_no: bData.gst_no || recurringExpenseData.gst_no,
          is_Billable:
            bData.is_Billable !== undefined
              ? bData.is_Billable
              : recurringExpenseData.is_Billable || false,
          updated_at: new Date(),
          // Keep the existing journal_id - very important!
          journal_id: recurringExpenseData.journal_id,
        };

        // Step 7: Update recurring expense within transaction
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
            },
            { session, new: true, runValidators: true }
          );

        if (!updatedRecurringExpenseData) {
          throw new Error("Failed to update recurring expense");
        }

        console.log("Recurring expense updated successfully");

        // Step 8: Log user activity within transaction
        try {
          await userActivityHelper(
            admin_id,
            org_id,
            recurringExpenseData.vendor_id,
            description,
            "Recurring expense updated",
            recurringExpenseData._id,
            "Recurring_Expense",
            session // Pass session if supported
          );
        } catch (error) {
          console.error("Failed to log user activity:", error.message);
          // Don't fail the entire transaction if activity logging fails
        }

        // Step 9: If everything is successful, commit the transaction
        await session.commitTransaction();

        console.log("Recurring expense update completed successfully");

        return res.status(ST_CODES.OK).json({
          success: true,
          message:
            "Recurring expense and associated journal entries have been updated successfully.",
          data: {
            ...updatedRecurringExpenseData.toObject(),
            journal_updated:
              shouldUpdateJournal && recurringExpenseData.journal_id
                ? true
                : false,
          },
        });
      } catch (transactionError) {
        // Rollback transaction on any error
        await session.abortTransaction();
        console.error(
          "Transaction rolled back due to error:",
          transactionError.message
        );

        // Handle specific error types
        if (transactionError.message === "Recurring expense not found") {
          return res.status(ST_CODES.NOT_FOUND).json({
            success: false,
            message:
              "Recurring expense not found. Please check the recurring_expense_id.",
          });
        }

        if (transactionError.message === "Failed to update recurring expense") {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message:
              "Failed to update recurring expense. Please check your data and try again.",
          });
        }

        // Generic transaction error
        return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Transaction failed and was rolled back. Please try again.",
          error:
            process.env.NODE_ENV === "development"
              ? transactionError.message
              : "An error occurred during the update process.",
        });
      }
    } catch (error) {
      console.error("updateRecurringExpense error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to update recurring expense. Please try again later.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } finally {
      // Always end the session
      await session.endSession();
    }
  }
  async deleteRecurringExpense(req, res) {
  const session = await mongoose.startSession();
  try {
    const { org_id, recurring_expense_id } = req.query;
    let admin_id = res.locals.user_id;
    let bData = req.body;

    console.log("Delete request received for recurring_expense_id:", recurring_expense_id);
    console.log("Organization ID:", org_id);
    console.log("Request body:", bData);

    if (!org_id || !recurring_expense_id) {
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Missing required parameters: org_id and recurring_expense_id are mandatory.",
      });
    }

    await session.startTransaction();

    try {
      // Step 1: Find the recurring expense to get the journal_id
      const recurringExpenseData = await RecurringExpenseCollection.findOne(
        {
          organization_id: org_id,
          admin_id: admin_id,
          recurring_expense_id: recurring_expense_id,
        },
        null,
        { session }
      );

      if (!recurringExpenseData) {
        throw new Error("Recurring expense not found");
      }

      console.log("Found recurring expense:", recurringExpenseData.recurring_expense_id);
      console.log("Associated journal_id:", recurringExpenseData.journal_id);

      // Step 2: Delete or mark as deleted the associated journal entry if it exists
      let journalDeletionSuccess = false;
      
      if (recurringExpenseData.journal_id) {
        console.log("Deleting associated journal entry with journal_id:", recurringExpenseData.journal_id);

        try {
          // Option 1: Soft delete the journal (mark as deleted)
          // const journalUpdateResult = await JournalCollection.findOneAndUpdate(
          //   {
          //     journal_id: recurringExpenseData.journal_id,
          //     organization_id: org_id,
          //   },
          //   {
          //     $set: {
          //       is_deleted: true,
          //       deleted_at: new Date(),
          //       deleted_by: admin_id,
          //       deletion_reason: "Associated recurring expense deleted",
          //     },
          //   },
          //   { session, new: true }
          // );

          // Option 2: Hard delete the journal
          const journalDeleteResult = await JournalCollection.findOneAndDelete(
            {
              journal_id: recurringExpenseData.journal_id,
              organization_id: org_id,
            },
            { session }
          );

          if (journalDeleteResult) {
            console.log("Journal entry deleted successfully");
            journalDeletionSuccess = true;
          } else {
            console.warn("Journal entry not found for journal_id:", recurringExpenseData.journal_id);
            // Don't throw error here, continue with recurring expense deletion
          }
        } catch (journalError) {
          console.error("Error deleting journal entry:", journalError.message);
          // You can choose to continue or throw error based on your business logic
          // For now, we'll continue with the recurring expense deletion
        }
      } else {
        console.log("No journal_id found, skipping journal deletion");
      }

      // Step 3: Create comment for deletion
      const commented_by_id = res.locals.user_id || "";
      const commented_by = res.user?.company_name || "System";
      const description = `Recurring expense has been deleted${
        journalDeletionSuccess ? " (including associated journal entry)" : ""
      }`;

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

      // Step 4: Delete or mark as deleted the recurring expense
      let deletionResult;

      if (bData.hard_delete === true) {
        // Hard delete - completely remove from database
        deletionResult = await RecurringExpenseCollection.findOneAndDelete(
          {
            organization_id: org_id,
            admin_id: admin_id,
            recurring_expense_id: recurring_expense_id,
          },
          { session }
        );
      } else {
        // Soft delete - mark as deleted (default behavior)
        deletionResult = await RecurringExpenseCollection.findOneAndUpdate(
          {
            organization_id: org_id,
            admin_id: admin_id,
            recurring_expense_id: recurring_expense_id,
          },
          {
            $set: {
              is_deleted: bData.is_deleted !== undefined ? bData.is_deleted : true,
              deleted_at: new Date(),
              deleted_by: admin_id,
            },
            $push: { comments: comment },
          },
          { session, new: true }
        );
      }

      if (!deletionResult) {
        throw new Error("Failed to delete recurring expense");
      }

      console.log("Recurring expense deletion completed successfully");

      // Step 5: Log user activity within transaction
      try {
        await userActivityHelper(
          admin_id,
          org_id,
          recurringExpenseData.vendor_id,
          description,
          "Recurring expense deleted",
          recurringExpenseData._id,
          "Recurring_Expense",
          session // Pass session if supported
        );
      } catch (error) {
        console.error("Failed to log user activity:", error.message);
        // Don't fail the entire transaction if activity logging fails
      }

      // Step 6: Commit the transaction
      await session.commitTransaction();

      return res.status(ST_CODES.OK).json({
        success: true,
        message: `Recurring expense${
          journalDeletionSuccess ? " and associated journal entry" : ""
        } has been deleted successfully.`,
        data: {
          recurring_expense_id: recurring_expense_id,
          journal_deleted: journalDeletionSuccess,
          deletion_type: bData.hard_delete === true ? "hard_delete" : "soft_delete",
        },
      });

    } catch (transactionError) {
      // Rollback transaction on any error
      await session.abortTransaction();
      console.error("Transaction rolled back due to error:", transactionError.message);

      // Handle specific error types
      if (transactionError.message === "Recurring expense not found") {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Recurring expense not found. Please check the recurring_expense_id.",
        });
      }

      if (transactionError.message === "Failed to delete recurring expense") {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to delete recurring expense. Please try again.",
        });
      }

      // Generic transaction error
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Transaction failed and was rolled back. Please try again.",
        error: process.env.NODE_ENV === "development" ? transactionError.message : "An error occurred during the deletion process.",
      });
    }

  } catch (error) {
    console.error("deleteRecurringExpense error:", error);
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal Server Error: Unable to delete recurring expense. Please try again later.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    // Always end the session
    await session.endSession();
  }
}
}

module.exports = new RecurringExpenseController();
