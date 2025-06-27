const mongoose = require("mongoose");
const PaymentCollection = mongoose.model("Payment");
const VendorCollection = mongoose.model("Contact");
const BillsCollection = mongoose.model("PO_bill");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const ApiHandler = require("../handler/api-handler");
const fs = require("fs");
const path = require("path");
const uploadDir = path.resolve(__dirname, "../../uploads/general");
const JournalCollection = mongoose.model("Journal");

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return "₹0.00";
  return `₹${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

class PaymentController {
  async createPayment(req, res) {
    try {
      let bData = req.body;
      const admin_id = res.locals.user_id; // This should be an ObjectId from the user session
      const { organization_id, filter = "" } = req.query;
      // console.log(req.body, "payment data");
      if (req.file) {
        bData["documents"] = req.file.filename;
      }
      if (!organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required field: organization_id is mandatory.",
        });
      }

      if (!bData.contact_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required field: contact_id is mandatory.",
        });
      }

      // Generate unique payment ID
      let paymentUniqueId = await commonHelper.generateUniqueId(
        PaymentCollection,
        "unique_PM_id",
        5,
        "PM"
      );
      if (bData.admin_id) {
        delete bData.admin_id;
      }

      let journalUniqueId = await commonHelper.generateUniqueId(
        JournalCollection,
        "journal_id",
        5,
        "JL"
      );

      let modelData = {
        unique_PM_id: paymentUniqueId,
        journal_id: journalUniqueId,
        admin_id: admin_id, // Using the admin_id from server session
        organization_id: organization_id,
        ...bData, // Spread all other fields from req.body
      };
      if (modelData.is_advance_payment === undefined) {
        modelData.is_advance_payment = true; // Default for vendor advances
      }

      // Ensure date is valid
      if (modelData.date && typeof modelData.date === "string") {
        modelData.date = new Date(modelData.date);
      }
      if (modelData.payment_type == "VendorAdvance") {
        let vendorData = await VendorCollection.findOneAndUpdate(
          {
            _id: bData.contact_id,
          },
          {
            $set: {
              unused_credits_receivable_amount: bData.amount,
            },
          }
        );
      }

      const Journal_line_items_payment = [
        {
          coa_account_id: bData?.paid_through_account_id,
          coa_account_name: bData?.paid_through_account_name,
          creditOrDebit: "Credit",
          amount: bData.amount,
          amount_formatted: formatCurrency(bData.amount),
        },
        {
          coa_account_id: "AC_032",
          coa_account_name: "Accounts Payable",
          creditOrDebit: "Debit",
          amount: bData.amount || 0,
          amount_formatted: formatCurrency(bData.amount),
        },
      ];

      const Journal_line_items_advance = [
        {
          coa_account_id: bData?.paid_through_account_id,
          coa_account_name: bData?.paid_through_account_name,
          creditOrDebit: "Credit",
          amount: bData.amount,
          amount_formatted: formatCurrency(bData.amount),
        },
        {
          coa_account_id: bData?.deposite_to_id,
          coa_account_name: bData.deposite_to,
          creditOrDebit: "Debit",
          amount: bData.amount || 0,
          amount_formatted: formatCurrency(bData.amount),
        },
      ];

      const journalData = {
        organization_id: organization_id,
        admin_id: admin_id,
        journal_id: journalUniqueId,
        journal_date: bData.date,
        journal_date_formatted: commonHelper.formatDateString(bData.date),
        total_amount: bData.amount,
        total_amount_formatted: formatCurrency(bData.amount),
        type:
          bData.payment_type == "BillPayment"
            ? "Payments Made"
            : "Vendor Payment",
        vendor_name: bData?.contact_id,
        line_items:
          bData.payment_type == "BillPayment"
            ? Journal_line_items_payment
            : Journal_line_items_advance,
      };

      const savedJournal = await JournalCollection.create(journalData);

      let addPayment = await queryHelper.insertData(
        PaymentCollection,
        modelData
      );
      if (addPayment.status) {
        res.status(ST_CODES.OK).send({
          status: addPayment.status,
          data: addPayment.msg,
          message: "Payment created successfully...",
        });
      } else {
        res.status(ST_CODES.BAD_REQUEST).send({
          status: addPayment.status,
          message: addPayment.msg,
        });
      }
    } catch (error) {
      // console.error("createPayment Error:", error.message);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: error.message || "Something went wrong",
      });
    }
  }
  async updatePayment(req, res) {
    try {
      // Get both parameters from query instead of params
      const { organization_id, payment_id } = req.query;

      const updateData = req.body;
      const admin_id = res.locals.user_id;

      // console.log(req.body);
      // Validate required fields
      if (!payment_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required fields: payment_id and organization_id are mandatory.",
        });
      }

       const Journal_line_items_payment = [
        {
          coa_account_id: updateData?.paid_through_account_id,
          coa_account_name: updateData?.paid_through_account_name,
          creditOrDebit: "Credit",
          amount: updateData.amount,
          amount_formatted: formatCurrency(updateData.amount),
        },
        {
          coa_account_id: "AC_032",
          coa_account_name: "Accounts Payable",
          creditOrDebit: "Debit",
          amount: updateData.amount || 0,
          amount_formatted: formatCurrency(updateData.amount),
        },
      ];

      const Journal_line_items_advance = [
        {
          coa_account_id: updateData?.paid_through_account_id,
          coa_account_name: updateData?.paid_through_account_name,
          creditOrDebit: "Credit",
          amount: updateData.amount,
          amount_formatted: formatCurrency(updateData.amount),
        },
        {
          coa_account_id: updateData?.deposite_to_id,
          coa_account_name: updateData.deposite_to,
          creditOrDebit: "Debit",
          amount: updateData.amount || 0,
          amount_formatted: formatCurrency(updateData.amount),
        },
      ];

      const updatedJournal = {
        total_amount: updateData.amount,
        total_amount_formatted: formatCurrency(updateData.amount),
        vendor_name: updateData?.contact_id,
        line_items:
           updateData.payment_type == "BillPayment"
            ? Journal_line_items_payment
            : Journal_line_items_advance,
      };

      if(req.body.journal_id)
        {
      const updateJournal = await JournalCollection.findOneAndUpdate(
        { journal_id: updateData.journal_id },
        { $set: updatedJournal },
        { new: true, runValidators: true }
      );
    }


      // Find payment to ensure it exists
      const existingPayment = await PaymentCollection.findOne({
        payment_id: payment_id,
        organization_id: organization_id,
        is_deleted: { $ne: true }, // Check that it's not already deleted
      });

      if (!existingPayment) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Payment not found or has been deleted.",
        });
      }

      // Handle file uploads if present
      if (req.files && req.files.length > 0) {
        // Validate file types for all uploaded files
        const allowedTypes = [
          "pdf",
          "jpg",
          "jpeg",
          "png",
          "doc",
          "docx",
          "csv",
          "xls",
          "xlsx",
        ];
        const invalidFiles = [];

        for (const file of req.files) {
          const fileExtension = file.filename.split(".").pop().toLowerCase();
          if (!allowedTypes.includes(fileExtension)) {
            invalidFiles.push(file.originalname);
          }
        }

        if (invalidFiles.length > 0) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: `Invalid file types for: ${invalidFiles.join(
              ", "
            )}. Allowed types: ${allowedTypes.join(", ")}`,
          });
        }

        // Handle documents - merge with existing documents if any
        const newDocuments = req.files.map((file) => file.filename);
        const existingDocuments = existingPayment.documents || [];

        // Combine existing and new documents (you can modify this logic as needed)
        updateData.documents = [...existingDocuments, ...newDocuments];
      }

      // Remove fields that shouldn't be updated
      const restrictedFields = [
        "admin_id",
        "organization_id",
        "is_deleted",
        "deleted_at",
        "created_at",
      ];
      restrictedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          delete updateData[field];
        }
      });

      // Add updated_by and updated_at fields
      updateData.updated_by = admin_id;
      updateData.updated_at = new Date();

      // Handle date conversion if needed
      if (updateData.date && typeof updateData.date === "string") {
        updateData.date = new Date(updateData.date);
      }

      // Update the payment
      const updateResult = await PaymentCollection.findOneAndUpdate(
        { payment_id: payment_id, organization_id: organization_id },
        { $set: updateData },
        { new: true } // Return the updated document
      );

      if (updateResult) {
        res.status(ST_CODES.OK).json({
          success: true,
          data: updateResult,
          message: "Payment updated successfully.",
        });
      } else {
        res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to update payment.",
        });
      }
    } catch (error) {
      console.error("updatePayment Error:", error.message);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          error.message || "Something went wrong while updating payment.",
      });
    }
  }
  async deletePayment(req, res) {
    try {
      const { payment_id, organization_id } = req.query;
      const admin_id = res.locals.user_id;

      if (req.file) {
        bData["documents"] = req.file.filename;
      }
      // Validate required fields
      if (!payment_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required fields: payment_id and organization_id are mandatory.",
        });
      }

      // Find the payment to be deleted with complete details
      const paymentToDelete = await PaymentCollection.findOne({
        payment_id: payment_id,
        organization_id: organization_id,
        is_deleted: { $ne: true },
      });

      if (!paymentToDelete) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Payment not found or has already been deleted.",
        });
      }

      // Get the main payment amount to use for calculations
      const paymentAmount = Number(paymentToDelete.amount || 0);

      // Process associated bills before deleting the payment
      if (paymentToDelete.bills && paymentToDelete.bills.length > 0) {
        console.log("Payment bills array:", paymentToDelete.bills);

        for (const billItem of paymentToDelete.bills) {
          console.log("Processing bill item:", billItem);

          // Use _id to find and update bills
          const bill_id = billItem.bill_id;
          // Get the specific amount applied to this bill (if available) or use the main payment amount
          const amountAppliedToBill = Number(
            billItem.amount_applied || billItem.amountApplied || paymentAmount
          );

          if (!bill_id) {
            console.log(
              `Skipping invalid bill item - missing _id. Available properties:`,
              Object.keys(billItem)
            );
            continue;
          }

          console.log(
            `Processing bill with _id: ${bill_id} with payment amount: ${amountAppliedToBill}`
          );

          // Find the bill by its _id
          const bill = await BillsCollection.findOne({
            _id: bill_id,
            organization_id: organization_id,
          });

          if (!bill) {
            console.log(
              `Bill with _id: ${bill_id} not found in BillsCollection for organization ${organization_id}`
            );
            // Try to find any bill with this _id to debug
            const debugBill = await BillsCollection.findOne({ _id: bill_id });
            if (debugBill) {
              console.log(
                `Bill exists but with different organization_id: ${debugBill.organization_id}`
              );
            }
            continue;
          }

          console.log(`Before update - Bill _id: ${bill_id}:`, {
            total: bill.total,
            payment_made: bill.payment_made,
            due_amt: bill.due_amt,
            status: bill.status,
            status_type: bill.status_type,
          });

          // Calculate new values with explicit conversion
          const currentTotal = Number(bill.total || 0);
          const currentPaymentMade = Number(bill.payment_made || 0);
          const currentDueAmt = Number(bill.due_amt || 0);

          console.log(`Bill _id: ${bill_id} current state:`, {
            currentTotal,
            currentPaymentMade,
            currentDueAmt,
            amountToAddBack: amountAppliedToBill,
          });

          // Subtract the payment amount from payment_made
          const newPaymentMade = Math.max(
            0,
            currentPaymentMade - amountAppliedToBill
          );

          // Add the payment amount back to the due_amt (this is the key fix)
          const newDueAmt = currentDueAmt + amountAppliedToBill;

          // Determine new status based on the new payment_made amount
          let newStatus, newStatusType;
          if (newPaymentMade <= 0) {
            newStatus = 0;
            newStatusType = "OPEN";
          } else if (newPaymentMade < currentTotal) {
            newStatus = 1; // Changed from 0 to 1 for partially paid
            newStatusType = "PARTIALLY PAID";
          } else {
            newStatus = 3;
            newStatusType = "PAID";
          }

          // Update the bill with new values using _id
          const updateResult = await BillsCollection.findOneAndUpdate(
            { _id: bill_id, organization_id: organization_id },
            {
              $set: {
                payment_made: newPaymentMade,
                due_amt: newDueAmt,
                status: newStatus,
                status_type: newStatusType,
              },
            },
            { new: true }
          );

          if (updateResult) {
            console.log(`Successfully updated bill _id: ${bill_id}:`, {
              old_payment_made: currentPaymentMade,
              new_payment_made: newPaymentMade,
              old_due_amt: currentDueAmt,
              new_due_amt: newDueAmt,
              new_status: newStatusType,
              amount_added_back_to_due: amountAppliedToBill,
            });
          } else {
            console.log(`Failed to update bill _id: ${bill_id}`);
          }
        }
      }

      // Handle vendor advance payment if applicable
      if (
        paymentToDelete.payment_type === "VendorAdvance" &&
        paymentToDelete.contact_id
      ) {
        const vendorResult = await VendorCollection.findByIdAndUpdate(
          paymentToDelete.contact_id,
          {
            $inc: {
              unused_credits_receivable_amount: -Number(
                paymentToDelete.amount || 0
              ),
            },
          },
          { new: true }
        );

        console.log(`Updated vendor credits:`, {
          vendor_id: paymentToDelete.contact_id,
          reduced_by: paymentToDelete.amount,
          new_credits: vendorResult?.unused_credits_receivable_amount,
        });
      }

      // Soft delete the payment
      const deleteResult = await PaymentCollection.findOneAndUpdate(
        { payment_id: payment_id, organization_id: organization_id },
        {
          $set: {
            is_deleted: true,
            deleted_at: new Date(),
            deleted_by: admin_id,
          },
        },
        { new: true }
      );

      if (deleteResult) {
        res.status(ST_CODES.OK).json({
          success: true,
          message: "Payment deleted successfully and associated bills updated.",
        });
      } else {
        res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to delete payment.",
        });
      }
    } catch (error) {
      console.error("deletePayment Error:", error.message);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          error.message || "Something went wrong while deleting payment.",
      });
    }
  }
  async getPaymentDetails(req, res) {
    try {
      const { payment_id, organization_id } = req.query;
      const token = req.headers.authorization;

      if (!payment_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required field: payment_id and organization_id are mandatory.",
        });
      }

      // Get payment details with populated contact_id field
      const paymentDetails = await PaymentCollection.findOne({
        payment_id: payment_id,
        organization_id: organization_id,
      }).populate("contact_id", "_id billing_address contact_name email"); // Assuming contact_id is a reference to Contact model

      if (!paymentDetails) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Payment not found.",
        });
      }

      // Get organization details using ApiHandler
      let organizationDetails = {};
      try {
        const orgResponse = await ApiHandler.getOrganizationDetails(
          organization_id,
          token
        );
        organizationDetails = orgResponse.data;
      } catch (error) {
        console.error("Error fetching organization details:", error.message);
        organizationDetails = { error: "Failed to fetch organization details" };
      }
      const responseData = {
        payment: paymentDetails, // This is now the populated contact data
        organization: organizationDetails,
      };

      res.status(ST_CODES.OK).send({
        data: responseData,
      });
    } catch (error) {
      console.error("getPaymentDetails Error:", error.message);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        success: false,
        message: "Something went wrong while retrieving payment details",
      });
    }
  }
  async getPaymentsByType(req, res) {
    try {
      const { payment_type } = req.params;
      const { organization_id } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      if (!organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required field: organization_id is mandatory.",
        });
      }

      console.log("Requested payment type:", payment_type);
      console.log("Organization ID:", organization_id);

      // Create a more basic filter first to check data exists
      const basicFilter = {
        organization_id: organization_id,
        is_deleted: { $ne: true },
      };

      // Check if any payments exist at all for this organization
      const anyPayments = await PaymentCollection.find(basicFilter).limit(1);
      console.log("Any payments exist:", anyPayments.length > 0);

      if (anyPayments.length === 0) {
        return res.status(ST_CODES.OK).json({
          success: true,
          data: {
            payments: [],
            pagination: {
              total: 0,
              page,
              limit,
              totalPages: 0,
              hasNextPage: false,
              hasPrevPage: false,
            },
          },
          message: "No payments found for this organization",
        });
      }

      // Check what payment types actually exist in the database
      const existingTypes = await PaymentCollection.distinct(
        "payment_type",
        basicFilter
      );
      console.log("Existing payment types in DB:", existingTypes);

      // Now proceed with type filtering
      const validPaymentTypes = ["VendorAdvance", "paymentMade"];
      if (!validPaymentTypes.includes(payment_type)) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: `Invalid payment_type. Must be one of: ${validPaymentTypes.join(
            ", "
          )}`,
        });
      }

      // Create filter object with payment type
      const filter = {
        ...basicFilter,
        payment_type: payment_type,
      };

      console.log("Full filter:", filter);

      // Rest of your code remains the same...
      const totalCount = await PaymentCollection.countDocuments(filter);
      console.log("Total matching documents:", totalCount);

      const payments = await PaymentCollection.find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit);

      // Add this debugging info
      console.log(`Found ${payments.length} payments matching filter`);

      // Prepare pagination info
      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      res.status(ST_CODES.OK).json({
        success: true,
        data: {
          payments,
          pagination: {
            total: totalCount,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
        },
        message: `${payment_type} payments retrieved successfully`,
      });
    } catch (error) {
      console.error(`getPaymentsByType Error:`, error.message);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          error.message || "Something went wrong while retrieving payments",
      });
    }
  }
  async getAllPayments(req, res) {
    try {
      let {
        organization_id,
        page = 1,
        limit = 10,
        filter = "Status.All",
        sort_column = "createdAt",
        sort_order = "D",
      } = req.query;

      if (!organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required field: organization_id is mandatory.",
        });
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sortDirection = sort_order === "A" ? 1 : -1;

      const query = {
        organization_id,
        is_deleted: { $ne: true },
      };

      switch (filter) {
        case "Status.Advanced":
          query.payment_type = "VendorAdvance";
          break;
        case "Status.Inactive":
          query.payment_type = "BillPayment";
          break;
        case "Status.Payviacheck":
          query.payment_mode = "Cheque";
          break;
        case "Status.Printed":
          query.check_status = "TO_BE_PRINTED";
          break;
        case "Status.Uncleared":
          query.check_status = "UNCLEARED";
          break;
        case "Status.Cleared":
          query.check_status = "CLEARED";
          break;
        case "Status.Void":
          query.status_type = "VOID";
          break;
        case "Status.All":
        default:
          break;
      }

      // Optional filters
      const additionalFilters = [
        "contact_id",
        "payment_type",
        "status",
        "is_advance_payment",
      ];
      additionalFilters.forEach((field) => {
        if (req.query[field] !== undefined) {
          query[field] = req.query[field];
        }
      });

      // Date filter
      if (req.query.start_date && req.query.end_date) {
        query.date = {
          $gte: new Date(req.query.start_date),
          $lte: new Date(req.query.end_date),
        };
      }

      const totalCount = await PaymentCollection.countDocuments(query);
      const allowedSortColumns = [
        "vendor_name",
        "date",
        "createdAt",
        "updatedAt",
        "payment_mode",
        "payment_id",
        "amount",
        "amount_formatted",
        "unused_amount",
      ];

      let payments = [];

      if (sort_column === "unused_amount") {
        // Aggregation pipeline
        const pipeline = [
          { $match: query },
          {
            $addFields: {
              sort_unused_amount: {
                $cond: {
                  if: { $eq: ["$is_advance_payment", true] },
                  then: "$unused_amount",
                  else: "$amount",
                },
              },
            },
          },
          { $sort: { sort_unused_amount: sortDirection } },
          { $skip: skip },
          { $limit: parseInt(limit) },
        ];

        payments = await PaymentCollection.aggregate(pipeline);
      } else {
        const sortField = allowedSortColumns.includes(sort_column)
          ? sort_column
          : "createdAt";
        const sort = {};
        sort[sortField] = sortDirection;
        if (sort_column === "amount_formatted") sort_column = "amount";
        payments = await PaymentCollection.find(query)
          .populate({
            path: "contact_id",
            select: "first_name email phone _id",
          })
          .skip(skip)
          .limit(parseInt(limit));
        if (sort_column === "vendor_name") {
          payments.sort((a, b) => {
            const nameA = a.contact_id?.first_name?.toLowerCase() || "";
            const nameB = b.contact_id?.first_name?.toLowerCase() || "";
            return sort_order === "A"
              ? nameA.localeCompare(nameB)
              : nameB.localeCompare(nameA);
          });
        } else {
          // Otherwise sort normally
          payments.sort((a, b) => {
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
      }

      // Format payments
      const formattedPayments = payments.map((payment) => {
        const obj = payment.toObject ? payment.toObject() : payment;

        obj.amount_formatted = obj.amount
          ? `₹${parseFloat(obj.amount).toFixed(2)}`
          : "₹0.00";

        if (obj.date) {
          const date = new Date(obj.date);
          const day = String(date.getUTCDate()).padStart(2, "0");
          const month = String(date.getUTCMonth() + 1).padStart(2, "0");
          const year = date.getUTCFullYear();
          const formattedDate = `${day}/${month}/${year}`;
          obj.date_formatted = formattedDate;
          obj.date = formattedDate;
        } else {
          obj.date = obj.date_formatted = "N/A";
        }

        obj.vendor_name = obj.contact_id?.first_name || "Unknown Vendor";

        obj.bill_numbers = Array.isArray(obj.bills)
          ? obj.bills.map((bill) => bill.billNumber)
          : [];

        return obj;
      });

      const totalPages = Math.ceil(totalCount / parseInt(limit));

      return res.status(ST_CODES.OK).json({
        data: formattedPayments,
        pagination: {
          totalCount,
          totalPages,
          currentPage: parseInt(page),
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1,
        },
      });
    } catch (error) {
      console.error("getAllPayments Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          error.message || "Something went wrong while retrieving payments",
      });
    }
  }
  async getPaymentEmailDetails(req, res) {
    try {
      const { organization_id } = req.query;
      const { payment_id } = req.params;
      const token = req.headers.authorization;
      // Validate required parameters
      if (!organization_id || !payment_id || !token) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id, payment_id, or token",
        });
      }
      // Fetch Payment
      const payment = await PaymentCollection.findOne({
        organization_id: organization_id,
        payment_id: payment_id,
      });
      if (!payment) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Payment not found",
        });
      }
      if (!payment.contact_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Payment does not have a valid vendor_id",
        });
      }
      let organization = {};
      let contactPerson = {};
      try {
        let contact_id = payment.contact_id;
        const [organizationResponse, contactPersonResponse] = await Promise.all(
          [
            ApiHandler.getOrganizationDetails(organization_id, token),
            ApiHandler.getContactPersonInformation(
              contact_id,
              organization_id,
              token
            ),
          ]
        );

        if (organizationResponse?.data?.data) {
          organization = organizationResponse.data.data;
          // console.log("✅ Organization data retrieved successfully.");
        } else {
          console.log("⚠️ Organization API returned empty data.");
        }

        if (contactPersonResponse?.data) {
          contactPerson = contactPersonResponse.data;
          // console.log("✅ Contact person data retrieved successfully.");
        } else {
          console.log("⚠️ Contact person API returned empty data.");
        }
      } catch (error) {
        console.error(
          "❌ Error fetching organization or contact details:",
          error.message
        );
        if (error.response) {
          console.error(
            "API response error:",
            error.response.status,
            error.response.data
          );
        }
      }

      // Extract relevant contact information (Ensure it's always an array)
      const to_contact = Array.isArray(contactPerson?.data)
        ? contactPerson.data.map((contact) => ({
            contact_person_id: contact.contact_person_id || "",
            contact_id: contact.contact_id || "",
            organization_id: contact.organization_id || "",
            salutation: contact.salutation || "",
            first_name: contact.first_name || "",
            last_name: contact.last_name || "",
            email: contact.email || "", // Ensure email is included
            phone: contact.phone || "",
            mobile: contact.mobile || "",
            skype: contact.skype || "",
            department: contact.department || "",
            designation: contact.designation || "",
            is_primary_contact: contact.is_primary_contact || false,
            is_portal_invitation_accepted:
              contact.is_portal_invitation_accepted || false,
            contact_name: `${contact.salutation || ""} ${
              contact.first_name || ""
            } ${contact.last_name || ""}`.trim(),
          }))
        : []; // Default to empty array if not an array

      // Extract orgemail_name details from organization
      const orgemail_name = Array.isArray(organization?.orgemail_name)
        ? organization.orgemail_name.map((emailData) => ({
            email: emailData.email || "",
            contact_name: emailData.contact_name || "",
          }))
        : [];

      // Format date if available
      let formattedDate = "";
      if (payment.date) {
        try {
          formattedDate = new Date(payment.date).toLocaleDateString("en-GB");
        } catch (e) {
          console.error("Error formatting date:", e);
        }
      }

      // Format amount if available
      let formattedAmount = "";
      if (payment.amount) {
        try {
          formattedAmount = payment.amount.toLocaleString("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2,
          });
          // Remove the currency symbol if needed
          // formattedAmount = formattedAmount.replace('₹', '');
        } catch (e) {
          console.error("Error formatting amount:", e);
        }
      }

      // Get primary contact name or vendor name
      let vendorName = payment.vendor_name || "";
      if (
        !vendorName &&
        Array.isArray(contactPerson?.data) &&
        contactPerson.data.length > 0
      ) {
        // Try to find primary contact
        const primaryContact = contactPerson.data.find(
          (c) => c.is_primary_contact
        );
        if (primaryContact) {
          vendorName =
            primaryContact.contact_name ||
            `${primaryContact.salutation || ""} ${
              primaryContact.first_name || ""
            } ${primaryContact.last_name || ""}`.trim();
        } else {
          // Use first contact if no primary
          vendorName =
            contactPerson.data[0].contact_name ||
            `${contactPerson.data[0].salutation || ""} ${
              contactPerson.data[0].first_name || ""
            } ${contactPerson.data[0].last_name || ""}`.trim();
        }
      }

      // Prepare Email Details Object
      const emailDetails = {
        from_email: organization.email || "",
        subject: `Payment Receipt: ${payment.payment_id} from ${
          organization.organization_name || ""
        }`,
        body: `Hi ${vendorName || "Vendor"}`,
        vendor_name: vendorName,
        vendor_id: payment.contact_id || "",
        organization_name: organization.organization_name || "",
        organization_id: organization_id,
        payment_id: payment.payment_id || "",
        payment_number: payment.payment_number || "",
        amount: payment.amount || 0,
        amount_formatted: formattedAmount || "",
        date: payment.date || payment.createdAt || "",
        date_formatted: formattedDate || "",
        payment_mode: payment.payment_mode || "",
        reference_number: payment.reference_number || "",
        bills: payment.bills || [],
        file_name: `Payment-${payment.payment_id}`,
        file_name_without_extension: `Payment-${payment.payment_id}.pdf`,
        orgemail_detail: orgemail_name,
        to_contact,
        entity_type: "payment",
      };

      console.log("✅ Email details successfully prepared");

      // Return the email details
      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Email details retrieved successfully",
        data: emailDetails,
      });
    } catch (error) {
      console.error("❌ getPaymentEmailDetails Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Something went wrong while fetching email details",
        error: error.message,
      });
    }
  }
  async removeDocumentFromPayment(req, res) {
    try {
      const { organization_id, payment_id } = req.query;

      // Validate required parameters
      if (!organization_id || !payment_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required parameters: organization_id or payment_id",
        });
      }

      // Find the payment by its ID and organization
      const payment = await PaymentCollection.findOne({
        organization_id: organization_id,
        payment_id: payment_id,
        is_deleted: { $ne: true },
      });

      // If payment not found
      if (!payment) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Payment not found",
        });
      }

      // If no document exists
      if (!payment.documents || payment.documents === "") {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "No document attached to remove",
        });
      }

      

      // Optional: Delete the physical file from disk
      const filePath = path.join(uploadDir, payment.documents);

      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (!err) {
          // File exists, delete it
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error("Error deleting file from disk:", unlinkErr);
            } else {
              console.log(`File ${payment.documents} deleted successfully`);
            }
          });
        } else {
          console.warn(`File ${payment.documents} does not exist on disk`);
        }
      });

      // Update the documents field to empty string
      const updatedPayment = await PaymentCollection.findOneAndUpdate(
        {
          organization_id: organization_id,
          payment_id: payment_id,
        },
        {
          $set: {
            documents: "", // Clear the document field
          },
        },
        { new: true }
      );

      return res.status(ST_CODES.OK).json({
        success: true,
        message: "Document removed successfully",
        data: updatedPayment,
      });
    } catch (error) {
      console.error("removeDocumentFromPayment error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong while removing the document.",
      });
    }
  }
}

module.exports = new PaymentController();
