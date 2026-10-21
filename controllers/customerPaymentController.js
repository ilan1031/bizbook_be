const mongoose = require("mongoose");
const CustomerPaymentCollection = require("../model/customerPayment");
const InvoiceCollection = require("../model/invoice");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");
const { default: axios } = require("axios");
const ST_CODES = require("../helpers/statusCodeHelpers");
const CustomerCollection = require("../model/contactModel");
const OrganizationCollection = require("../model/organizationSchema");
const apiHandler = require("../handler/api-handler");
const Razorpay = require("razorpay");
const crypto = require("crypto");
require("dotenv").config();
const JournalCollection = mongoose.model("Journal");
const COA_collection = mongoose.model("Chart_of_account");

// Razorpay client, created on first use: the constructor throws when the
// keys are missing, which used to crash the whole server on startup.
let razorpayClient = null;
const razorpayInstance = new Proxy(
  {},
  {
    get: (_, prop) => {
      if (!razorpayClient) {
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
          throw new Error("Razorpay is not configured (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)");
        }
        razorpayClient = new Razorpay({
          key_id: process.env.RAZORPAY_KEY_ID,
          key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
      }
      return razorpayClient[prop];
    },
  }
);

class CustomerPaymentController {
  // 📝 Get Customer Payment and filter by customer ID
  async getPaymentsReceived(req, res) {
    try {
      let {
        page = 1,
        per_page = 10,
        limit = 10,
        filter = "",
        sort_column = "created_time",
        sort_order = "D",
        organization_id,
      } = req.query;

      if (!organization_id) {
        return res.status(400).json({
          code: 1,
          message: "Missing required parameters: organization_id mandatory.",
        });
      }

      page = parseInt(page, 10);
      limit = parseInt(limit, 10);

      const query = {
        organization_id: organization_id,
        deleted_at: null,
      };

      switch (filter) {
        case "advance":
          query.is_advance_payment = true;
          break;
        case "retainer":
          query.is_advance_payment = true;
          break;
        case "invoice":
          query.is_advance_payment = false;
          break;
        case "":
        case "all":
          break;
        default:
          break;
      }

      const allowedSortColumns = [
        "customer_name",
        "date",
        "createdAt",
        "updatedAt",
        "payment_mode",
        "payment_id",
        "amount",
        "unused_amount",
      ];

      // Define sorting order
      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      const projection = {
        _id: 1,
        customer_id: 1,
        payment_id: 1,
        amount: 1,
        payment_mode: 1,
        reference_number: 1,
        date: 1,
        date_formatted: 1,
        payment_date: 1,
        payment_number: 1,
        notes: 1,
        is_advance_payment: 1,
        created_time: 1,
        unused_amount: 1,
        account_id: 1,
        account_name: 1,
        description: 1,
        payment_type: 1,
        payment_status: 1,
        tags: 1,
        documents: 1,
        tax_account_id: 1,
        tax_account_name: 1,
        tax_amount_withheld: 1,
        invoices: 1,
        invoice_numbers: 1,
      };

      let results;
      if (sort_column === "unused_amount") {
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
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: projection },
        ];

        results = await CustomerPaymentCollection.aggregate(pipeline).exec();
      } else {
        // Use your existing helper for normal sorting
        const fetched = await queryHelper.findData(
          CustomerPaymentCollection,
          query,
          projection,
          sort,
          limit,
          page
        );
        console.log(fetched, "fetchedfetchedfetched");
        results = fetched?.status ? fetched.msg : [];
      }

      const totalCount = await queryHelper.countDocuments(
        CustomerPaymentCollection,
        query
      );
      const hasMorePage = page * limit < totalCount;

      const currency_symbol = "₹"; // fallback if orgDetails is not available

      const transformedPayments = await Promise.all(
        results.map(async (payment) => {
          const paymentData = payment._doc || payment;
          let customer_name = "";

          if (paymentData.customer_id) {
            try {
              const customer = await CustomerCollection.findOne({
                contact_id: paymentData.customer_id,
                organization_id,
                deleted_at: null,
              }).select({ contact_name: 1 });

              customer_name = customer?.contact_name || "";
            } catch (err) {
              console.error("Error fetching customer name:", err.message);
            }
          }

          const formatCurrency = (amount) => {
            return `${currency_symbol}${(amount || 0).toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          };
          const date = new Date(paymentData.date);
          const day = String(date.getUTCDate()).padStart(2, "0");
          const month = String(date.getUTCMonth() + 1).padStart(2, "0");
          const year = date.getUTCFullYear();
          const formattedDate = `${day}/${month}/${year}`;
          return {
            _id: paymentData._id,
            customer_id: paymentData.customer_id,
            payment_id: paymentData.payment_id,
            customer_name,
            amount_formatted: formatCurrency(paymentData.amount),
            amount: paymentData.amount || 0,
            payment_mode: paymentData.payment_mode || "",
            reference_number: paymentData.reference_number || "",
            date: paymentData.date || "",
            date_formatted: formattedDate || "",
            payment_date: paymentData.payment_date || "",
            payment_number: paymentData.payment_number || "",
            notes: paymentData.notes || "",
            is_advance_payment: !!paymentData.is_advance_payment,
            created_time: paymentData.created_time || "",
            unused_amount: paymentData.unused_amount || 0,
            unused_amount_formatted: formatCurrency(paymentData.unused_amount),
            account_id: paymentData.account_id || "",
            account_name: paymentData.account_name || "",
            description: paymentData.description || "",
            documents: paymentData.documents || "",
            tags: paymentData.tags || [],
            invoices: paymentData.invoices || [],
            invoice_numbers: (paymentData.invoices || []).map(
              (inv) => inv.invoice_id
            ),
            payment_type: paymentData.payment_type || "",
            payment_status: paymentData.payment_status || "",
            tax_account_id: paymentData.tax_account_id || "",
            tax_account_name: paymentData.tax_account_name || "",
            tax_amount_withheld: paymentData.tax_amount_withheld || 0,
            tax_amount_withheld_formatted: formatCurrency(
              paymentData.tax_amount_withheld
            ),
            bcy_refunded_amount: paymentData.bcy_refunded_amount || 0,
            bcy_refunded_amount_formatted: formatCurrency(
              paymentData.bcy_refunded_amount || 0
            ),
            bcy_unused_amount: paymentData.unused_amount || 0,
            bcy_unused_amount_formatted: formatCurrency(
              paymentData.unused_amount || 0
            ),
            bcy_amount: paymentData.amount || 0,
            bcy_amount_formatted: formatCurrency(paymentData.amount || 0),
          };
        })
      );

      return res.status(200).json({
        code: 0,
        message: "Payments fetched successfully",
        payments: transformedPayments,
        totalCount: totalCount,
        page_context: {
          page,
          per_page,
          has_more_page: hasMorePage,
          report_name: "Payments Received",
          applied_filter: filter,
          sort_column,
          sort_order,
        },
      });
    } catch (error) {
      console.error("getPaymentsReceived Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to fetch payments.",
      });
    }
  }
  // 📝 Get Individual Customer Payment and Customer Advance
  async getIndividualPaymentReceived(req, res) {
    try {
      const { organization_id, payment_id } = req.query;

      // Validate required query parameters
      if (!organization_id || !payment_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Unauthorized route" });
      }

      // Find payment record by payment_id
      let paymentData = await CustomerPaymentCollection.findOne({
        payment_id: payment_id,
        deleted_at: null,
      });
      console.log(paymentData, "paymentData");
      if (!paymentData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Payment not found..." });
      }

      // Resolve customer name from customer_id
      let customerName = paymentData.customer_name; // fallback to paymentData
      if (paymentData.customer_id) {
        const customerRecord = await CustomerCollection.findOne(
          {
            contact_id: paymentData.customer_id,
            deleted_at: null,
          },
          {
            contact_name: 1,
          }
        );
        if (customerRecord && customerRecord.contact_name) {
          customerName = customerRecord.contact_name;
        }
      }

      // console.log(customerName,"=============");
      // return

      // Find organization details
      const organizationData = await OrganizationCollection.findOne(
        {
          $or: [{ organization_id: organization_id }],
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
      console.log(organizationData, "organizationDataorganizationData");

      if (!organizationData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Organization not found..." });
      }

      // Transform payment data
      const transformedPayment = {
        payment_id: paymentData.payment_id,
        payment_number: paymentData.payment_number,
        place_of_supply: paymentData.place_of_supply,
        deposite_to: paymentData.deposite_to,
        bank_charges: paymentData.bank_charges,
        created_by: paymentData.created_by,
        created_time: paymentData.created_time,
        updated_time: paymentData.updated_time,
        customer_id: paymentData.customer_id,
        customer_name: customerName,
        payment_mode: paymentData.payment_mode,
        payment_date: paymentData.date,
        payment_number_prefix: paymentData.payment_number_prefix || "",
        payment_number_suffix: paymentData.payment_number_suffix || "",
        reference_number: paymentData.reference_number || "",
        amount: paymentData.bcy_amount || paymentData.amount || 0,
        amount_formatted:
          paymentData.bcy_amount_formatted ||
          paymentData.amount_formatted ||
          "",
        unused_amount:
          paymentData.bcy_unused_amount || paymentData.unused_amount || 0,
        unused_amount_formatted:
          paymentData.bcy_unused_amount_formatted ||
          paymentData.unused_amount_formatted ||
          "",
        bcy_refunded_amount: 0,
        bcy_refunded_amount_formatted: "₹0.00",
        account_id: paymentData.account_id,
        account_name: paymentData.account_name,
        description: paymentData.description || "",
        documents: paymentData.documents || [],
        tags: paymentData.tags || [],
        payment_type: paymentData.payment_type || "",
        payment_status: paymentData.payment_status,
        payment_status_formatted: paymentData.payment_status_formatted,
        tax_account_id: paymentData.tax_account_id || "",
        tax_account_name: paymentData.tax_account_name || "",
        tax_amount_withheld: paymentData.tax_amount_withheld || 0,
        tax_amount_withheld_formatted:
          paymentData.tax_amount_withheld_formatted || "₹0.00",
        is_advance_payment: paymentData.is_advance_payment || false,
        invoices: (paymentData.invoices || []).map((inv) => ({
          invoice_number: inv.invoice_number,
          invoice_id: inv.invoice_id,
          amount_applied: inv.amount_applied,
          amount_applied_formatted: inv.amount_applied_formatted,
          total: inv.total,
          total_formatted: inv.total_formatted,
          balance: inv.balance,
          balance_formatted: inv.balance_formatted,
          date: inv.date,
          date_formatted: inv.date_formatted,
          due_date: inv.due_date,
          due_date_formatted: inv.due_date_formatted,
        })),
        comments: (paymentData.comments || []).map((comment) => ({
          comment_id: comment.comment_id,
          description: comment.description,
          commented_by: comment.commented_by,
          date: comment.date,
          date_formatted: comment.date_formatted,
          operation_type: comment.operation_type,
          amount: comment.amount,
        })),
        journal_id: paymentData.journal_id,
      };

      // Combine with organization data
      const responseData = {
        ...transformedPayment,
        organization: organizationData.toObject(),
      };

      return res
        .status(ST_CODES.OK)
        .send({ message: "Successfully fetched", data: responseData });
    } catch (error) {
      console.error("getIndividualPaymentReceived error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong", error: error.message });
    }
  }
  async deleteCustomerPayment(req, res) {
    try {
      const { payment_id, organization_id } = req.query;

      // Validate required parameters
      if (!payment_id || !organization_id) {
        return res.status(400).json({
          status: false,
          message: "Payment ID and Organization ID are required",
        });
      }

      // Find the payment to be deleted
      const paymentToDelete = await CustomerPaymentCollection.findOne({
        payment_id: payment_id,
        organization_id: organization_id,
        deleted_at: null,
      });

      if (!paymentToDelete) {
        return res.status(404).json({
          status: false,
          message: "Payment not found or already deleted",
        });
      }

      // Array to store updated invoice information
      const updatedInvoices = [];

      // Update associated invoices if any
      if (
        Array.isArray(paymentToDelete.invoices) &&
        paymentToDelete.invoices.length > 0
      ) {
        for (const invoicePayment of paymentToDelete.invoices) {
          try {
            const invoiceId = invoicePayment.invoice_id;

            // Get the amount that was applied to this invoice
            const amountApplied = parseFloat(
              invoicePayment.amount_applied || 0
            );
            const taxWithheld = parseFloat(
              invoicePayment.tax_amount_withheld || 0
            );
            const totalApplied = amountApplied + taxWithheld;

            if (totalApplied <= 0) continue; // Skip if no amount was applied

            // Find the invoice
            const invoice = await InvoiceCollection.findOne({
              invoice_id: invoiceId,
              organization_id: organization_id,
            });

            if (invoice) {
              // Calculate the new balance
              const currentBalance = parseFloat(invoice.balance || 0);
              const newBalance = currentBalance + totalApplied;
              const invoiceTotal = parseFloat(invoice.total || 0);

              console.log(
                currentBalance,
                newBalance,
                invoiceTotal,
                "getting all the details "
              );

              // Determine the new payment status
              let newStatus, newStatusFormatted;
              if (newBalance >= invoiceTotal) {
                newStatus = "unpaid";
                newStatusFormatted = "Unpaid";
              } else if (newBalance > 0) {
                newStatus = "partially paid";
                newStatusFormatted = "Partially Paid";
              } else {
                newStatus = "paid";
                newStatusFormatted = "Paid";
              }

              // Remove this payment from the payments array
              const updatedPayments = invoice.payments.filter(
                (payment) => payment.payment_id !== payment_id
              );

              // Update the invoice
              const updatedInvoice = await InvoiceCollection.findOneAndUpdate(
                { invoice_id: invoiceId, organization_id },
                {
                  $set: {
                    balance: newBalance,
                    balance_formatted: `₹${newBalance.toFixed(2)}`,
                    status: newStatus,
                    status_formatted: newStatusFormatted,
                    payments: updatedPayments,
                  },
                },
                { new: true }
              );

              // Add the updated invoice to our response array
              updatedInvoices.push({
                invoice_id: invoiceId,
                invoice_number: updatedInvoice.invoice_number,
                new_balance: newBalance,
                new_balance_formatted: `₹${newBalance.toFixed(2)}`,
                new_status: newStatus,
                new_status_formatted: newStatusFormatted,
                amount_added_back: totalApplied,
                amount_added_back_formatted: `₹${totalApplied.toFixed(2)}`,
              });
            }
          } catch (error) {
            console.error(
              `Error updating invoice ${invoicePayment.invoice_id}:`,
              error.message
            );
          }
        }
      }

      // Delete the associated journal entry
      if (paymentToDelete.journal_id) {
        try {
          const journalDeleteResult = await JournalCollection.findOneAndDelete({
            journal_id: paymentToDelete.journal_id,
            organization_id: organization_id,
          });

          if (!journalDeleteResult) {
            console.warn(
              `Journal entry ${paymentToDelete.journal_id} not found for deletion`
            );
          } else {
            console.log(
              `Successfully deleted journal entry: ${paymentToDelete.journal_id}`
            );
          }
        } catch (error) {
          console.error("Error deleting journal entry:", error.message);
          return res.status(500).json({
            status: false,
            message: "Failed to delete associated journal entry",
            error: error.message,
          });
        }
      }

      // Perform soft delete on the payment
      const deletedPayment = await CustomerPaymentCollection.findOneAndUpdate(
        { payment_id: payment_id, organization_id },
        {
          $set: {
            deleted_at: new Date(),
            is_deleted: true,
            payment_status: "deleted",
            payment_status_formatted: "Deleted",
          },
        },
        { new: true }
      );

      if (!deletedPayment) {
        return res.status(404).json({
          status: false,
          message: "Failed to delete payment",
        });
      }

      // Return success response with updated invoice information
      return res.status(200).json({
        status: true,
        message: "Payment and associated journal entry deleted successfully",
        data: {
          deleted_payment: {
            payment_id: deletedPayment.payment_id,
            payment_number: deletedPayment.payment_number,
            amount: deletedPayment.amount,
            amount_formatted: deletedPayment.amount_formatted,
            deleted_at: deletedPayment.deleted_at,
          },
          deleted_journal_id: paymentToDelete.journal_id,
          updated_invoices: updatedInvoices,
        },
      });
    } catch (error) {
      console.error("Error deleting customer payment:", error);
      return res.status(500).json({
        status: false,
        message: "Failed to delete customer payment",
        error: error.message,
      });
    }
  }
  // 📝 Refund a Customer Payment
  async refundCustomerPayment(req, res) {
    try {
      const { payment_id, organization_id, refund_reason } = req.query;
      // Validate required parameters
      if (!payment_id || !organization_id) {
        return res.status(400).json({
          status: false,
          message: "Payment ID and Organization ID are required",
        });
      }
      // Find the payment to be refunded
      const paymentToRefund = await CustomerPaymentCollection.findOne({
        payment_id: payment_id,
        organization_id: organization_id,
        deleted_at: null,
      });

      if (!paymentToRefund) {
        return res.status(404).json({
          status: false,
          message: "Payment not found",
        });
      }

      // Check if payment is already refunded
      if (paymentToRefund.payment_status === "refunded") {
        return res.status(400).json({
          status: false,
          message: "Payment has already been refunded",
        });
      }

      // Array to store updated invoice information
      const updatedInvoices = [];

      // Handle based on payment type
      if (paymentToRefund.is_advance_payment === true) {
        // For advance payments, just mark as refunded
        // No invoices to update as it's an advance payment

        const refundedPayment =
          await CustomerPaymentCollection.findOneAndUpdate(
            { payment_id: payment_id, organization_id },
            {
              $set: {
                payment_status: "refunded",
                payment_status_formatted: "Refunded",
                refunded_at: new Date(),
                refund_reason: refund_reason || "Customer requested refund",
                unused_amount: 0,
                unused_amount_formatted: "₹0.00",
              },
            },
            { new: true }
          );

        return res.status(200).json({
          status: true,
          message: "Advance payment refunded successfully",
          data: {
            refunded_payment: {
              payment_id: refundedPayment.payment_id,
              payment_number: refundedPayment.payment_number,
              amount: refundedPayment.amount,
              amount_formatted: refundedPayment.amount_formatted,
              refunded_at: refundedPayment.refunded_at,
            },
          },
        });
      } else {
        // For regular payments: update associated invoices if any
        if (
          Array.isArray(paymentToRefund.invoices) &&
          paymentToRefund.invoices.length > 0
        ) {
          for (const invoicePayment of paymentToRefund.invoices) {
            try {
              const invoiceId = invoicePayment.invoice_id;

              // Get the amount that was applied to this invoice
              const amountApplied = parseFloat(
                invoicePayment.amount_applied || 0
              );

              if (amountApplied <= 0) continue; // Skip if no amount was applied

              // Find the invoice
              const invoice = await InvoiceCollection.findOne({
                invoice_id: invoiceId,
                organization_id: organization_id,
              });

              if (invoice) {
                // Calculate the new balance
                const currentBalance = parseFloat(invoice.balance || 0);
                const newBalance = currentBalance + amountApplied;
                const invoiceTotal = parseFloat(invoice.total || 0);

                // Determine the new payment status
                let newStatus, newStatusFormatted;
                if (newBalance >= invoiceTotal) {
                  newStatus = "unpaid";
                  newStatusFormatted = "Unpaid";
                } else if (newBalance > 0) {
                  newStatus = "partially paid";
                  newStatusFormatted = "Partially Paid";
                } else {
                  newStatus = "paid";
                  newStatusFormatted = "Paid";
                }

                // Update payment status in the payments array
                const updatedPayments = invoice.payments.map((payment) => {
                  if (payment.payment_id === payment_id) {
                    return {
                      ...payment,
                      status: "refunded",
                      refunded_at: new Date(),
                    };
                  }
                  return payment;
                });

                // Update the invoice
                const updatedInvoice = await InvoiceCollection.findOneAndUpdate(
                  { invoice_id: invoiceId, organization_id },
                  {
                    $set: {
                      balance: newBalance,
                      balance_formatted: `₹${newBalance.toFixed(2)}`,
                      status: newStatus,
                      status_formatted: newStatusFormatted,
                      payments: updatedPayments,
                    },
                  },
                  { new: true }
                );

                // Add the updated invoice to our response array
                updatedInvoices.push({
                  invoice_id: invoiceId,
                  invoice_number: updatedInvoice.invoice_number,
                  new_balance: newBalance,
                  new_balance_formatted: `₹${newBalance.toFixed(2)}`,
                  new_status: newStatus,
                  new_status_formatted: newStatusFormatted,
                  amount_refunded: amountApplied,
                  amount_refunded_formatted: `₹${amountApplied.toFixed(2)}`,
                });
              }
            } catch (error) {
              console.error(
                `Error updating invoice ${invoicePayment.invoice_id}:`,
                error.message
              );
            }
          }
        }

        // Update the payment record to reflect the refund
        const refundedPayment =
          await CustomerPaymentCollection.findOneAndUpdate(
            { payment_id: payment_id, organization_id },
            {
              $set: {
                payment_status: "refunded",
                payment_status_formatted: "Refunded",
                refunded_at: new Date(),
                refund_reason: refund_reason || "Customer requested refund",
                unused_amount: 0,
                unused_amount_formatted: "₹0.00",
              },
              $push: {
                comments: {
                  comment_id: new mongoose.Types.ObjectId(),
                  description: `Payment refunded. Reason: ${
                    refund_reason || "Customer requested refund"
                  }`,
                  commented_by: res.locals.user_id,
                  date: new Date(),
                  date_formatted: new Date().toLocaleDateString("en-US"),
                  operation_type: "refund",
                  amount: paymentToRefund.amount,
                },
              },
            },
            { new: true }
          );

        // Return success response with updated invoice information
        return res.status(200).json({
          status: true,
          message: "Payment refunded successfully",
          data: {
            refunded_payment: {
              payment_id: refundedPayment.payment_id,
              payment_number: refundedPayment.payment_number,
              amount: refundedPayment.amount,
              amount_formatted: refundedPayment.amount_formatted,
              refunded_at: refundedPayment.refunded_at,
            },
            updated_invoices: updatedInvoices,
          },
        });
      }
    } catch (error) {
      console.error("Error refunding customer payment:", error);
      return res.status(500).json({
        status: false,
        message: "Failed to refund customer payment",
        error: error.message,
      });
    }
  }
  async updateCustomerPayment(req, res) {
    try {
      const { payment_id, organization_id } = req.query;
      const updateData = req.body;

      // Validate required parameters
      if (!payment_id || !organization_id) {
        return res.status(400).json({
          status: false,
          message: "Payment ID and Organization ID are required",
        });
      }

      // Find the existing payment
      const existingPayment = await CustomerPaymentCollection.findOne({
        payment_id: payment_id,
        organization_id: organization_id,
        deleted_at: null,
      });

      if (!existingPayment) {
        return res.status(404).json({
          status: false,
          message: "Payment not found",
        });
      }

      // Track changes for audit
      const changes = [];
      const paymentUpdates = {};

      // If amount is being updated
      if (
        updateData.amount !== undefined &&
        updateData.amount !== existingPayment.amount
      ) {
        paymentUpdates.amount = updateData.amount;
        paymentUpdates.amount_formatted = `₹${parseFloat(
          updateData.amount
        ).toFixed(2)}`;

        changes.push({
          field: "amount",
          old_value: existingPayment.amount,
          old_value_formatted: existingPayment.amount_formatted,
          new_value: updateData.amount,
          new_value_formatted: paymentUpdates.amount_formatted,
        });
      }

      // Handle other basic field updates
      const basicFields = [
        "payment_mode",
        "reference_number",
        "date",
        "date_formatted",
        "notes",
        "account_id",
        "account_name",
        "description",
        "tags",
        "place_of_supply",
        "tax_account_name",
        "deposite_to",
        "bank_charges",
        "formType",
      ];

      basicFields.forEach((field) => {
        if (
          updateData[field] !== undefined &&
          updateData[field] !== existingPayment[field]
        ) {
          paymentUpdates[field] = updateData[field];
          changes.push({
            field: field,
            old_value: existingPayment[field],
            new_value: updateData[field],
          });
        }
      });

      // Update Journal Entry if amount, deposite_to, or formType changed
      if (
        updateData.amount !== undefined ||
        updateData.deposite_to !== undefined ||
        updateData.formType !== undefined ||
        updateData.date !== undefined ||
        updateData.date_formatted !== undefined
      ) {
        try {
          // Get the updated values or use existing ones
          const updatedAmount = updateData.amount || existingPayment.amount;
          const updatedDepositeTo =
            updateData.deposite_to || existingPayment.deposite_to;
          const updatedFormType =
            updateData.formType || existingPayment.formType;
          const updatedDate = updateData.date || existingPayment.date;
          const updatedDateFormatted =
            updateData.date_formatted || existingPayment.date_formatted;

          // Fetch COA details for the deposit account
          let fetchCOA = await COA_collection.aggregate([
            {
              $match: {
                organization_id: organization_id,
              },
            },
            {
              $unwind: {
                path: "$chart_of_accounts",
              },
            },
            {
              $match: {
                "chart_of_accounts.account_name": `${updatedDepositeTo}`,
              },
            },
          ]);

          if (fetchCOA.length > 0) {
            let COA_Detail = fetchCOA[0].chart_of_accounts;

            // Determine the credit account based on form type
            let coa_id = "AC_024";
            let coa_name = "Unearned Revenue";
            if (updatedFormType == "Invoice Payment") {
              coa_id = "AC_019";
              coa_name = "Accounts Receivable";
            }

            // Prepare updated journal line items
            const updatedJournalLineItems = [
              {
                coa_account_id: COA_Detail.account_id,
                coa_account_name: COA_Detail.account_name,
                creditOrDebit: "Debit",
                amount: updatedAmount,
                amount_formatted: commonHelper.formatRupee(updatedAmount),
              },
              {
                coa_account_id: coa_id,
                coa_account_name: coa_name,
                creditOrDebit: "Credit",
                amount: updatedAmount,
                amount_formatted: commonHelper.formatRupee(updatedAmount),
              },
            ];

            // Prepare journal update data
            const journalUpdateData = {
              organization_id: organization_id,
              admin_id: res.locals.user_id,
              journal_date: updatedDate,
              journal_date_formatted: updatedDateFormatted,
              total_amount: updatedAmount,
              total_amount_formatted: commonHelper.formatRupee(updatedAmount),
              type:
                updatedFormType == "Invoice Payment"
                  ? "Invoice Payment"
                  : "Customer Advance",
              customer_name:
                updateData.customer_name || existingPayment.customer_name,
              line_items: updatedJournalLineItems,
              updated_at: new Date(),
            };

            // Update the journal entry
            const updatedJournal = await JournalCollection.findOneAndUpdate(
              {
                journal_id: existingPayment.journal_id,
                organization_id: organization_id,
              },
              { $set: journalUpdateData },
              { new: true, runValidators: true }
            );

            if (updatedJournal) {
              console.log(
                `Journal ${existingPayment.journal_id} updated successfully`
              );
            } else {
              console.warn(
                `Journal ${existingPayment.journal_id} not found for update`
              );
            }
          } else {
            console.warn(
              `COA not found for deposit account: ${updatedDepositeTo}`
            );
          }
        } catch (journalError) {
          console.error("Error updating journal entry:", journalError);
          // Don't fail the entire operation if journal update fails
        }
      }

      // Handle invoices updates - the most complex part
      if (
        Array.isArray(updateData.invoices) &&
        updateData.invoices.length > 0
      ) {
        const updatedInvoices = [];

        // Use the existing amount or the updated amount if present
        // IMPORTANT: We're ensuring that even if amount is 0, we don't enforce the validation
        // This allows updating invoice balances directly
        let unusedAmount =
          updateData.amount !== undefined
            ? parseFloat(updateData.amount)
            : parseFloat(existingPayment.amount || 0);

        // Calculate total tax withheld
        let totalTaxWithheld = 0;

        // Calculate total applied amount for tracking purposes only
        const totalApplied = updateData.invoices.reduce(
          (sum, inv) => sum + parseFloat(inv.amount_applied || 0),
          0
        );

        // REMOVED the validation that was causing the issue
        // We're now allowing the total applied amount to exceed the payment amount
        // This is important for cases where you just want to update invoice balances

        // First, handle any existing invoices that need to be reverted
        if (
          Array.isArray(existingPayment.invoices) &&
          existingPayment.invoices.length > 0
        ) {
          for (const oldInvoice of existingPayment.invoices) {
            try {
              // Find if this invoice is in the updated list
              const updatedInvoiceData = updateData.invoices.find(
                (inv) => inv.invoice_id === oldInvoice.invoice_id
              );

              // If not in updated list or amount has changed, we need to revert the old effect first
              if (
                !updatedInvoiceData ||
                parseFloat(updatedInvoiceData.amount_applied || 0) !==
                  parseFloat(oldInvoice.amount_applied || 0) ||
                parseFloat(updatedInvoiceData.tax_amount_withheld || 0) !==
                  parseFloat(oldInvoice.tax_amount_withheld || 0)
              ) {
                // Fetch the invoice to update it
                const invoice = await InvoiceCollection.findOne({
                  invoice_id: oldInvoice.invoice_id,
                  organization_id: organization_id,
                });

                if (invoice) {
                  // Add back the old amount to the balance
                  const oldAppliedAmount = parseFloat(
                    oldInvoice.amount_applied || 0
                  );
                  const oldTaxWithheld = parseFloat(
                    oldInvoice.tax_amount_withheld || 0
                  );
                  const oldTotalApplied = oldAppliedAmount + oldTaxWithheld;

                  const currentBalance = parseFloat(invoice.balance || 0);
                  const invoiceTotal = parseFloat(invoice.total || 0);

                  // Calculate new balance but ensure it doesn't exceed the invoice total
                  let newBalance = currentBalance + oldTotalApplied; // Add back the old applied amount
                  if (newBalance > invoiceTotal) {
                    newBalance = invoiceTotal;
                    console.log(
                      `Balance adjusted for invoice ${oldInvoice.invoice_id}: capped at invoice total ${invoiceTotal}`
                    );
                  }

                  // Update the invoice balance - full revert of old payment
                  await InvoiceCollection.findOneAndUpdate(
                    { invoice_id: oldInvoice.invoice_id, organization_id },
                    {
                      $set: {
                        balance: newBalance,
                        balance_formatted: `₹${newBalance.toFixed(2)}`,
                        status:
                          newBalance >= invoiceTotal
                            ? "unpaid"
                            : "partially paid",
                        status_formatted:
                          newBalance >= invoiceTotal
                            ? "Unpaid"
                            : "Partially Paid",
                        // Status updated here to reflect the reversion
                      },
                    }
                  );
                }
              }
            } catch (error) {
              console.error(
                `Error processing old invoice ${oldInvoice.invoice_id}:`,
                error.message
              );
            }
          }
        }

        // Now apply the new invoice payments
        for (const invoice of updateData.invoices) {
          try {
            // Fetch the invoice to update
            const existingInvoice = await InvoiceCollection.findOne({
              invoice_id: invoice.invoice_id,
              organization_id: organization_id,
            });

            if (existingInvoice) {
              // Format values for display
              invoice.tax_amount_withheld_formatted =
                invoice.tax_amount_withheld
                  ? `₹${parseFloat(invoice.tax_amount_withheld).toFixed(2)}`
                  : "₹0.00";

              invoice.amount_applied_formatted = invoice.amount_applied
                ? `₹${parseFloat(invoice.amount_applied).toFixed(2)}`
                : "₹0.00";

              invoice.date = updateData.date || existingPayment.date;
              invoice.date_formatted =
                updateData.date_formatted || existingPayment.date_formatted;
              invoice.total = existingInvoice.total;
              invoice.total_formatted = existingInvoice.total_formatted;
              invoice.invoice_number = existingInvoice.invoice_number;

              // Calculate the new amount being applied
              const appliedAmount = parseFloat(invoice.amount_applied || 0);
              const taxWithheld = parseFloat(invoice.tax_amount_withheld || 0);
              const totalApplied = appliedAmount + taxWithheld;

              // Update running totals
              totalTaxWithheld += taxWithheld;
              // We're still tracking unusedAmount for recording purposes but not enforcing it
              unusedAmount -= appliedAmount;

              // Calculate new invoice balance
              const currentBalance = parseFloat(existingInvoice.balance || 0);
              const invoiceTotal = parseFloat(existingInvoice.total || 0);

              // Calculate new balance and ensure it doesn't go below zero
              let newBalance = currentBalance - totalApplied;
              if (newBalance < 0) {
                console.log(
                  `Warning: Invoice ${invoice.invoice_id} would have negative balance. Setting to zero.`
                );
                newBalance = 0;
              }

              // Ensure balance doesn't exceed invoice total
              if (newBalance > invoiceTotal) {
                newBalance = invoiceTotal;
                console.log(
                  `Balance adjusted for invoice ${invoice.invoice_id}: capped at invoice total ${invoiceTotal}`
                );
              }

              // Determine payment status
              let status, statusFormatted;
              if (newBalance <= 0) {
                status = "paid";
                statusFormatted = "Paid";
              } else if (newBalance >= invoiceTotal) {
                status = "unpaid";
                statusFormatted = "Unpaid";
              } else {
                status = "partially paid";
                statusFormatted = "Partially Paid";
              }

              // Check if payment already exists in the invoice's payments array
              const paymentExists =
                existingInvoice.payments &&
                existingInvoice.payments.some(
                  (p) => p.payment_id === payment_id
                );

              let updateOperation;
              if (paymentExists) {
                // Update the existing payment entry
                updateOperation = {
                  $set: {
                    balance: newBalance,
                    balance_formatted: `₹${newBalance.toFixed(2)}`,
                    status: status,
                    status_formatted: statusFormatted,
                    "payments.$[elem].amount_applied": appliedAmount,
                    "payments.$[elem].amount_applied_formatted":
                      invoice.amount_applied_formatted,
                    "payments.$[elem].tax_amount_withheld": taxWithheld,
                    "payments.$[elem].tax_amount_withheld_formatted":
                      invoice.tax_amount_withheld_formatted,
                  },
                };
              } else {
                // Add a new payment entry
                const paymentDetails = {
                  payment_id: payment_id,
                  payment_number: existingPayment.payment_number || "",
                  amount_applied: appliedAmount,
                  amount_applied_formatted: invoice.amount_applied_formatted,
                  tax_amount_withheld: taxWithheld,
                  tax_amount_withheld_formatted:
                    invoice.tax_amount_withheld_formatted,
                  date: invoice.date,
                  date_formatted: invoice.date_formatted,
                };

                updateOperation = {
                  $set: {
                    balance: newBalance,
                    balance_formatted: `₹${newBalance.toFixed(2)}`,
                    status: status,
                    status_formatted: statusFormatted,
                  },
                  $push: {
                    payments: paymentDetails,
                  },
                };
              }

              // Update the invoice
              const updatedInvoice = await InvoiceCollection.findOneAndUpdate(
                { invoice_id: invoice.invoice_id, organization_id },
                updateOperation,
                {
                  new: true,
                  arrayFilters: paymentExists
                    ? [{ "elem.payment_id": payment_id }]
                    : [],
                }
              );

              // Add to the updated invoices array
              updatedInvoices.push(invoice);
            }
          } catch (error) {
            console.error(
              `Error updating invoice ${invoice.invoice_id}:`,
              error.message
            );
          }
        }

        // Update payment details
        paymentUpdates.invoices = updatedInvoices;
        paymentUpdates.tax_amount_withheld = totalTaxWithheld;
        paymentUpdates.tax_amount_withheld_formatted = `₹${totalTaxWithheld.toFixed(
          2
        )}`;
        paymentUpdates.unused_amount = unusedAmount > 0 ? unusedAmount : 0;
        paymentUpdates.unused_amount_formatted = `₹${(unusedAmount > 0
          ? unusedAmount
          : 0
        ).toFixed(2)}`;
      }

      // Add standard update fields
      paymentUpdates.updated_time = new Date();
      paymentUpdates.updated_by = res.locals.user_id;

      // Add comment about the update if there are changes
      if (changes.length > 0) {
        const changeComment = {
          comment_id: await commonHelper.generateUniqueId(
            CustomerPaymentCollection,
            "comment_id",
            8,
            "CMT"
          ),
          description: `Payment was updated by ${res.locals.user_id}`,
          commented_by: res.locals.user_id,
          date: new Date(),
          date_formatted: new Date().toLocaleDateString(),
          operation_type: "update",
          changes: changes,
        };

        paymentUpdates.$push = { comments: changeComment };
      }

      // Update the payment record
      const updatedPayment = await CustomerPaymentCollection.findOneAndUpdate(
        { payment_id: payment_id, organization_id: organization_id },
        { $set: paymentUpdates },
        { new: true }
      );

      if (!updatedPayment) {
        return res.status(404).json({
          status: false,
          message: "Failed to update payment",
        });
      }

      // Return success response
      return res.status(200).json({
        status: true,
        message: "Payment updated successfully",
        data: updatedPayment,
      });
    } catch (error) {
      console.error("Error updating customer payment:", error);
      return res.status(500).json({
        status: false,
        message: "Failed to update customer payment",
        error: error.message,
      });
    }
  }
  // get invoice unique Id
  async getUniqueId(req, res) {
    try {
      let paymentNumber = await commonHelper.generateUniqueId(
        CustomerPaymentCollection,
        "payment_number",
        6,
        "CP"
      );
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Payment Id has been generated",
        data: paymentNumber,
      });
    } catch (err) {
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while generating payment id",
      });
    }
  }
  async verifyPayment(req, res) {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        paymentData,
      } = req.body;
      const { organization_id } = req.query;

      if (!organization_id) {
        return res.status(400).json({
          status: false,
          message: "Organization ID is required",
        });
      }

      console.log("Verification payload received:", {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        hasPaymentData: !!paymentData,
      });

      // Check if Razorpay secret is available
      if (!process.env.RAZORPAY_KEY_SECRET) {
        console.error(
          "RAZORPAY_KEY_SECRET is not defined in environment variables"
        );
        return res.status(500).json({
          status: false,
          message: "Server configuration error: Razorpay secret not found",
        });
      }

      // Verify Razorpay signature
      const crypto = require("crypto");
      const body = razorpay_order_id + "|" + razorpay_payment_id;

      console.log("Verifying signature with:", {
        body,
        secret_exists: !!process.env.RAZORPAY_KEY_SECRET,
        received_signature: razorpay_signature,
      });

      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

      console.log("Expected signature:", expectedSignature);
      console.log("Received signature:", razorpay_signature);

      if (expectedSignature !== razorpay_signature) {
        console.error("Signature verification failed");
        return res.status(400).json({
          status: false,
          message: "Invalid payment signature",
        });
      }

      console.log("Signature verified successfully");

      // Fetch payment details from Razorpay
      const razorpayPayment = await razorpayInstance.payments.fetch(
        razorpay_payment_id
      );
      console.log("Razorpay payment details:", razorpayPayment);

      if (razorpayPayment.status !== "captured") {
        return res.status(400).json({
          status: false,
          message: "Payment not captured",
        });
      }

      // Process and save payment data
      let bData = paymentData;

      // Assign core fields
      bData["organization_id"] = organization_id;
      bData["created_by"] = res.locals.user_id;
      bData["payment_status"] = "completed";
      bData["payment_status_formatted"] = "Completed";
      bData["unused_amount"] = bData.amount;
      bData["unused_amount_formatted"] = bData.amount_formatted;
      bData["exchange_rate"] = 1.0;
      bData["exchange_rate_formatted"] = "₹1.00";
      bData["currency_symbol"] = "₹";
      bData["currency_code"] = "INR";
      bData["created_time"] = new Date();
      bData["updated_time"] = new Date();

      // Add payment_made array
      bData.payment_made = [
        {
          payment_made_id: razorpayPayment.id,
          payment_made_date: new Date(),
          payment_made_date_formatted: new Date().toLocaleDateString("en-IN"),
          payment_made_amount: bData.amount,
          payment_made_amount_formatted: `₹${bData.amount.toFixed(2)}`,
          payment_made_status: razorpayPayment.status,
          payment_made_status_formatted: razorpayPayment.status,
          payment_order_id: razorpay_order_id,
          payment_method_type: razorpayPayment.method,
          payment_bank_id: razorpayPayment.bank || "",
        },
      ];

      // Tax and Invoice Processing
      if (Array.isArray(bData.invoices) && bData.invoices.length > 0) {
        const totalTaxWithheld = bData.invoices.reduce((sum, invoice) => {
          return (
            sum +
            (invoice.tax_amount_withheld
              ? parseFloat(invoice.tax_amount_withheld)
              : 0)
          );
        }, 0);

        bData["tax_amount_withheld"] = totalTaxWithheld;
        bData["tax_amount_withheld_formatted"] = `₹${totalTaxWithheld.toFixed(
          2
        )}`;

        for (const invoice of bData.invoices) {
          try {
            const existingInvoice = await InvoiceCollection.findOne({
              organization_id,
              invoice_id: invoice.invoice_id,
            });

            invoice["tax_amount_withheld_formatted"] =
              invoice.tax_amount_withheld
                ? "₹" + invoice.tax_amount_withheld
                : "";
            invoice["amount_applied_formatted"] = invoice.amount_applied
              ? "₹" + invoice.amount_applied
              : "";
            invoice["date"] = bData.date;
            invoice["date_formatted"] = bData.date_formatted;
            invoice["total"] = existingInvoice.total;
            invoice["total_formatted"] = existingInvoice.total_formatted;
            invoice["invoice_number"] = existingInvoice.invoice_number;
            invoice["balance"] = existingInvoice.balance;
            invoice["balance_formatted"] = existingInvoice.balance_formatted;

            if (existingInvoice) {
              const paymentAmount =
                parseFloat(invoice.amount_applied || 0) +
                parseFloat(invoice.tax_amount_withheld || 0);
              const currentBalance = parseFloat(existingInvoice.balance || 0);
              const newBalance = currentBalance - paymentAmount;

              const status = newBalance === 0 ? "paid" : "partially paid";
              const statusFormatted =
                newBalance === 0 ? "Paid" : "Partially Paid";

              const paymentDetails = {
                payment_id: bData.payment_id,
                payment_number: bData.payment_number || "",
              };

              await InvoiceCollection.findOneAndUpdate(
                { invoice_id: invoice.invoice_id, organization_id },
                {
                  $set: {
                    balance: newBalance,
                    balance_formatted: `₹${newBalance.toFixed(2)}`,
                    status,
                    status_formatted: statusFormatted,
                  },
                  $push: {
                    payments: paymentDetails,
                  },
                },
                { new: true }
              );
            }
          } catch (error) {
            console.error(
              `Error updating invoice ${invoice.invoice_id}:`,
              error.message
            );
          }
        }
      } else {
        bData["tax_amount_withheld"] = 0;
        bData["tax_amount_withheld_formatted"] = "₹0.00";
      }

      bData["tds_type"] = bData.tds_tax_account;

      // Fetch customer info
      if (bData.customer_id) {
        try {
          const [contactResponse] = await axios.all([
            apiHandler.getContactInformation(
              bData.customer_id,
              organization_id,
              req.headers.authorization
            ),
          ]);
          const responseData = contactResponse?.data?.data;
          if (responseData) {
            bData["gst_no"] = responseData.gst_no;
            bData["gst_treatment"] = responseData.gst_treatment;
            bData["place_of_supply"] = responseData.place_of_contact;
          }
        } catch (error) {
          console.error("Error fetching customer info:", error.message);
        }
      }
      // Save to DB
      console.log("Saving payment to database...");
      const customerPayment = await CustomerPaymentCollection.findOneAndUpdate(
        { payment_id: paymentData.payment_id },
        {
          $set: {
            ...bData, // <-- put actual fields to update here
          },
        },
        {
          upsert: false, // prevent insert if not found
          new: true, // return the updated document
        }
      );

      console.log("Payment saved successfully:", customerPayment.payment_id);

      return res.status(201).json({
        status: true,
        message: "Payment verified and recorded successfully",
        data: customerPayment,
      });
    } catch (error) {
      console.error("Error verifying payment:", error);
      return res.status(500).json({
        status: false,
        message: "Payment verification failed",
        error: error.message,
      });
    }
  }
  async createCustomerPayment(req, res) {
    try {
      let bData = req.body;
      const { organization_id } = req.query;

      // Validate organization_id
      if (!organization_id) {
        return res.status(400).json({
          status: false,
          message: "Organization ID is required",
        });
      }

      // Validate amount
      if (!bData.amount) {
        return res.status(400).json({
          status: false,
          message: "Amount is required",
        });
      }

      // Generate unique payment ID
      let paymentId = await commonHelper.generateUniqueId(
        CustomerPaymentCollection,
        "payment_id",
        6,
        "PR"
      );

      // Create Razorpay order
      const razorpayOrder = await razorpayInstance.orders.create({
        amount: Math.round(bData.amount * 100), // convert to paise
        currency: "INR",
        receipt: paymentId,
      });
      // Prepare payment data
      bData["payment_id"] = paymentId;
      bData["organization_id"] = organization_id;
      bData["date"] = bData.date;
      bData["date_formatted"] = bData.date_formatted;

      // Set default fields
      bData["created_by"] = res.locals.user_id;
      bData["payment_status"] = "pending"; // Set as pending until payment confirmation
      bData["payment_status_formatted"] = "Pending";
      bData["unused_amount"] = bData.amount;
      bData["unused_amount_formatted"] = bData.amount_formatted;
      bData["exchange_rate"] = 1.0;
      bData["exchange_rate_formatted"] = "₹1.00";
      bData["currency_symbol"] = "₹";
      bData["currency_code"] = "INR";
      bData["created_time"] = new Date();
      bData["updated_time"] = new Date();
      bData["razorpay_order_id"] = razorpayOrder.id;
      let fetchCOA = await COA_collection.aggregate([
        {
          $match: {
            organization_id: organization_id,
          },
        },
        {
          $unwind: {
            path: "$chart_of_accounts",
          },
        },
        {
          $match: {
            // "chart_of_accounts.is_active": true,
            "chart_of_accounts.account_name": `${bData.deposite_to}`,
          },
        },
      ]);
      let COA_Detail = fetchCOA[0].chart_of_accounts;
      // console.log("bData", bData);

      let journalUniqueId = await commonHelper.generateUniqueId(
        JournalCollection,
        "journal_id",
        5,
        "JL"
      );
      let coa_id = "AC_024";
      let coa_name = "Unearned Revenue";
      if (bData.formType == "Invoice Payment") {
        coa_id = "AC_019";
        coa_name = "Accounts Receivable";
      }
      const journalLineItems = [
        {
          coa_account_id: COA_Detail.account_id,
          coa_account_name: COA_Detail.account_name,
          creditOrDebit: "Debit",
          amount: bData.amount,
          amount_formatted: commonHelper.formatRupee(bData.amount),
        },
        {
          coa_account_id: coa_id,
          coa_account_name: coa_name,
          creditOrDebit: "Credit",
          amount: bData.amount,
          amount_formatted: commonHelper.formatRupee(bData.amount),
        },
      ];

      const journalData = {
        organization_id,
        admin_id: res.locals.user_id,
        journal_id: journalUniqueId,
        journal_date: bData.date,
        journal_date_formatted: bData.date_formatted,
        total_amount: bData.amount,
        total_amount_formatted: commonHelper.formatRupee(bData.amount),
        type:
          bData.formType == "Invoice Payment"
            ? "Invoice Payment"
            : "Customer Advance",
        customer_name: bData.customer_name,
        line_items: journalLineItems,
      };
      await JournalCollection.create(journalData);
      // Handle invoices if present
      if (Array.isArray(bData.invoices) && bData.invoices.length > 0) {
        const totalTaxWithheld = bData.invoices.reduce((sum, invoice) => {
          return (
            sum +
            (invoice.tax_amount_withheld
              ? parseFloat(invoice.tax_amount_withheld)
              : 0)
          );
        }, 0);

        // Set tax_amount_withheld and its formatted value
        bData["tax_amount_withheld"] = totalTaxWithheld;
        bData["tax_amount_withheld_formatted"] = `₹${totalTaxWithheld.toFixed(
          2
        )}`;

        // Process invoices data for later use (don't update invoices yet, wait for payment confirmation)
        for (const invoice of bData.invoices) {
          try {
            // Fetch existing invoice data
            const existingInvoice = await InvoiceCollection.findOne({
              organization_id: organization_id,
              invoice_id: invoice.invoice_id,
            });

            if (existingInvoice) {
              invoice["tax_amount_withheld_formatted"] =
                invoice.tax_amount_withheld
                  ? "₹" + invoice.tax_amount_withheld
                  : "";
              invoice["amount_applied_formatted"] = invoice.amount_applied
                ? "₹" + invoice.amount_applied
                : "";
              invoice["date"] = bData.date;
              invoice["date_formatted"] = bData.date_formatted;
              invoice["total"] = existingInvoice.total;
              invoice["total_formatted"] = existingInvoice.total_formatted;
              invoice["invoice_number"] = existingInvoice.invoice_number;
              invoice["balance"] = existingInvoice.balance;
              invoice["balance_formatted"] = existingInvoice.balance_formatted;
            }
          } catch (error) {
            console.error(
              `Error fetching invoice ${invoice.invoice_id}:`,
              error.message
            );
          }
        }
      } else {
        // If invoices array is empty, set defaults
        bData["tax_amount_withheld"] = 0;
        bData["tax_amount_withheld_formatted"] = "₹0.00";
      }

      bData["tds_type"] = bData.tds_tax_account;

      // Fetch customer information if customer_id exists
      if (bData.customer_id) {
        try {
          const [contactResponse] = await axios.all([
            apiHandler.getContactInformation(
              bData.customer_id,
              organization_id,
              req.headers.authorization
            ),
          ]);
          const responseData = contactResponse?.data?.data;
          if (responseData) {
            bData["gst_no"] = responseData.gst_no;
            bData["gst_treatment"] = responseData.gst_treatment;
            bData["place_of_supply"] = responseData.place_of_contact;
          }
        } catch (error) {
          console.error("Error fetching customer information:", error.message);
        }
      }

      // Create customer payment record with pending status
      bData["journal_id"] = journalUniqueId;
      const customerPayment = await CustomerPaymentCollection.create(bData);

      // Return order details to frontend
      return res.status(200).json({
        status: true,
        message: "Order created successfully",
        order: razorpayOrder,
        payment_id: paymentId,
        key: process.env.RAZORPAY_KEY_ID,
        paymentData: customerPayment,
      });
    } catch (error) {
      console.error("Error creating customerPayment:", error);
      return res.status(500).json({
        status: false,
        message: "Failed to create customerPayment",
        error: error.message,
      });
    }
  }
}

module.exports = new CustomerPaymentController();
