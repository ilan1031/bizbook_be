const mongoose = require("mongoose");
const RecurringBillsCollection = mongoose.model("recurringBill");
const BillCollection = mongoose.model("PO_bill");
const OrganizationCollection = mongoose.model("Organization");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const userActivityHelper = require("../helpers/userActivityHelper");
const moment = require("moment");
const apiHandler = require("../handler/api-handler");
const MESSAGES = require("../helpers/messageHelpers");
const JournalCollection = mongoose.model("Journal");

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
    comment_id: new mongoose.Types.ObjectId(), // generate ObjectId
    estimate_id: id,
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

class recurringBillsController {
  async createRecurring(req, res) {
    const session = await mongoose.startSession();
    try {
      const formatCurrency = (amount) => {
        return `₹${amount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      };

      console.log("Request body:", req.body); // Debug log
      console.log("Query params:", req.query); // Debug log

      let bData = req.body;
      let orgId = req.query.org_id;
      let bill_id = req.query.bill_id;
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      // Enhanced validation for required parameters
      if (!orgId) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required parameter: organization_id is mandatory.",
        });
      }

      if (
        !bData ||
        typeof bData !== "object" ||
        Object.keys(bData).length === 0
      ) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required parameter: bill data is mandatory.",
        });
      }

      // Validate essential fields in request body
      const requiredFields = [
        "vendor_id",
        "recurrence_name",
        "start_date",
        "repeat_every",
        "recurrence_frequency",
        "line_items",
        "sub_total",
        "total",
        "status",
      ];
      const missingFields = [];

      for (const field of requiredFields) {
        if (!bData[field] && bData[field] !== 0) {
          missingFields.push(field);
        }
      }

      if (missingFields.length > 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(", ")}`,
        });
      }

