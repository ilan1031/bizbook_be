const mongoose = require("mongoose");
const BillsCollection = mongoose.model("PO_bill");
const PurchaseOrderCollection = mongoose.model("Purchase_Order");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const MESSAGES = require("../helpers/messageHelpers");
const commonHelper = require("../helpers/commonHelpers");
const userActivityHelper = require("../helpers/userActivityHelper");
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
    bill_id: id,
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

class billsController {
  async getVendors(req, res) {
    try {
      //   let bData = req.body;
      let adminID = res.locals.user_id;
      let orgId = req.query.org_id;
      let getVenors = await VendorCollection.find({
        admin_id: adminID,
        organization_id: orgId,
        contact_type: "Vendor",
      });
      // console.log(getVenors, "getVenors");
      if (getVenors.length) {
        res.status(ST_CODES.OK).send({ data: getVenors, status: true });
      } else {
        res
          .status(ST_CODES.OK)
          .send({ data: [], Message: "There is no vendors" });
      }
      //   console.log(getVenors, "getVenors");
    } catch (error) {
      console.log("getVendors error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }

  async createBills(req, res) {
    const session = await mongoose.startSession();
    try {
      const formatCurrency = (amount) => {
        return `₹${amount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      };

      console.log("Processing Bill Creation...");
      let bData = req.body;
      console.log(bData, "-*-*-*-*-*-*-");

      let orgId = req.query.org_id;
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      if (req.file) {
        bData["documents"] = req.file.filename;
      }

      // Validate required parameters
      if (!orgId || !bData || Object.keys(bData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and bill data are mandatory.",
        });
      }

      // Mapping status numbers to their respective string values
      const statusMap = {
        0: "OPEN",
        1: "DRAFT",
        2: "VOID",
        3: "PAID",
      };

      // Validate and map status
      if (!statusMap.hasOwnProperty(bData.status)) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Invalid status value. Allowed values: 0 (OPEN), 1 (DRAFT), 2 (VOID), 3 (PAID).",
        });
      }

      // Convert numeric status to string before storing
      bData.status_type = statusMap[bData.status];

      await session.startTransaction();

      try {
        // Generate unique Bill ID
        let billUniqueId = await commonHelper.generateUniqueId(
          BillsCollection,
          "bill_number",
          7,
          "BL"
        );

        // Assign additional fields
        bData["bill_number"] = billUniqueId;
        bData["admin_id"] = admin_id;
        bData["due_date"] = bData.dueDate;
        bData["due_amt"] = bData.total;

        // Fetch Organization Data
        let orgData = await OrgCollection.findOne({ organization_id: orgId });
        if (!orgData) {
          return res.status(ST_CODES.NOT_FOUND).json({
            success: false,
            message: "Organization not found.",
          });
        }
        bData["organization_id"] = orgData.organization_id;

        // Calculate amounts for journal entries (similar to invoice logic)
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

        console.log("The data saving for the bill is: ", bData);

        // Generate unique Journal ID (standardized with lowercase 'journal_id')
        let journalUniqueId = await commonHelper.generateUniqueId(
          JournalCollection,
          "journal_id",
          5,
          "JL"
        );

        // Create Journal Line Items following invoice pattern
        const Journal_line_items = [];

        // Add expense entries from items
        if (bData.items && bData.items.length > 0) {
          bData.items.forEach((item) => {
            Journal_line_items.push({
              coa_account_id: item.account_id || "AC_078",
              coa_account_name: item.account_name || "Cost of Goods Sold",
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
          journal_date: bData.billDate,
          journal_date_formatted: commonHelper.formatDateString(bData.billDate),
          total_amount: total_payable,
          total_amount_formatted: formatCurrency(total_payable),
          type: "Bill",
          vendor_name: bData.vendorName,
          line_items: Journal_line_items,
        };

        // Add journal_id to bill data
        bData["journal_id"] = journalUniqueId;

        console.log("The Journal Data", journalData);

        const savedJournal = await JournalCollection.create([journalData], {
          session,
        });

        // Create comment
        const commented_by_id = res.locals.user_id || "";
        const commented_by = req.user?.company_name || "System";
        const description = `Bill created for ${commonHelper.formatRupee(
          bData.total
        )}`;

        const comment = createComments(
          commented_by,
          commented_by_id,
          "system",
          billUniqueId,
          description,
          "Added",
          "",
          "bills"
        );
        bData["comments"] = comment;

        // Insert new Bill into the database (within transaction)
        let createBill = await BillsCollection.create([bData], { session });

        if (!createBill || createBill.length === 0) {
          throw new Error("Failed to create bill");
        }

        const billId = createBill[0]._id;

        // Log user activity (within transaction if userActivityHelper supports it)
        await userActivityHelper(
          admin_id,
          orgId,
          bData.vendor_id,
          description,
          "Bill created",
          billId,
          "po_bill",
          session // Pass session if supported
        );

        // Update billed_status in PurchaseOrderCollection (within transaction)
        let purchaseOrderUpdate = await PurchaseOrderCollection.updateMany(
          {
            organization_id: orgId,
            billed_status: { $ne: "Billed" },
          },
          { $set: { billed_status: "Billed" } },
          { session }
        );

        console.log("Updated Purchase Orders:", purchaseOrderUpdate);

        // If everything is successful, commit the transaction
        await session.commitTransaction();

        return res.status(ST_CODES.CREATED).json({
          success: true,
          message: "Bill created successfully and Purchase Orders updated.",
          data: {
            bill_number: billUniqueId,
            status: bData.status,
            updated_purchase_orders: purchaseOrderUpdate.modifiedCount,
          },
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
          return res.status(ST_CODES.NOT_FOUND).json({
            success: false,
            message: "Organization not found.",
          });
        }

        if (transactionError.message === "Failed to create bill") {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "Failed to create bill. Please check your data.",
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
      console.error("createBills Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to create bill. Please try again later.",
      });
    } finally {
      // Always end the session
      await session.endSession();
    }
  }

  async getAllBills(req, res) {
    try {
      const {
        org_id,
        sort_column = "createdAt",
        sort_order = "D",
        filter = "",
      } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      if (!org_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Unauthorized route" });
      }

      const query = {
        admin_id: res.locals.user_id,
        organization_id: org_id,
      };

      switch (filter) {
        case "Status.Open":
          query.status_type = "OPEN";
          break;
        case "Status.Void":
          query.status_type = "VOID";
          break;
        case "Status.Draft":
          query.status_type = "DRAFT";
          break;
        case "Status.All":
        default:
          break;
      }

      // Convert sort order to MongoDB format
      const allowedSortColumns = [
        "vendor_name",
        "due_date",
        "createdAt",
        "updatedAt",
        "bill_number",
        "date",
        "total",
      ];

      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      const projection = {
        organization_id: 1,
        bill_number: 1,
        billNumber: 1,
        vendor_id: 1,
        status: 1,
        status_type: 1,
        status_formatted: 1,
        color_code: 1,
        current_sub_status_id: 1,
        current_sub_status: 1,
        current_sub_status_formatted: 1,
        reference_number: 1,
        date: 1,
        date_formatted: 1,
        due_date: 1,
        due_date_formatted: 1,
        due_days: 1,
        currency_id: 1,
        currency_code: 1,
        price_precision: 2,
        exchange_rate: 1,
        total: 1,
        total_formatted: 1,
        tds_total: 1,
        tds_total_formatted: 1,
        balance: 1,
        balance_formatted: 1,
        unprocessed_total: 1,
        unprocessed_payment_amount_formatted: 1,
        created_time: 1,
        last_modified_time: 1,
        attachment_name: 1,
        has_attachment: 1,
        is_uber_bill: 1,
        is_tally_bill: 1,
        entity_type: 1,
        client_viewed_time: 1,
        client_viewed_time_formatted: 1,
        is_viewed_by_client: 1,
        is_bill_reconciliation_violated: 1,
        createdAt: 1,
        documents: 1,
        due_amt: 1,
        discount_amount: 1,
        journal_id: 1,
      };

      const totalCount = await BillsCollection.countDocuments(query);
      const results = await queryHelper.findDataWithPopulate(
        BillsCollection,
        query,
        projection,
        {},
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

      const formatDate = (dateString) => {
        if (!dateString) return "";
        const date = new Date(dateString);
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
      };

      const formattedBills = (results?.msg || []).map((bill) => ({
        bill_number: bill.bill_number,
        _id: bill._id,
        createdAt: bill.createdAt,
        created_time: formatDate(bill.created_time),
        due_date: formatDate(bill.due_date),
        date: formatDate(bill.date),
        organization_id: bill.organization_id,
        status: bill.status,
        status_type: bill.status_type,
        total: bill.total ? `₹${parseFloat(bill.total).toFixed(2)}` : "₹0.00",
        due_amt: bill.due_amt
          ? `₹${parseFloat(bill.due_amt).toFixed(2)}`
          : "₹0.00",
        vendor_id: bill.vendor_id?._id,
        vendor_name: bill.vendor_id?.contact_name || "",
        documents: bill.documents,
        billNumber: bill.billNumber,
        amount: bill.due_amt,
        discount: bill.discount_amount,
        totals: bill.total,
        journal_id: bill.journal_id,
      }));

      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      res.status(ST_CODES.OK).send({
        status: results.status,
        data: formattedBills,
        pagination: {
          totalCount,
          totalPages,
          currentPage: page,
          applied_filter: filter,
          hasNextPage,
          hasPrevPage,
        },
        type: "Bills",
      });
    } catch (error) {
      console.error("getAllBills error:", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }

  async getIndividualBill(req, res) {
    try {
      const { org_id, bill_id } = req.query;
      if (!org_id || !bill_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Unauthorized route" });
      }

      // The error is occurring because org_id is a number but MongoDB expects a string
      // We need to query without directly using it as an ObjectId
      let billData = await BillsCollection.findOne({
        admin_id: res.locals.user_id,
        bill_number: bill_id,
      })
        .populate("vendor_id")
        .populate({
          path: "purchase_orders.po_ref_id",
          select: "purchase_number status_type due_date total date _id",
        });

      if (!billData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Bill not found..." });
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
        return res.status(ST_CODES.ORG_NOT_FOUND).send({
          success: true,
          message: MESSAGES.ORG_NOT_FOUND,
        });
      }

      // Combine bill data with organization data
      const responseData = {
        ...billData.toObject(),
        organization: organizationData.toObject(),
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

  async updateIndividualBill(req, res) {
    try {
      const { org_id, bill_id } = req.query;
      const bData = req.body;
      if (req.file) {
        bData["documents"] = req.file.filename;
      }
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System";
      const description = `Bill updated for ${commonHelper.formatRupee(
        bData.total
      )}`;
      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        bill_id,
        description,
        "updated", // operation_type
        "", // transaction_id
        "bills"
      );
      let findBill = await BillsCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        bill_number: bill_id,
      });
      await userActivityHelper(
        res.locals.user_id,
        org_id,
        findBill.vendor_id,
        description,
        "Bill updated",
        findBill._id,
        "po_bill"
      );
      const updatedBill = await BillsCollection.findOneAndUpdate(
        {
          admin_id: res.locals.user_id,
          organization_id: org_id,
          bill_number: bill_id,
        },
        { $set: bData, $push: { comments: comment } }, // Updating fields with request body data

        { new: true, runValidators: true } // Returns updated document and applies schema validation
      );

      // If bill is found and updated, return the updated document
      if (updatedBill) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Bill updated successfully",
          data: updatedBill,
        });
      }

      // If no matching bill is found
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Bill not found",
      });
    } catch (error) {
      console.log("updateIndividualBill error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }

  async deleteIndividualBill(req, res) {
    try {
      const { org_id, bill_id, journal_id } = req.query;

      // Validate required parameters
      if (!org_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Organization ID is required." });
      }

      if (!bill_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Bill ID is required." });
      }

      if (!journal_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Journal ID is required for deleting the bill." });
      }

      // Check if bill exists before deletion
      const billToDelete = await BillsCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        bill_number: bill_id,
      });

      if (!billToDelete) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({
            message:
              "Bill not found or you don't have permission to delete this bill.",
          });
      }

      // Check if journal exists before deletion
      const journalToDelete = await JournalCollection.findOne({
        journal_id: journal_id,
      });

      if (!journalToDelete) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({ message: "Journal entry not found." });
      }

      // Delete bill
      const deleteBill = await BillsCollection.findOneAndDelete({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        bill_number: bill_id,
      });

      // Delete journal entry
      const deleteJournal = await JournalCollection.findOneAndDelete({
        journal_id: journal_id,
      });

      // Log user activity (fix typo: "ny" -> "by")
      await userActivityHelper(
        res.locals.user_id,
        org_id,
        deleteBill.vendor_id,
        "Bill deleted by admin",
        "Bill deleted",
        deleteBill._id,
        "po_bill"
      );

      return res.status(ST_CODES.OK).json({
        success: true,
        message: "Bill and associated journal entry deleted successfully",
        data: {
          deleted_bill_id: deleteBill._id,
          deleted_journal_id: deleteJournal.journal_id,
        },
      });
    } catch (error) {
      console.error("Error deleting bill:", error);

      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong while deleting the bill",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  async updateBillStatusToVoid(req, res) {
    try {
      const { org_id, bill_id, status } = req.query;

      const findBill = await BillsCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        bill_number: bill_id,
      });
      console.log(org_id, bill_id, status, "--sdsdvsvdsdsv----");
      // return;

      // console.log(organization_id,"------------");
      // return
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System";
      const description = `Bill status updated as void`;
      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        bill_id,
        description,
        "updated", // operation_type
        "", // transaction_id
        "bills"
      );

      if (!findBill) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Bill not found",
        });
      }
      await userActivityHelper(
        res.locals.user_id,
        org_id,
        findBill.vendor_id,
        description,
        "Bill updated",
        findBill._id,
        "po_bill"
      );
      if (findBill.status === 0 && status === "void") {
        await BillsCollection.updateOne(
          { _id: findBill._id },
          {
            $set: { status: 2, status_type: "VOID" },
            $push: { comments: comment },
          }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Bill status updated successfully",
        });
      }

      return res.status(ST_CODES.BAD_REQUEST).json({
        success: true,
        message: "Invalid bill status cannot be updated.",
      });
    } catch (error) {
      console.error("updateBillStatusToVoid error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Something went wrong" });
    }
  }

  async updateBillStatusToDraft(req, res) {
    try {
      const { org_id, bill_id, status } = req.query;

      const findBill = await BillsCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        bill_number: bill_id,
      });
      if (!findBill) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Bill not found",
        });
      }
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System";
      const description = `Bill status updated as draft`;
      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        bill_id,
        description,
        "updated", // operation_type
        "", // transaction_id
        "bills"
      );
      await userActivityHelper(
        res.locals.user_id,
        org_id,
        findBill.vendor_id,
        description,
        "Bill updated",
        findBill._id,
        "po_bill"
      );
      if (findBill.status === 2 && status === "draft") {
        await BillsCollection.updateOne(
          { _id: findBill._id },
          {
            $set: { status: 1, status_type: "DRAFT" },
            $push: { comments: comment },
          }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Bill status updated successfully",
        });
      }
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Only Void bills can be updated as draft.",
      });
    } catch (error) {
      console.error("updateBillStatusToDraft error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Something went wrong" });
    }
  }

  async updateBillStatusFromDraft(req, res) {
    try {
      const { org_id, bill_id, status } = req.query;

      const findBill = await BillsCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        bill_number: bill_id,
      });
      if (!findBill) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Bill not found",
        });
      }
      let description = `Bill status updated as open`;
      if (findBill.status === 1 && status === "paid") {
        description = `Bill status updated as paid`;
      }
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System";

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        bill_id,
        description,
        "updated", // operation_type
        "", // transaction_id
        "bills"
      );
      await userActivityHelper(
        res.locals.user_id,
        org_id,
        findBill.vendor_id,
        description,
        "Bill updated",
        findBill._id,
        "po_bill"
      );
      if (findBill.status === 1 && status === "open") {
        await BillsCollection.updateOne(
          { _id: findBill._id },
          {
            $set: { status: 0, status_type: "OPEN" },
            $push: { comments: comment },
          }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Bill status updated successfully",
        });
      } else if (findBill.status === 1 && status === "paid") {
        await BillsCollection.updateOne(
          { _id: findBill._id },
          { $set: { status: 3 }, $push: { comments: comment } }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Bill status updated successfully",
        });
      } else {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Invalid bill status cannot be updated.",
        });
      }
    } catch (error) {
      console.error("updateBillStatusFromDraft error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Something went wrong" });
    }
  }

  async updateBillingAddress(req, res) {
    try {
      let bData = req.body;
      const { org_id, bill_id } = req.query;
      const updateBillingAddress = await BillsCollection.findOneAndUpdate(
        {
          admin_id: res.locals.user_id,
          organization_id: org_id,
          bill_number: bill_id,
        },
        {
          $set: {
            billing_address: bData,
          },
        }
      );
      // console.log(updateBillingAddress, "updateBillingAddress");
      if (updateBillingAddress) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Billing address updated successfully",
          data: updateBillingAddress,
        });
      }

      // If no matching bill is found
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Bill not found",
      });
    } catch (error) {
      console.log("updateBillingAddress error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }

  async getVendorBillSummary(req, res) {
    try {
      const { vendor_id, org_id } = req.query;
      const admin_id = res.locals.user_id;

      if (!vendor_id || !org_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing vendor_id or organization_id",
        });
      }

      const vendorQuery = {
        admin_id,
        organization_id: org_id,
        status: { $ne: 3 },
      };
      // Handle both string and ObjectId formats for vendor_id
      if (mongoose.Types.ObjectId.isValid(vendor_id)) {
        vendorQuery["$or"] = [
          { vendor_id: vendor_id },
          { vendor_id: new mongoose.Types.ObjectId(vendor_id) },
        ];
      } else {
        vendorQuery["vendor_id"] = vendor_id;
      }

      const bills = await BillsCollection.find(vendorQuery);
      console.log(bills, "bills---**---");
      const formatted = bills.map((bill) => {
        return {
          date: bill.billDate,
          due_date: bill.due_date,
          billNumber: bill.bill_number,
          // poNumber,
          payment_made: bill.payment_made,
          total: bill.total,
          due_amt: bill.due_amt,
          id: bill._id,
        };
      });

      console.log(bills, formatted, "formatted");
      return res.status(ST_CODES.OK).json({
        success: true,
        data: formatted,
      });
    } catch (error) {
      console.error("getVendorBillSummary error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }

  async applyBillPayment(req, res) {
    try {
      const { bill_id, org_id } = req.query;
      const { amount_applied } = req.body;

      if (!bill_id || !org_id || amount_applied == null) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "bill_id, org_id and amount_applied are required",
        });
      }

      let billQuery = {
        admin_id: res.locals.user_id,
        organization_id: org_id,
      };

      // Match either by ObjectId or string bill_number
      if (mongoose.Types.ObjectId.isValid(bill_id)) {
        billQuery["$or"] = [
          { _id: new mongoose.Types.ObjectId(bill_id) },
          { bill_number: bill_id },
        ];
      } else {
        billQuery["bill_number"] = bill_id;
      }

      const bill = await BillsCollection.findOne(billQuery);

      if (!bill) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Bill not found",
        });
      }
      bill.payment_made = amount_applied;

      bill.due_amt = bill.total - amount_applied;

      // Update status accordingly
      if (bill.total === amount_applied) {
        bill.status = 3; // PAID
        bill.status_type = "PAID";
      } else {
        bill.status = 0; // OPEN
        bill.status_type = "PARTIALLY PAID";
      }
      await bill.save();

      return res.status(ST_CODES.OK).send({
        data: bill,
      });
    } catch (error) {
      console.error("applyBillPayment error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Something went wrong" });
    }
  }
  
  async getHistory(req, res) {
    try {
      const { bill_id, org_id } = req.query;
      const billHistory = await BillsCollection.findOne(
        {
          organization_id: org_id,
          bill_number: bill_id,
        },
        {
          comments: 1,
        }
      );
      if (!billHistory) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Bill history not found",
        });
      }
      return res.status(ST_CODES.OK).send({
        message: "Successfully fetched",
        data: billHistory.comments,
      });
    } catch (error) {
      console.error("getHistory error:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Something went wrong" });
    }
  }
}

module.exports = new billsController();