      // Validate line_items array
      if (!Array.isArray(bData.line_items) || bData.line_items.length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "At least one line item is required.",
        });
      }

      // Validate each line item
      for (let i = 0; i < bData.line_items.length; i++) {
        const item = bData.line_items[i];
        const itemRequiredFields = [
          "name",
          "account",
          "quantity",
          "rate",
          "amount",
        ];
        const itemMissingFields = [];

        for (const field of itemRequiredFields) {
          if (!item[field] && item[field] !== 0) {
            itemMissingFields.push(field);
          }
        }

        if (itemMissingFields.length > 0) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: `Line item ${
              i + 1
            } missing required fields: ${itemMissingFields.join(", ")}`,
          });
        }
      }

      // Mapping status numbers to their respective string values
      const statusMap = {
        0: "active",
        1: "stopped",
        2: "expired",
      };

      // Validate and map status
      if (!statusMap.hasOwnProperty(bData.status)) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Invalid status value. Allowed values: 0 (active), 1 (stopped), 2 (expired)",
        });
      }

      // Convert numeric status to string before storing
      bData.status_type = statusMap[bData.status];

      // Validate recurrence frequency
      const validFrequencies = ["days", "weeks", "months", "years"];
      if (!validFrequencies.includes(bData.recurrence_frequency)) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Invalid recurrence_frequency. Allowed: days, weeks, months, years.",
        });
      }

      // Validate and parse repeat_every
      const repeatEvery = parseInt(bData.repeat_every, 10);
      if (isNaN(repeatEvery) || repeatEvery <= 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "repeat_every must be a positive number.",
        });
      }

      const frequency = bData.recurrence_frequency;
      const startDate = moment(bData.start_date, "YYYY-MM-DD");

      if (!startDate.isValid()) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Invalid start_date format. Use YYYY-MM-DD.",
        });
      }

      // Validate end_date if provided
      if (bData.end_date) {
        const endDate = moment(bData.end_date, "YYYY-MM-DD");
        if (!endDate.isValid()) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "Invalid end_date format. Use YYYY-MM-DD.",
          });
        }

        if (endDate.isBefore(startDate)) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "end_date cannot be before start_date.",
          });
        }
      }

      await session.startTransaction();

      try {
        // Generate unique Bill ID
        let billUniqueId = await commonHelper.generateUniqueId(
          RecurringBillsCollection,
          "recurring_bill_id",
          7
        );

        // Fetch Organization Data
        let orgData = await OrgCollection.findOne({ organization_id: orgId });
        if (!orgData) {
          throw new Error("Organization not found");
        }
        bData.organization_id = orgData.organization_id;

        // Calculate amounts for journal entries (similar to createBills logic)
        const sub_total = Number(bData.sub_total || bData.total);
        const discount = Number(bData.discount_amount || 0);
        const adjustment = Number(bData.adjustment || 0);
        const tax_percentage = Number(bData.tax_percentage || 0);
        const tax_type = bData.tax_type; // "TDS" or "GST"
        const tax_amount = (tax_percentage / 100) * (sub_total - discount);
        const total_payable =
          sub_total -
          discount +
          (tax_type === "GST" ? tax_amount : -tax_amount) +
          adjustment;

        // Generate unique Journal ID
        let journalUniqueId = await commonHelper.generateUniqueId(
          JournalCollection,
          "journal_id",
          5,
          "JL"
        );

        // Create Journal Line Items following invoice pattern
        const Journal_line_items = [];

        // Add expense entries from line_items
        if (bData.line_items && bData.line_items.length > 0) {
          bData.line_items.forEach((item) => {
            Journal_line_items.push({
              coa_account_id: item.account_id || "AC_078",
              coa_account_name: item.account || "Cost of Goods Sold",
              creditOrDebit: "Debit",
              amount: Number(item.amount || 0),
              amount_formatted: formatCurrency(Number(item.amount || 0)),
            });
          });
        } else {
          // Default expense entry if no items
          Journal_line_items.push({
            coa_account_id: "AC_078",
            coa_account_name: "Cost of Goods Sold",
            creditOrDebit: "Debit",
            amount: sub_total,
            amount_formatted: formatCurrency(sub_total),
          });
        }

        // Add tax-specific entry
        if (tax_type === "GST" && tax_amount > 0) {
          Journal_line_items.push({
            coa_account_id: "AC_010", // GST Input Tax Credit
            coa_account_name: "Input Tax Credits",
            creditOrDebit: "Debit",
            amount: tax_amount,
            amount_formatted: formatCurrency(tax_amount),
          });
        } else if (tax_type === "TDS" && tax_amount > 0) {
          Journal_line_items.push({
            coa_account_id: "AC_006",
            coa_account_name: "TDS Receivable",
            creditOrDebit: "Debit",
            amount: tax_amount,
            amount_formatted: formatCurrency(tax_amount),
          });
        }

        // Add discount if any
        if (discount !== 0) {
          Journal_line_items.push({
            coa_account_id: "AC_075",
            coa_account_name: "Purchase Discounts",
            creditOrDebit: "Credit",
            amount: Math.abs(discount),
            amount_formatted: formatCurrency(Math.abs(discount)),
          });
        }

        // Add adjustment if any
        if (adjustment !== 0) {
          Journal_line_items.push({
            coa_account_id: "AC_065",
            coa_account_name: "Other Expenses",
            creditOrDebit: adjustment > 0 ? "Debit" : "Credit",
            amount: Math.abs(adjustment),
            amount_formatted: formatCurrency(Math.abs(adjustment)),
          });
        }

        // Final payable entry (Credit to Accounts Payable)
        Journal_line_items.push({
          coa_account_id: "AC_032",
          coa_account_name: "Accounts Payable",
          creditOrDebit: "Credit",
          amount: total_payable,
          amount_formatted: formatCurrency(total_payable),
        });

        const journalData = {
          organization_id: orgId,
          admin_id: admin_id,
          journal_id: journalUniqueId,
          journal_date: bData.start_date,
          journal_date_formatted: commonHelper.formatDateString(
            bData.start_date
          ),
          total_amount: total_payable,
          total_amount_formatted: formatCurrency(total_payable),
          type: "Recurring Bill",
          vendor_name: bData.vendor_name || "",
          line_items: Journal_line_items,
        };

        // Add journal_id to bill data
        bData["journal_id"] = journalUniqueId;

        console.log("The Journal Data for Recurring Bill:", journalData);

        const savedJournal = await JournalCollection.create([journalData], {
          session,
        });

        // History
        const commented_by_id = res.locals.user_id || "";
        const commented_by = res.user?.company_name || "System";
        const description = `Recurring Bill created for ₹${parseFloat(
          bData.total
        ).toFixed(2)}`;

        const comment = createComments(
          commented_by,
          commented_by_id,
          "system",
          billUniqueId,
          description,
          "Added",
          "",
          "recurring_bill"
        );

        // Calculate next_bill_date
        const nextBillDate = startDate.clone().add(repeatEvery, frequency);
        bData.next_bill_date = nextBillDate.format("YYYY-MM-DD");
        bData.last_sent_date = bData.start_date;
        bData.comments = comment;

        // Assign additional fields
        bData.recurring_bill_id = billUniqueId;
        bData.admin_id = admin_id;

        // Set default values for optional fields
        bData.tax_amount = bData.tax_amount || 0;
        bData.adjustment = bData.adjustment || 0;
        bData.discount_amount = bData.discount_amount || 0;
        bData.discount_percent = bData.discount_percent || 0;

        console.log(
          "Final bData before insertion:",
          JSON.stringify(bData, null, 2)
        ); // Debug log

        // Insert new Recurring Bill into the database (within transaction)
        let createBill = await RecurringBillsCollection.create([bData], {
          session,
        });

        if (!createBill || createBill.length === 0) {
          throw new Error("Failed to create recurring bill");
        }

        const recurringBillId = createBill[0]._id;

        // Log user activity (within transaction if userActivityHelper supports it)
        try {
          await userActivityHelper(
            admin_id,
            orgId,
            bData.vendor_id,
            `Recurring Bill created for ₹${parseFloat(bData.total).toFixed(2)}`,
            "Recurring Bill created",
            recurringBillId,
            "po_bill",
            session // Pass session if supported
          );
        } catch (error) {
          console.error("Failed to log user activity:", error.message);
          // Don't fail the entire transaction if activity logging fails
        }

        // Create regular bill if bill_id is not provided
        if (!bill_id) {
          let requestData = {
            vendor_id: bData.vendor_id,
            billNumber: "",
            order_number: "",
            billDate: bData.start_date,
            dueDate: bData.end_date || null,
            paymentTerms: bData.payment_terms_label || "",
            items: bData.line_items.map((item) => ({
              item_id: item.item_id || "",
              amount: item.amount || 0,
              details: item.details || item.name || "",
              rate: item.rate || 0,
              quantity: item.quantity || 1,
              discount: item.discount || 0,
              sku: item.sku || "",
              tax: item.tax || "",
            })),
            taxCategory: bData.tds_option || "",
            taxAmount: bData.tax_amount || 0,
            tdsOrTcs: bData.tax_type || "",
            total: bData.total,
            subtotal: bData.sub_total,
            status: 0,
            status_type: "OPEN",
            source_of_supply: bData.source_of_supply || "",
            destination_of_supply: bData.destination_of_supply || "",
            adjustment: bData.adjustment || 0,
            billing_address: bData.billing_address || {},
            recurring_bill_id: billUniqueId,
          };

          const token =
            req.headers.authorization?.split("Bearer ")[1] || res.locals.token;

          try {
            const billCreate = await apiHandler.createBill(
              orgId,
              requestData,
              token
            );
            console.log("Regular bill created:", billCreate?.data); // Debug log
          } catch (error) {
            console.error("Failed to create regular bill:", error.message);
            // Don't fail the entire transaction if regular bill creation fails
          }
        }

        // If everything is successful, commit the transaction
        await session.commitTransaction();

        return res.status(ST_CODES.CREATED || 201).json({
          status: true,
          message: "Recurring Bill created successfully with journal entries.",
          data: createBill[0],
          recurring_bill_id: billUniqueId,
          journalData: savedJournal[0],
        });
      } catch (transactionError) {
        // Rollback transaction on any error
        await session.abortTransaction();
        console.error(
          "Transaction rolled back due to error:",
          transactionError.message
        );

        // Handle specific error types
        if (transactionError.message === "Organization not found") {
          return res.status(ST_CODES.NOT_FOUND || 404).json({
            success: false,
            message: "Organization not found.",
          });
        }

        if (transactionError.message === "Failed to create recurring bill") {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "Failed to create recurring bill. Please check your data.",
          });
        }

        // Generic transaction error
        return res.status(ST_CODES.INTERNAL_SERVER_ERROR || 500).json({
          success: false,
          message: "Transaction failed and was rolled back. Please try again.",
          error: transactionError.message,
        });
      }
    } catch (error) {
      console.error("createRecurring Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR || 500).json({
        status: false,
        message:
          "Internal Server Error: Unable to create recurring bill. Please try again later.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } finally {
      // Always end the session
      await session.endSession();
    }
  }
  // Get recurring bill by id
  async getRecurringById(req, res) {
    try {
      const { org_id, filter_status = "all", page = 1, limit = 1 } = req.query;
      const admin_id = res.locals.user_id; // Fetch admin_id from session
      const recurring_bill_id = req.params.recurring_id;
      // Validate required parameters
      if (!org_id || !recurring_bill_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and recurring id are mandatory.",
        });
      }

      // Parse pagination values
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      const skip = (pageNum - 1) * limitNum;

      let recurringData = await RecurringBillsCollection.findOne({
        admin_id,
        recurring_bill_id,
        organization_id: org_id,
        deleted_at: null,
      }).lean();

      if (!recurringData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Bill not found..." });
      }

      // Fetch organization data
      let organization;
      try {
        organization = await OrganizationCollection.findOne(
          { org_id },
          {
            name: 1,
            org_name: 1,
            first_street: 1,
            second_street: 1,
            city: 1,
            state: 1,
            zip: 1,
            country: 1,
            currency_code: 1,
            currency_symbol: 1,
            email: 1,
            phone: 1,
            address: 1,
            gst_number: 1,
          }
        ).lean();
      } catch (dbError) {
        console.error("Organization Fetch Error:", dbError);
        organization = null;
      }

      // Get vendor bills with optional filter and pagination
      let billsForVendor = [];
      let manualBillCount = 0;
      let manualBillTotal = 0;
      let hasMorePage = false;
      if (recurringData.recurring_bill_id) {
        try {
          const billQuery = {
            organization_id: org_id,
            recurring_bill_id: recurringData.recurring_bill_id,
            deleted_at: null,
          };
          // Apply status filter if provided
          if (filter_status === "paid") {
            billQuery.status_type = { $in: ["PAID"] };
          } else if (filter_status === "unpaid") {
            billQuery.status_type = {
              $in: ["OPEN", "PARTIALLY PAID", "PAID", "DRAFT"],
            };
          }
          // Count total matching bills
          const totalCount = await BillCollection.countDocuments(billQuery);
          // Fetch paginated bills
          billsForVendor = await BillCollection.find(billQuery, {
            bill_number: 1,
            billDate: 1,
            billNumber: 1,
            status_type: 1,
            total: 1,
            _id: 0,
          })
            .populate({
              path: "vendor_id",
              select: "contact_id contact_name", // Only include these fields
            })
            .skip(skip)
            .limit(limitNum)
            .lean();
          manualBillCount = totalCount;
          // Aggregate total sum of filtered bills
          const aggregationResult = await BillCollection.aggregate([
            { $match: billQuery },
            { $group: { _id: null, totalSum: { $sum: "$total" } } },
          ]);
          manualBillTotal = aggregationResult[0]?.totalSum || 0;
          // Pagination metadata
          hasMorePage = pageNum * limitNum < totalCount;
        } catch (dbError) {
          console.error("Customer bills Fetch Error:", dbError);
        }
      }

      // Get customer details
      let vendorDetails;
      if (recurringData.vendor_id) {
        try {
          vendorDetails = await VendorCollection.findOne(
            {
              organization_id: org_id,
              _id: recurringData.vendor_id,
              deleted_at: null,
            },
            {
              vendor_name: 1,
              contact_name: 1,
              email: 1,
              company_name: 1,
              status_formatted: 1,
              billing_address: 1,
            }
          ).lean();
        } catch (dbError) {
          console.error("vendor Details Fetch Error:", dbError);
        }
      }

      // Combine bill data with organization data
      const responseData = {
        ...recurringData,
        vendor_data: vendorDetails,
        bills_for_vendor: billsForVendor,
        organization_details: organization || {},
        applied_filter: filter_status || "all",
        bill_pagination: {
          page: pageNum,
          per_page: limitNum,
          total: manualBillCount,
          has_more_page: hasMorePage,
        },
      };

      return res
        .status(ST_CODES.OK)
        .send({ message: "Successfully fetched", data: responseData });
    } catch (error) {
      console.log("getIndividualBill error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong", error: error.message });
    }
  }

  async updateRecurring(req, res) {
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
      // FIXED: Changed from recurring_id to recurring_bill_id to match the route parameter
      let recurring_bill_id =
        req.params.recurring_bill_id || req.params.recurring_id;
      const admin_id = res.locals.user_id;

      console.log(
        "Update request received for recurring_bill_id:",
        recurring_bill_id
      );
      console.log("Request body:", bData);

      if (req.file) {
        bData["documents"] = req.file.filename;
      }

      if (!orgId || !bData || Object.keys(bData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and bill data are mandatory.",
        });
      }

      if (!recurring_bill_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Recurring bill ID is required.",
        });
      }

      // Validate recurrence_frequency if provided
      if (bData.recurrence_frequency) {
        const validFrequencies = ["days", "weeks", "months", "years"];
        if (!validFrequencies.includes(bData["recurrence_frequency"])) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message:
              "Invalid recurrence_frequency. Allowed: days, weeks, months, years.",
          });
        }
      }

      // Validate start_date if provided
      if (bData.start_date) {
        const startDate = moment(bData.start_date, "YYYY-MM-DD");
        if (!startDate.isValid()) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "Invalid start_date format. Use YYYY-MM-DD.",
          });
        }

        // Calculate next_bill_date if repeat_every and recurrence_frequency are available
        if (bData.repeat_every && bData.recurrence_frequency) {
          const repeatEvery = parseInt(bData["repeat_every"], 10);
          const frequency = bData["recurrence_frequency"];
          const nextBillDate = startDate.clone().add(repeatEvery, frequency);
          bData.next_bill_date = nextBillDate.format("YYYY-MM-DD");
          bData.last_sent_date = bData.start_date;
        }
      }

      await session.startTransaction();

      try {
        // Fetch existing recurring bill to get current data and journal_id
        const existingBill = await RecurringBillsCollection.findOne(
          { recurring_bill_id },
          null,
          { session }
        );

        if (!existingBill) {
          throw new Error("Recurring bill not found");
        }

        console.log("Existing bill found:", existingBill.recurring_bill_id);
        console.log("Existing journal_id:", existingBill.journal_id);

        // Fetch organization
        const orgData = await OrgCollection.findOne({ organization_id: orgId });
        if (!orgData) {
          throw new Error("Organization not found");
        }

        // Add metadata
        bData.organization_id = orgData.organization_id;
        bData.admin_id = admin_id;

        // FIXED: Enhanced journal update logic - check for ANY financial changes
        let shouldUpdateJournal = false;

        // Check if any financial fields have changed
        const financialFields = [
          "line_items",
          "sub_total",
          "total",
          "tax_amount",
          "discount_amount",
          "adjustment",
          "tax_type",
          "tax_percentage",
          "discount_percent",
          "vendor_name",
        ];

        for (const field of financialFields) {
          if (bData.hasOwnProperty(field)) {
            // For arrays, do a deep comparison
            if (field === "line_items" && Array.isArray(bData[field])) {
              const existingItems = JSON.stringify(
                existingBill.line_items || []
              );
              const newItems = JSON.stringify(bData[field]);
              if (existingItems !== newItems) {
                shouldUpdateJournal = true;
                console.log("Line items changed, will update journal");
                break;
              }
            } else if (bData[field] !== existingBill[field]) {
              shouldUpdateJournal = true;
              console.log(
                `Field ${field} changed from ${existingBill[field]} to ${bData[field]}, will update journal`
              );
              break;
            }
          }
        }

        // Update journal entries if there's a journal_id and financial data has changed
        if (existingBill.journal_id && shouldUpdateJournal) {
          console.log("Updating journal entries...");

          // FIXED: Better calculation logic with proper fallbacks
          const sub_total = Number(
            bData.sub_total !== undefined
              ? bData.sub_total
              : existingBill.sub_total !== undefined
              ? existingBill.sub_total
              : bData.total !== undefined
              ? bData.total
              : existingBill.total || 0
          );

          const discount_amount = Number(
            bData.discount_amount !== undefined
              ? bData.discount_amount
              : existingBill.discount_amount || 0
          );

          const adjustment = Number(
            bData.adjustment !== undefined
              ? bData.adjustment
              : existingBill.adjustment || 0
          );

          const tax_percentage = Number(
            bData.tax_percentage !== undefined
              ? bData.tax_percentage
              : existingBill.tax_percentage || 0
          );

          const tax_type = bData.tax_type || existingBill.tax_type || "TDS";

          // Calculate tax amount
          const tax_amount =
            (tax_percentage / 100) * (sub_total - discount_amount);

          // Calculate total payable
          const total_payable =
            sub_total -
            discount_amount +
            (tax_type === "GST"
              ? tax_amount
              : tax_type === "TDS"
              ? -tax_amount
              : 0) +
            adjustment;

          console.log("Calculated amounts:", {
            sub_total,
            discount_amount,
            adjustment,
            tax_percentage,
            tax_amount,
            total_payable,
          });

          // Create updated Journal Line Items
          const Journal_line_items = [];

          // Add expense entries from line_items
          const lineItems = bData.line_items || existingBill.line_items || [];
          if (lineItems && lineItems.length > 0) {
            lineItems.forEach((item, index) => {
              const itemAmount = Number(item.amount || 0);
              if (itemAmount > 0) {
                Journal_line_items.push({
                  coa_account_id:
                    item.account_id || item.coa_account_id || "AC_078",
                  coa_account_name:
                    item.account ||
                    item.coa_account_name ||
                    "Cost of Goods Sold",
                  creditOrDebit: "Debit",
                  amount: itemAmount,
                  amount_formatted: formatCurrency(itemAmount),
                  line_description: item.name || `Line Item ${index + 1}`,
                });
              }
            });
          } else {
            // Default expense entry if no items
            Journal_line_items.push({
              coa_account_id: "AC_078",
              coa_account_name: "Cost of Goods Sold",
              creditOrDebit: "Debit",
              amount: sub_total,
              amount_formatted: formatCurrency(sub_total),
              line_description: "Default expense entry",
            });
          }

          // Add tax-specific entry
          if (tax_type === "GST" && tax_amount > 0) {
            Journal_line_items.push({
              coa_account_id: "AC_010", // GST Input Tax Credit
              coa_account_name: "Input Tax Credits",
              creditOrDebit: "Debit",
              amount: tax_amount,
              amount_formatted: formatCurrency(tax_amount),
              line_description: `GST Input Tax Credit (${tax_percentage}%)`,
            });
          } else if (tax_type === "TDS" && tax_amount > 0) {
            Journal_line_items.push({
              coa_account_id: "AC_006",
              coa_account_name: "TDS Receivable",
              creditOrDebit: "Debit",
              amount: tax_amount,
              amount_formatted: formatCurrency(tax_amount),
              line_description: `TDS Receivable (${tax_percentage}%)`,
            });
          }

          // Add discount if any
          if (discount_amount !== 0) {
            Journal_line_items.push({
              coa_account_id: "AC_075",
              coa_account_name: "Purchase Discounts",
              creditOrDebit: "Credit",
              amount: Math.abs(discount_amount),
              amount_formatted: formatCurrency(Math.abs(discount_amount)),
              line_description: "Purchase Discount",
            });
          }

          // Add adjustment if any
          if (adjustment !== 0) {
            Journal_line_items.push({
              coa_account_id: "AC_065",
              coa_account_name: "Other Expenses",
              creditOrDebit: adjustment > 0 ? "Debit" : "Credit",
              amount: Math.abs(adjustment),
              amount_formatted: formatCurrency(Math.abs(adjustment)),
              line_description:
                bData.adjustment_description ||
                existingBill.adjustment_description ||
                "Adjustment",
            });
          }

          // Final payable entry (Credit to Accounts Payable)
          Journal_line_items.push({
            coa_account_id: "AC_032",
            coa_account_name: "Accounts Payable",
            creditOrDebit: "Credit",
            amount: total_payable,
            amount_formatted: formatCurrency(total_payable),
            line_description: "Accounts Payable",
          });

          // FIXED: Get vendor name properly
          let vendor_name = "";
          if (bData.vendor_name) {
            vendor_name = bData.vendor_name;
          } else if (existingBill.vendor_name) {
            vendor_name = existingBill.vendor_name;
          } else if (
            existingBill.vendor_data &&
            existingBill.vendor_data.contact_name
          ) {
            vendor_name = existingBill.vendor_data.contact_name;
          } else {
            vendor_name = "Unknown Vendor";
          }

          // Update journal entry
          const updatedJournalData = {
            journal_date: bData.start_date || existingBill.start_date,
            journal_date_formatted: commonHelper.formatDateString(
              bData.start_date || existingBill.start_date
            ),
            total_amount: total_payable,
            total_amount_formatted: formatCurrency(total_payable),
            vendor_name: vendor_name,
            line_items: Journal_line_items,
            updated_at: new Date(),
            // Add some metadata for tracking
            last_modified_by: admin_id,
            modification_reason: "Recurring bill update",
          };

          console.log(
            "Updating Journal Data for Recurring Bill:",
            updatedJournalData
          );

          const updatedJournal = await JournalCollection.findOneAndUpdate(
            { journal_id: existingBill.journal_id },
            { $set: updatedJournalData },
            { session, new: true }
          );

          if (updatedJournal) {
            console.log("Journal entry updated successfully");
          } else {
            console.warn(
              "Journal entry not found for journal_id:",
              existingBill.journal_id
            );
            // Don't fail the transaction, just log the warning
          }
        } else if (!existingBill.journal_id) {
          console.log("No journal_id found, skipping journal update");
        } else {
          console.log("No financial changes detected, skipping journal update");
        }

        // Append comment history
        const commented_by_id = res.locals.user_id || "";
        const commented_by = res.user?.company_name || "System";
        const description = `Recurring Bill updated for ₹${parseFloat(
          bData.total || existingBill.total || 0
        ).toFixed(2)}`;

        const comment = createComments(
          commented_by,
          commented_by_id,
          "system",
          recurring_bill_id,
          description,
          "Updated",
          "",
          "recurring_bill"
        );

        // FIXED: Only update fields that are actually provided
        const updateFields = { ...bData };
        delete updateFields.general; // Remove any UI-specific fields

        // Perform update on recurring bill
        const updatedBill = await RecurringBillsCollection.findOneAndUpdate(
          { recurring_bill_id }, // match by recurring_bill_id
          {
            $set: updateFields,
            $push: { comments: comment },
          },
          { session, new: true }
        );

        if (!updatedBill) {
          throw new Error("Failed to update recurring bill");
        }

        console.log("Recurring bill updated successfully");

        // Log user activity (within transaction if userActivityHelper supports it)
        try {
          await userActivityHelper(
            admin_id,
            orgId,
            bData.vendor_id || existingBill.vendor_id,
            `Recurring Bill updated for ₹${parseFloat(
              bData.total || existingBill.total || 0
            ).toFixed(2)}`,
            "Recurring Bill updated",
            updatedBill._id,
            "po_bill",
            session // Pass session if supported
          );
        } catch (error) {
          console.error("Failed to log user activity:", error.message);
          // Don't fail the entire transaction if activity logging fails
        }

        // If everything is successful, commit the transaction
        await session.commitTransaction();

        return res.status(ST_CODES.OK).json({
          status: true,
          success: true,
          message:
            "Recurring Bill and journal entries have been updated successfully.",
          data: updatedBill,
        });
      } catch (transactionError) {
        // Rollback transaction on any error
        await session.abortTransaction();
        console.error(
          "Transaction rolled back due to error:",
          transactionError.message
        );

        // Handle specific error types
        if (transactionError.message === "Recurring bill not found") {
          return res.status(ST_CODES.NOT_FOUND).json({
            success: false,
            message: "Recurring bill not found.",
          });
        }

        if (transactionError.message === "Organization not found") {
          return res.status(ST_CODES.ORG_NOT_FOUND || ST_CODES.NOT_FOUND).json({
            success: false,
            message: "Organization not found.",
          });
        }

        if (transactionError.message === "Failed to update recurring bill") {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "Failed to update recurring bill. Please check your data.",
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
      console.error("updateRecurring Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        success: false,
        message:
          "Internal Server Error: Unable to update recurring bill. Please try again later.",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } finally {
      // Always end the session
      await session.endSession();
    }
  }

  async getRecurringBill(req, res) {
    try {
      let {
        limit = 10,
        page = 1,
        sort_column = "created_time",
        sort_order = "D",
        filter = "Status.All",
        customer_id = null, // Add support for customer_id filtering
      } = req.query;
      const { organization_id } = req.query;

      // Validate required parameters
      if (!organization_id) {
        return res.status(400).json({
          code: 1,
          message: "Missing required parameter: organization_id",
        });
      }

      // Convert limit and page to numbers
      limit = parseInt(limit, 10);
      page = parseInt(page, 10);

      // Define query conditions
      const query = {
        organization_id: organization_id,
        deleted_at: null, // Exclude soft-deleted recurring invoices
      };

      switch (filter) {
        case "Status.Active":
          query.status_type = "active";
          break;
        case "Status.Stopped":
          query.status_type = "stopped";
          break;
        case "Status.Expired":
          query.status_type = "expired";
          break;
        case "Status.All":
        case "":
          // No additional filtering for 'All' or empty filter
          break;
        default:
          // Handle unknown filter or ignore
          break;
      }

      // Add customer_id filter if provided
      if (customer_id) {
        query.customer_id = customer_id;
      }

      const allowedSortColumns = [
        "vendor_name",
        "recurrence_name",
        "next_bill_date",
        "createdAt",
        "total",
      ];

      // Define sorting order
      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      // Fetch recurring bills with pagination & sorting
      let results = await queryHelper.findDataWithPopulate(
        RecurringBillsCollection,
        query,
        {},
        {}, // no sort here
        limit,
        page,
        ["vendor_id"]
      );

      // Post-sort if sort_column is 'contact_name'
      if (sort_column === "vendor_name") {
        results.msg.sort((a, b) => {
          const nameA = a.vendor_id?.contact_name?.toLowerCase() || "";
          const nameB = b.vendor_id?.contact_name?.toLowerCase() || "";
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

      const totalCount = await RecurringBillsCollection.countDocuments(query);

      const transformedRecurringBills = (results.msg || []).map(
        (recurringBill) => {
          let recurrenceStatus = "Active";
          const now = new Date();
          const endDate = recurringBill.end_date
            ? new Date(recurringBill.end_date)
            : null;

          if (recurringBill.status_type === "stopped") {
            recurrenceStatus = "Stopped";
          } else if (endDate && endDate < now) {
            recurrenceStatus = "Expired";
          }

          const formatRupee = (value) =>
            new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(value || 0);
          let frequency = "";
          const freqMap = {
            days: "Day",
            weeks: "Week",
            months: "Month",
            years: "Year",
          };

          const unit = freqMap[recurringBill.recurrence_frequency];

          if (recurringBill.repeat_every === 1) {
            // Singular form
            frequency = `${unit}ly`; // e.g., Daily, Weekly, Monthly
          } else {
            // Plural form with count
            frequency = `Every ${recurringBill.repeat_every} ${unit}s`; // e.g., Every 2 Weeks
          }

          return {
            recurring_bill_id: recurringBill.recurring_bill_id,
            _id: recurringBill._id,
            recurrence_name: recurringBill.recurrence_name,
            createdAt:
              moment(recurringBill.createdAt).format("DD/MM/YYYY") || "",
            created_time:
              moment(recurringBill.created_time).format("DD/MM/YYYY") || "",
            start_date:
              moment(recurringBill.start_date).format("DD/MM/YYYY") || "",
            next_bill_date:
              (recurringBill?.next_bill_date &&
                moment(recurringBill?.next_bill_date)?.format("DD/MM/YYYY")) ||
              "--",
            end_date:
              moment(recurringBill?.end_date)?.format("DD/MM/YYYY") || "--",
            last_sent_date:
              moment(recurringBill.last_sent_date).format("DD/MM/YYYY") || "",
            recurrence_frequency: frequency,
            organization_id: recurringBill.org_id,
            status: recurrenceStatus,
            total: formatRupee(recurringBill.total),
            sub_total: formatRupee(recurringBill.sub_total),
            tax_total: formatRupee(recurringBill.tax_total),
            discount_total: recurringBill.discount_total || 0,
            discount_total_formatted: formatRupee(recurringBill.discount_total),
            vendor_id: recurringBill.vendor_id?._id || null,
            vendor_name:
              recurringBill.vendor_id?.contact_name || "Unknown Vendor",
            company_name: recurringBill.vendor_id?.company_name || "",
          };
        }
      );
      const hasMorePage = page * limit < totalCount;

      // Construct response
      return res.status(200).json({
        code: 0,
        message: "success",
        recurring_bills: transformedRecurringBills,
        totalCount: totalCount,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage,
          report_name: "Recurring Bills",
          applied_filter: filter,
          custom_fields: [],
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      console.error("getRecurringInvoices Error:", error.message);
      return res.status(500).json({
        code: 1,
        message:
          "Internal Server Error: Unable to fetch recurring invoices. Please try again later.",
      });
    }
  }

  async createBillFromRecurring(req, res) {
    try {
      let bData = req.body;
      let organization_id = req.query.org_id;
      let { recurring_bill_id } = req.params;
      if (req.file) {
        bData["documents"] = req.file.filename;
      }
      // Validate required parameters
      if (
        !organization_id ||
        !bData ||
        Object.keys(bData).length === 0 ||
        !recurring_bill_id
      ) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and bill data are mandatory.",
        });
      }

      let requestData = {
        ...bData,
        status: 0,
        recurring_bill_id: recurring_bill_id,
      };
      const token =
        req.headers.authorization?.split("Bearer ")[1] || res.locals.token;
      // Now create a regular bill using the same data
      let responseData;
      try {
        const billCreate = await apiHandler.createBill(
          organization_id,
          requestData,
          token
        );
        responseData = billCreate.data.data;
      } catch (error) {
        console.error("Failed to create regular bill:", error.message);
      }

      const commented_by_id = res.locals.user_id || "";
      const commented_by = res.user?.company_name || "System";
      const description = "Bill created.";

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurring_bill_id,
        description,
        "Updated",
        "",
        "recurring_bill"
      );

      // Only push comment into existing comments array
      const updatedBill = await RecurringBillsCollection.findOneAndUpdate(
        { recurring_bill_id }, // match by recurring_bill_id
        {
          $push: { comments: { $each: [comment] } }, // if comment is a single object
        },
        { new: true }
      );

      // Decide whether to rollback recurring invoice creation or proceed
      return res.status(200).json({
        code: 0,
        message: "Bill has been created",
        data: responseData,
      });
    } catch (error) {
      console.error("createBillFromRecurring Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Unable to create bill from recurring. Please try again later.",
      });
    }
  }

  //status handling
  async updateRecurringStatus(req, res) {
    try {
      const { recurring_bill_id, organization_id } = req.query;
      const { status } = req.params;

      if (!recurring_bill_id || !organization_id || !status) {
        return res.status(400).json({ message: "Missing Required Parameters" });
      }

      const validStatus = ["resume", "stop"];
      if (!validStatus.includes(status.toLowerCase())) {
        return res.status(400).json({ message: "The status is not valid" });
      }

      let new_status;
      let status_type;

      if (status.toLowerCase() === "resume") {
        new_status = 0;
        status_type = "active";
      } else if (status.toLowerCase() === "stop") {
        new_status = 1;
        status_type = "stopped";
      }

      const updateRecurringBillStatus =
        await RecurringBillsCollection.findOneAndUpdate(
          {
            recurring_bill_id: recurring_bill_id,
            organization_id: organization_id,
            deleted_at: null,
          },
          {
            $set: {
              status: new_status,
              status_type: status_type,
              last_modified_time: new Date(),
            },
          },
          { new: true }
        );

      if (!updateRecurringBillStatus) {
        return res
          .status(400)
          .json({ message: "Bill or Organization not found" });
      }

      const commented_by_id = res.locals.user_id || "";
      const commented_by = res.user?.company_name || "System";
      const description = `Recurring Bill ${status_type}`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurring_bill_id,
        description,
        "Updated",
        "",
        "recurring_bill"
      );

      // Perform update
      const updatedBill = await RecurringBillsCollection.findOneAndUpdate(
        { recurring_bill_id }, // match by recurring_bill_id
        {
          $push: { comments: comment },
        },
        { new: true }
      );

      if (!updatedBill) {
        return res.status(400).json({
          success: false,
          message: "Recurring bill not found for updating status comment.",
        });
      }

      res.status(200).send({
        data: updatedBill,
      });
    } catch (error) {
      return res.status(404).json({
        message: "Catch function working in recurring bill status change",
        error: error.message,
      });
    }
  }

 async deleteRecurring(req, res) {
    const session = await mongoose.startSession();
    try {
      const { organization_id, journal_id } = req.query;
      const { recurring_bill_id } = req.params;
      const admin_id = res.locals.user_id;

      console.log("Delete request received for recurring_bill_id:", recurring_bill_id);
      console.log("Organization ID:", organization_id);
      console.log("Journal ID provided:", journal_id);

      // Validate required parameters
      if (!organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({ 
          success: false,
          message: "Organization ID is required." 
        });
      }

      if (!recurring_bill_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({ 
          success: false,
          message: "Recurring Bill ID is required." 
        });
      }

      // FIXED: Make journal_id optional since it might not always be provided
      // If not provided, we'll try to get it from the existing bill
      let targetJournalId = journal_id;

      await session.startTransaction();

      try {
        // Check if recurring bill exists before deletion
        const billToDelete = await RecurringBillsCollection.findOne({
          recurring_bill_id: recurring_bill_id,
          organization_id: organization_id,
          deleted_at: null,
        }, null, { session });

        if (!billToDelete) {
          throw new Error("Recurring bill not found or already deleted");
        }

        console.log("Found recurring bill:", billToDelete.recurring_bill_id);

        // If journal_id wasn't provided in query, try to get it from the bill
        if (!targetJournalId && billToDelete.journal_id) {
          targetJournalId = billToDelete.journal_id;
          console.log("Using journal_id from bill:", targetJournalId);
        }

        // Variables to track deletion status
        let deletedJournal = null;
        let journalDeletedSuccessfully = false;

        // Delete journal entry if journal_id is available
        if (targetJournalId) {
          console.log("Attempting to delete journal entry:", targetJournalId);
          
          // Check if journal exists before deletion
          const journalToDelete = await JournalCollection.findOne({
            journal_id: targetJournalId,
            type :"Bill",
            organization_id: organization_id, // Add org filter for security
          }, null, { session });

          if (journalToDelete) {
            console.log("Found journal entry, proceeding with deletion");
            
            // OPTION 1: Hard Delete (based on your reference pattern)
            deletedJournal = await JournalCollection.findOneAndDelete({
              journal_id: targetJournalId,
              organization_id: organization_id,
            }, { session });

            // OPTION 2: Soft Delete (uncomment if preferred)
            /*
            deletedJournal = await JournalCollection.findOneAndUpdate(
              {
                journal_id: targetJournalId,
                organization_id: organization_id,
              },
              {
                $set: {
                  deleted_at: new Date(),
                  deleted_by: admin_id,
                  deletion_reason: "Associated recurring bill deleted",
                  is_active: false,
                },
              },
              { session, new: true }
            );
            */

            if (deletedJournal) {
              console.log("Journal entry deleted successfully");
              journalDeletedSuccessfully = true;
            } else {
              console.warn("Failed to delete journal entry");
            }
          } else {
            console.warn("Journal entry not found:", targetJournalId);
          }
        } else {
          console.log("No journal_id available, skipping journal deletion");
        }

        // Delete recurring bill (following your reference pattern)
        const deleteRecurringBill = await RecurringBillsCollection.findOneAndUpdate(
          {
            recurring_bill_id: recurring_bill_id,
            organization_id: organization_id,
            deleted_at: null,
          },
          {
            $set: {
              deleted_at: new Date(),
              deleted_by: admin_id,
              status: 2, // Set status to expired/deleted
              status_type: "expired",
            },
          },
          {
            session,
            new: true,
          }
        );

        if (!deleteRecurringBill) {
          throw new Error("Failed to delete recurring bill");
        }

        console.log("Recurring bill deleted successfully");

        // Add comment history for the deletion
        const commented_by_id = res.locals.user_id || "";
        const commented_by = res.user?.company_name || "System";
        const journalStatus = journalDeletedSuccessfully ? "and journal entry" : "";
        const description = `Recurring Bill deleted ${journalStatus} for ₹${parseFloat(
          billToDelete.total || 0
        ).toFixed(2)}`;

        const comment = createComments(
          commented_by,
          commented_by_id,
          "system",
          recurring_bill_id,
          description,
          "Deleted",
          "",
          "recurring_bill"
        );

        // Add the deletion comment to the bill
        await RecurringBillsCollection.findOneAndUpdate(
          { _id: deleteRecurringBill._id },
          { $push: { comments: comment } },
          { session }
        );

        // Log user activity (following your reference pattern)
        await userActivityHelper(
          admin_id,
          organization_id,
          billToDelete.vendor_id,
          `Recurring Bill deleted ${journalStatus} for ₹${parseFloat(billToDelete.total || 0).toFixed(2)}`,
          "Recurring Bill deleted",
          deleteRecurringBill._id,
          "po_bill",
          session // Pass session if supported
        );

        // If everything is successful, commit the transaction
        await session.commitTransaction();

        console.log("Deletion transaction completed successfully");

        return res.status(ST_CODES.OK).json({
          success: true,
          message: journalDeletedSuccessfully 
            ? "Recurring bill and associated journal entry deleted successfully"
            : "Recurring bill deleted successfully. Journal entry was not found or not provided.",
          data: {
            deleted_recurring_bill_id: deleteRecurringBill._id,
            deleted_journal_id: deletedJournal?.journal_id || deletedJournal?._id || null,
            journal_deleted: journalDeletedSuccessfully,
            journal_id_attempted: targetJournalId,
          },
        });

      } catch (transactionError) {
        // Rollback transaction on any error
        await session.abortTransaction();
        console.error("Transaction rolled back due to error:", transactionError.message);

        // Handle specific error types
        if (transactionError.message === "Recurring bill not found or already deleted") {
          return res.status(ST_CODES.NOT_FOUND).json({
            success: false,
            message: "Recurring bill not found or already deleted.",
          });
        }

        if (transactionError.message === "Failed to delete recurring bill") {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "Failed to delete recurring bill. Please try again.",
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
      console.error("deleteRecurring Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error: Unable to delete recurring bill. Please try again later.",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    } finally {
      // Always end the session
      await session.endSession();
    }
}
}

module.exports = new recurringBillsController();
