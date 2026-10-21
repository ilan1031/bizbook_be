// invoiceController.js
const mongoose = require("mongoose");
const JournalCollection = mongoose.model("Journal");
const InvoiceCollection = require("../model/invoice");
const EstimateCollection = require("../model/quotes");
const SalesOrderCollection = require("../model/salesOrder");
const PaymentCollection = require("../model/customerPayment");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");
const ST_CODES = require("../helpers/statusCodeHelpers");
const askGemini = require("../services/geminiService");
const apiHandler = require("../handler/api-handler");
const CustomerCollection = require("../model/contactModel");
const OrganizationCollection = require("../model/organizationSchema");
const { createInvoiceData, postInvoiceJournal } = require("../helpers/invoiceHelper");
const userActivityHelper = require("../helpers/userActivityHelper");
const { postingStatusFor, syncJournalPosting } = require("../helpers/accountingHelper");

const UserCollection = mongoose.model("user");
require("dotenv").config();

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return "₹0.00";
  return `₹${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

class InvoiceController {
  // 📌 Create a new invoice
  async createInvoice(req, res) {
    try {
      let invoiceData = req.body;
      const orgId = req.query.org_id;
      const admin_id = res.locals.user_id;

      // Validate required organization ID
      if (!orgId) {
        return res.status(400).json({
          success: false,
          message: "Organization ID is required",
        });
      }

      // Assign admin_id and organization_id
      invoiceData["admin_id"] = admin_id;
      invoiceData["organization_id"] = orgId;
      invoiceData["created_by_id"] = admin_id;
      invoiceData["last_modified_by_id"] = admin_id;

      // Handle file upload
      if (req.file) {
        invoiceData["documents"] = req.file.filename;
      }

      // Generate unique Invoice ID
      let invoiceUniqueId = await commonHelper.generateUniqueId(
        InvoiceCollection,
        "invoice_number",
        7,
        "INV"
      );
      invoiceData["invoice_number"] = invoiceUniqueId;

      // Generate unique invoice_id for internal reference
      const invoiceId = await commonHelper.generateUniqueId(
        InvoiceCollection,
        "invoice_id",
        6
      );
      invoiceData["invoice_id"] = invoiceId;

      // Set status defaults
      invoiceData["status"] = invoiceData.status || "draft";
      invoiceData["status_formatted"] = invoiceData.status_formatted || "Draft";

      // Set dates
      const currentDate = new Date();
      invoiceData["date"] = invoiceData.date || currentDate.toISOString();
      const parsedDate = new Date(invoiceData.date);
      invoiceData["date_formatted"] = parsedDate.toLocaleDateString("en-GB");

      const dueDate =
        invoiceData.due_date ||
        new Date(parsedDate.getTime() + 30 * 24 * 60 * 60 * 1000); // Add 30 days
      invoiceData["due_date"] = dueDate;
      invoiceData["due_date_formatted"] = new Date(dueDate).toLocaleDateString(
        "en-GB"
      );

      // Set defaults for optional fields
      const defaultFields = {
        customer_name: "",
        place_of_supply: "",
        order_number: "",
        vat_treatment: "",
        tax_treatment: "",
        is_reverse_charge_applied: false,
        gst_treatment: "",
        gst_no: "",
        cfdi_usage: "",
        reference_number: "",
        invoiced_estimate_id: "",
        salesperson_name: "",
        allow_partial_payments: false,
        custom_body: "",
        custom_subject: "",
        shipping_charge: 0,
        adjustment: 0,
        adjustment_description: "",
        reason: "",
        tax_authority_id: "",
        tax_exemption_id: "",
        billing_address_id: "",
        shipping_address_id: "",
        avatax_use_code: "",
        avatax_exempt_no: "",
        tax_id: invoiceData.tcs_id || invoiceData.tds_id || "",
        expense_id: "",
        salesorder_item_id: "",
        avatax_tax_code: "",
        time_entry_ids: [],
        discount_amount: 0,
        discount_percent: 0,
        tax_type: "",
        payment_terms_label: "",
        payment_terms: "",
        tds_option: "",
        payment_made: 0,
        credits_applied: 0,
      };

      // Apply defaults for undefined fields
      for (const key in defaultFields) {
        if (invoiceData[key] === undefined) {
          invoiceData[key] = defaultFields[key];
        }
      }

      const formatCurrency = (amount) => {
        return `₹${Number(amount).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      };

      // Handle line items calculation
      let calculatedSubTotal = 0;
      if (
        Array.isArray(invoiceData.line_items) &&
        invoiceData.line_items.length > 0
      ) {
        invoiceData.line_items.forEach((item) => {
          // Generate line item ID if not present
          if (!item.line_item_id) {
            item.line_item_id = Math.random().toString(36).substring(2, 15);
          }

          const quantity = Number(item.quantity || 0);
          const rate = Number(item.rate || 0);
          const lineTotal = quantity * rate;

          item.item_total = lineTotal;
          item.item_total_formatted = formatCurrency(lineTotal);
          item.item_total_inclusive_of_tax = lineTotal;
          item.item_total_inclusive_of_tax_formatted =
            formatCurrency(lineTotal);

          // Progress invoice details
          item.progress_invoice_details = {
            invoiced_quantity: 0,
            invoiced_quantity_formatted: "0.00",
            invoiced_value: 0,
            invoiced_value_formatted: "₹0.00",
            balance_amount: lineTotal,
            balance_amount_formatted: formatCurrency(lineTotal),
            is_invoiced: false,
          };

          // Handle tags
          item.tags = Array.isArray(item.tags)
            ? item.tags.filter(
                (tag) =>
                  typeof tag.tag_id === "number" &&
                  typeof tag.tag_option_id === "number"
              )
            : [];

          calculatedSubTotal += lineTotal;
        });
      }

      // Use calculated subtotal or provided subtotal
      const sub_total = Number(invoiceData.sub_total || calculatedSubTotal);
      const discount = Number(invoiceData.discount_amount || 0);
      const adjustment = Number(invoiceData.adjustment || 0);
      const tax_percentage = Number(invoiceData.tax_percentage || 0);
      const tax_type = invoiceData.tax_type; // "TDS" or "TCS"
      const shipping_charge = Number(invoiceData.shipping_charge || 0);

      // Calculate discount if percentage is provided
      let discountAmount = discount;
      if (
        invoiceData.discount_type === "percentage" &&
        invoiceData.discount_percent
      ) {
        discountAmount =
          (sub_total * Number(invoiceData.discount_percent)) / 100;
      }

      // Calculate tax amount
      const tax_amount = (tax_percentage / 100) * (sub_total - discountAmount);

      // Calculate total receivable
      const total_receivable =
        sub_total -
        discountAmount +
        (tax_type === "TCS" ? tax_amount : -tax_amount) +
        adjustment +
        shipping_charge;

      // Set calculated values
      invoiceData["sub_total"] = sub_total;
      invoiceData["sub_total_formatted"] = formatCurrency(sub_total);
      invoiceData["bcy_sub_total"] = sub_total;

      invoiceData["discount_amount"] = discountAmount;
      invoiceData["discount_total"] = discountAmount;
      invoiceData["discount_total_formatted"] = formatCurrency(discountAmount);
      invoiceData["bcy_discount_total"] = discountAmount;

      const subTotalAfterDiscount = sub_total - discountAmount;
      invoiceData["sub_total_exclusive_of_discount"] = subTotalAfterDiscount;
      invoiceData["sub_total_exclusive_of_discount_formatted"] = formatCurrency(
        subTotalAfterDiscount
      );

      invoiceData["tax_total"] = tax_amount;
      invoiceData["tax_total_formatted"] = formatCurrency(tax_amount);
      invoiceData["bcy_tax_total"] = tax_amount;

      invoiceData["total"] = total_receivable;
      invoiceData["total_formatted"] = formatCurrency(total_receivable);
      invoiceData["bcy_total"] = total_receivable;

      // Calculate balance
      const paymentMade = Number(invoiceData.payment_made || 0);
      const creditsApplied = Number(invoiceData.credits_applied || 0);
      const balance = total_receivable - paymentMade - creditsApplied;
      invoiceData["balance"] = balance;
      invoiceData["balance_formatted"] = formatCurrency(balance);

      // Generate unique Journal ID
      let journalUniqueId = await commonHelper.generateUniqueId(
        JournalCollection,
        "journal_id",
        5,
        "JL"
      );

      // Create Journal Line Items
      const Journal_line_items = [
        {
          coa_account_id: "AC_046",
          coa_account_name: "Sales",
          creditOrDebit: "Credit",
          amount: sub_total,
          amount_formatted: formatCurrency(sub_total),
        },
      ];

      // Add tax-specific entry
      if (tax_type === "TCS" && tax_amount > 0) {
        Journal_line_items.push({
          coa_account_id: "AC_025",
          coa_account_name: "TCS Payable",
          creditOrDebit: "Credit",
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
      if (discountAmount > 0) {
        Journal_line_items.push({
          coa_account_id: "AC_050",
          coa_account_name: "Discount",
          creditOrDebit: "Debit",
          amount: discountAmount,
          amount_formatted: formatCurrency(discountAmount),
        });
      }

      // Add shipping charge if any
      if (shipping_charge > 0) {
        Journal_line_items.push({
          coa_account_id: "AC_045",
          coa_account_name: "Shipping Charge",
          creditOrDebit: "Credit",
          amount: shipping_charge,
          amount_formatted: formatCurrency(shipping_charge),
        });
      }

      // Add adjustment if any
      if (adjustment !== 0) {
        Journal_line_items.push({
          coa_account_id: "AC_044",
          coa_account_name: "Other Charges",
          creditOrDebit: adjustment > 0 ? "Credit" : "Debit",
          amount: Math.abs(adjustment),
          amount_formatted: formatCurrency(Math.abs(adjustment)),
        });
      }

      // Final receivable entry
      Journal_line_items.push({
        coa_account_id: "AC_019",
        coa_account_name: "Accounts Receivable",
        creditOrDebit: "Debit",
        amount: total_receivable,
        amount_formatted: formatCurrency(total_receivable),
      });

      // Create journal data
      const journalData = {
        organization_id: orgId,
        admin_id: admin_id,
        journal_id: journalUniqueId,
        journal_date: invoiceData.date,
        journal_date_formatted: commonHelper.formatDateString(invoiceData.date),
        total_amount: total_receivable,
        total_amount_formatted: formatCurrency(total_receivable),
        type: "Invoice",
        customer_name: invoiceData.customer_name,
        line_items: Journal_line_items,
        // A draft invoice isn't in the books until it's sent.
        posting_status: postingStatusFor(invoiceData.status),
      };

      // Add journal_id to invoice data
      invoiceData["journal_id"] = journalUniqueId;

      console.log("The Journal Data", journalData);

      // Save journal entry
      const savedJournal = await JournalCollection.create(journalData);

      // Create invoice using queryHelper
      let createInvoice = await queryHelper.insertData(
        InvoiceCollection,
        invoiceData
      );

      // Log user activity
      await userActivityHelper(
        admin_id,
        orgId,
        invoiceData.customer_id,
        `Invoice created for ${formatCurrency(total_receivable)}`,
        "Invoice created",
        createInvoice.msg._id,
        "Invoice"
      );

      console.log("The Data saved for the Invoice", invoiceData);

      return res.status(ST_CODES.CREATED).json({
        success: true,
        message: "Invoice created successfully.",
        data: createInvoice.msg,
        journalData: savedJournal,
      });
    } catch (error) {
      console.log("createInvoice error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to create invoice. Please try again later.",
      });
    }
  }
  // 📌 Get all invoices with pagination
  async getInvoices(req, res) {
    try {
      console.log("Fetching Invoices...");
      let {
        limit = 10,
        per_page = 10,
        page = 1,
        sort_column = "date",
        sort_order = "D",
        filter_by = "",
        txn = false,
        customer_id = null,
      } = req.query;

      const { organization_id } = req.query;

      if (!organization_id) {
        return res.status(400).json({
          code: 1,
          message: "Missing required parameter: organization_id",
        });
      }

      limit = parseInt(limit, 10);
      page = parseInt(page, 10);

      const query = {
        organization_id: organization_id,
        deleted_at: null,
      };

      // Status filters (excluding Status.Overdue)
      if (filter_by && filter_by !== "Status.Overdue") {
        switch (filter_by) {
          case "Status.All":
            break;
          case "Status.Draft":
            query.status = "draft";
            break;
          case "Status.Locked":
            query.status = "locked";
            break;
          case "Status.Pending":
            query.status = "pendingapproval";
            break;
          case "Status.Approved":
            query.status = "approved";
            break;
          case "Status.Viewed":
            query.status = "customerviewed";
            break;
          case "Status.Paid":
            query.status = "paid";
            break;
          case "Status.Partially_Paid":
            query.status = "partially paid";
            break;
          case "Status.Unpaid":
            query.status = { $ne: "paid" };
            break;
          case "Status.PaymentInitiated":
            query.status = "payment initiated";
            break;
          case "Status.Void":
            query.status = "void";
            break;
          case "Status.DebitNote":
            query.status = "debitnote";
            break;
          case "Status.WriteOff":
            query.status = "writeoff";
            break;
          default:
            console.log("Unknown Filter:", filter_by);
            break;
        }
      }

      if (customer_id) {
        query.customer_id = customer_id;
      }

      if (txn === "true") {
        query.txn = true;
      }

      const allowedSortColumns = [
        "customer_name",
        "date",
        "due_date",
        "reference_number",
        "invoice_number",
        "total",
        "balance",
      ];

      // Define sorting order
      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "date";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      const projection = {
        _id: 1,
        invoice_id: 1,
        zcrm_potential_id: 1,
        customer_id: 1,
        customer_name: 1,
        company_name: 1,
        status: 1,
        status_formatted: 1,
        invoice_number: 1,
        reference_number: 1,
        date: 1,
        date_formatted: 1,
        due_date: 1,
        due_date_formatted: 1,
        email: 1,
        type: 1,
        type_formatted: 1,
        billing_address: 1,
        shipping_address: 1,
        total: 1,
        total_formatted: 1,
        balance: 1,
        balance_formatted: 1,
        payment_expected_date: 1,
        payment_expected_date_formatted: 1,
        custom_fields: 1,
        custom_field_hash: 1,
        tags: 1,
        salesperson_name: 1,
        shipping_charge: 1,
        shipping_charge_formatted: 1,
        adjustment: 1,
        adjustment_formatted: 1,
        created_time: 1,
        last_modified_time: 1,
        is_viewed_by_client: 1,
        has_attachment: 1,
        tax_total: 1,
        tax_type: 1,
        documents: 1,
      };

      const page1 = parseInt(req.query.page) || 1;
      const limit1 = parseInt(req.query.limit) || 10;

      let allInvoices = [];

      if (filter_by === "Status.Overdue") {
        // Fetch ALL matching invoices, no limit
        const result = await queryHelper.findData(
          InvoiceCollection,
          query,
          projection,
          sort,
          0,
          1
        );
        allInvoices = result.status ? result.msg : [];
      } else {
        // Apply DB pagination for other filters
        const result = await queryHelper.findData(
          InvoiceCollection,
          query,
          projection,
          sort,
          limit1,
          page1
        );
        allInvoices = result.status ? result.msg : [];
      }

      let filteredInvoices = allInvoices;

      if (filter_by === "Status.Overdue") {
        const today = new Date();
        filteredInvoices = allInvoices.filter((invoice) => {
          const dueDate = new Date(invoice.due_date);
          const dayDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
          return invoice.status === "sent" && dayDiff < 0;
        });
      }

      let paginatedInvoices = [];
      let totalCount = 0;
      let hasMorePage = false;

      if (filter_by === "Status.Overdue") {
        totalCount = filteredInvoices.length;
        const start = (page - 1) * limit;
        const end = start + limit;
        paginatedInvoices = filteredInvoices.slice(start, end);
        hasMorePage = end < totalCount;
      } else {
        paginatedInvoices = filteredInvoices;
        totalCount = await queryHelper.countDocuments(InvoiceCollection, query);
        hasMorePage = page * limit < totalCount;
      }

      const today = new Date();

      const transformedInvoices = paginatedInvoices.map((invoice) => {
        const dueDate = new Date(invoice.due_date);
        const timeDiff = dueDate - today;
        const dayDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        let due_days = "";
        let status = invoice.status || "";
        let status_formatted = invoice.status_formatted || "";

        if (!isNaN(dueDate) && invoice.status === "sent") {
          if (dayDiff < 0) {
            due_days = `Overdue by ${Math.abs(dayDiff)} days`;
            status = "overdue";
            status_formatted = "Overdue";
          } else {
            due_days = `Due in ${dayDiff} days`;
          }
        }

        return {
          _id: invoice._id,
          ach_payment_initiated: false,
          ach_payment_initiated_formatted: false,
          invoice_id: invoice.invoice_id || "",
          zcrm_potential_id: invoice.zcrm_potential_id || "",
          customer_id: invoice.customer_id || "",
          zcrm_potential_name: invoice.zcrm_potential_name || "",
          customer_name: invoice.customer_name || "",
          company_name: invoice.company_name || "",
          status,
          status_formatted,
          invoice_number: invoice.invoice_number || "",
          reference_number: invoice.reference_number || "",
          date: invoice.date || "",
          date_formatted: invoice.date_formatted || "",
          due_date: invoice.due_date || "",
          due_date_formatted: invoice.due_date_formatted || "",
          due_days,
          email: invoice.email || "",
          type_formatted: invoice.type_formatted || "",
          type: invoice.type || "",
          billing_address: invoice.billing_address || {},
          shipping_address: invoice.shipping_address || {},
          total: invoice.total || 0,
          total_formatted: invoice.total_formatted || "",
          balance: invoice.balance || 0,
          balance_formatted: invoice.balance_formatted || "",
          payment_expected_date: invoice.payment_expected_date || "",
          payment_expected_date_formatted:
            invoice.payment_expected_date_formatted || "",
          custom_fields: invoice.custom_fields || [],
          custom_field_hash: invoice.custom_field_hash || {},
          tags: invoice.tags || [],
          salesperson_name: invoice.salesperson_name || "",
          shipping_charge: invoice.shipping_charge || 0,
          shipping_charge_formatted: invoice.shipping_charge_formatted || "",
          adjustment: invoice.adjustment || 0,
          adjustment_formatted: invoice.adjustment_formatted || "",
          created_time: invoice.created_time || "",
          last_modified_time: invoice.last_modified_time || "",
          is_viewed_by_client: !!invoice.is_viewed_by_client,
          has_attachment: !!invoice.has_attachment,
          tax_total: invoice.tax_total || 0,
          tax_type: invoice.tax_type || "",
          documents: invoice.documents || null,
        };
      });

      return res.status(200).json({
        code: 0,
        message: "success",
        invoices: transformedInvoices,
        totalCount: totalCount,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage,
          report_name: "Invoices",
          applied_filter: filter_by,
          custom_fields: [],
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      console.error("getInvoices Error:", error.message);
      return res.status(500).json({
        code: 1,
        message:
          "Internal Server Error: Unable to fetch invoices. Please try again later.",
      });
    }
  }
  // 📌 Get single invoice by ID
  async getInvoiceById(req, res) {
    try {
      const { organization_id } = req.query;
      const { invoice_id } = req.params;

      // Validate required parameters
      if (!organization_id || !invoice_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and invoice_id",
        });
      }

      // Fetch the invoice from the database
      const invoice = await InvoiceCollection.findOne({
        organization_id,
        invoice_id,
        deleted_at: null,
      }).lean();

      // Check if invoice exists
      if (!invoice) {
        return res.status(404).json({
          code: 1,
          message: "Invoice not found or unauthorized access",
        });
      }

      // Calculate due_days and update status if needed
      const today = new Date();
      const dueDate = new Date(invoice.due_date);
      const timeDiff = dueDate - today;
      const dayDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

      let due_days = "";
      let status = invoice.status || "";
      let status_formatted = invoice.status_formatted || "";

      if (!isNaN(dueDate) && status === "sent") {
        if (dayDiff < 0) {
          due_days = `Overdue by ${Math.abs(dayDiff)} days`;
          status = "overdue";
          status_formatted = "Overdue";
        } else {
          due_days = `Due in ${dayDiff} days`;
        }
      }

      // Attach computed fields to invoice
      invoice.due_days = due_days;
      invoice.status = status;
      invoice.status_formatted = status_formatted;

      // Fetch sales order if salesorder_id exists
      let salesOrderData = [];
      if (invoice.salesorder_id) {
        const salesOrder = await SalesOrderCollection.findOne({
          organization_id,
          _id: Object(invoice.salesorder_id),
          deleted_at: null,
        }).lean();

        if (salesOrder) {
          salesOrderData.push(salesOrder);
        }
      }
      console.log(invoice.payments, "0000");
      if (invoice.payments.length !== 0) {
        console.log(invoice.payments, "1111");
        for (const payment of invoice.payments) {
          try {
            console.log(payment.payment_id, "2222");
            const paymentReceived = await PaymentCollection.findOne({
              organization_id,
              payment_id: payment.payment_id,
            });
            console.log(paymentReceived, "paymentReceived");
            if (paymentReceived) {
              payment["date"] = paymentReceived.date_formatted;
              payment["payment_number"] = paymentReceived.payment_number;
              payment["reference_number"] = paymentReceived.reference_number;
              payment["payment_mode"] = paymentReceived.payment_mode;
              payment["amount"] = paymentReceived.amount_formatted;
            }
          } catch (error) {
            console.error(
              `Error fetch payments ${payment.payment_id}:`,
              error.message
            );
          }
        }
      }

      invoice.salesorders = salesOrderData;

      let organization = null;
      try {
        organization = await OrganizationCollection.findOne(
          { organization_id },
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
            _id: 0, // Exclude _id field
          }
        ).lean();

        // Explicitly check if organization was found
        if (!organization) {
          //     return res.status(ST_CODES.ORG_NOT_FOUND).send({
          //       success: true,
          //       message: MESSAGES.ORG_NOT_FOUND,
          //     });
          //   }
          // } catch (dbError) {
          //   console.error("Organization Fetch Error:", dbError);
          //   return res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
          //     success: false,
          //     message: "Error fetching organization details",
          //   });
          console.warn(`Organization with ID ${organization_id} not found`);
        }
      } catch (dbError) {
        console.error("Organization Fetch Error:", dbError);
      }

      // Respond with enriched invoice and linked sales order
      return res.status(200).json({
        code: 0,
        message: "Invoice retrieved successfully",
        invoice: invoice,
        organization: organization,
      });
    } catch (error) {
      console.error("getInvoiceById Error:", error.message);
      return res.status(500).json({
        code: 1,
        message:
          "Internal Server Error: Unable to fetch invoice. Please try again later.",
      });
    }
  }
  // 📌 Get email logs with pagination
  async updateInvoice(req, res) {
    try {
      const { organization_id, invoice_id } = req.query;
      const admin_id = res.locals.user_id;
      let updateData = { ...req.body };

      // Handle file upload
      let documents = updateData.documents;
      if (req.file) {
        documents = req.file.filename;
      }
      updateData["documents"] = documents;

      // Validate required query params
      if (!organization_id || !invoice_id) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required parameters: organization_id and invoice_id",
        });
      }

      // Validate admin_id
      if (!admin_id) {
        return res.status(401).json({
          success: false,
          message: "User authentication required",
        });
      }

      // Find existing invoice
      let invoice = await InvoiceCollection.findOne({
        invoice_id,
        organization_id,
        deleted_at: null,
      });

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: "Unauthorized or invoice not found",
        });
      }

      // Add admin_id and organization_id to update data
      updateData["admin_id"] = admin_id;
      updateData["organization_id"] = organization_id;
      updateData["last_modified_by_id"] = admin_id;
      updateData["updated_at"] = new Date();

      // Currency formatting function
      const formatCurrency = (amount) => {
        return `₹${Number(amount).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      };

      // ✅ Recalculate totals using the same logic as createInvoice
      if (updateData.line_items && updateData.line_items.length > 0) {
        let subTotal = 0;

        // Calculate sub-total from line items
        updateData.line_items.forEach((item) => {
          // Generate line item ID if not present
          if (!item.line_item_id) {
            item.line_item_id = Math.random().toString(36).substring(2, 15);
          }

          const quantity = Number(item.quantity || 0);
          const rate = Number(item.rate || 0);
          const discount = Number(item.discount || 0);

          // Calculate line total considering discount
          const lineTotal = quantity * rate * (1 - discount / 100);

          item.item_total = lineTotal;
          item.item_total_formatted = formatCurrency(lineTotal);
          item.item_total_inclusive_of_tax = lineTotal;
          item.item_total_inclusive_of_tax_formatted =
            formatCurrency(lineTotal);

          // Progress invoice details
          item.progress_invoice_details = {
            invoiced_quantity: 0,
            invoiced_quantity_formatted: "0.00",
            invoiced_value: 0,
            invoiced_value_formatted: "₹0.00",
            balance_amount: lineTotal,
            balance_amount_formatted: formatCurrency(lineTotal),
            is_invoiced: false,
          };

          // Handle tags
          item.tags = Array.isArray(item.tags)
            ? item.tags.filter(
                (tag) =>
                  typeof tag.tag_id === "number" &&
                  typeof tag.tag_option_id === "number"
              )
            : [];

          subTotal += lineTotal;
        });

        updateData["sub_total"] = subTotal;
        updateData["sub_total_formatted"] = formatCurrency(subTotal);
        updateData["bcy_sub_total"] = subTotal;
      }

      // ✅ Use existing values or updated values for calculations
      const sub_total = Number(updateData.sub_total || invoice.sub_total || 0);
      const discount = Number(
        updateData.discount_amount || invoice.discount_amount || 0
      );
      const adjustment = Number(
        updateData.adjustment || invoice.adjustment || 0
      );
      const shipping_charge = Number(
        updateData.shipping_charge || invoice.shipping_charge || 0
      );
      const tax_percentage = Number(
        updateData.tax_percentage || invoice.tax_percentage || 0
      );
      const tax_type = updateData.tax_type || invoice.tax_type || "";

      // Calculate discount if percentage is provided
      let discountAmount = discount;
      if (
        updateData.discount_type === "percentage" &&
        updateData.discount_percent
      ) {
        discountAmount =
          (sub_total * Number(updateData.discount_percent)) / 100;
      }

      // Calculate tax amount using same logic as createInvoice
      const tax_amount = (tax_percentage / 100) * (sub_total - discountAmount);

      // Calculate total receivable using same logic as createInvoice
      const total_receivable =
        sub_total -
        discountAmount +
        (tax_type === "TCS" ? tax_amount : -tax_amount) +
        adjustment +
        shipping_charge;

      // Update calculated values
      updateData["discount_amount"] = discountAmount;
      updateData["discount_total"] = discountAmount;
      updateData["discount_total_formatted"] = formatCurrency(discountAmount);
      updateData["bcy_discount_total"] = discountAmount;

      const subTotalAfterDiscount = sub_total - discountAmount;
      updateData["sub_total_exclusive_of_discount"] = subTotalAfterDiscount;
      updateData["sub_total_exclusive_of_discount_formatted"] = formatCurrency(
        subTotalAfterDiscount
      );

      updateData["tax_total"] = tax_amount;
      updateData["tax_total_formatted"] = formatCurrency(tax_amount);
      updateData["bcy_tax_total"] = tax_amount;

      updateData["total"] = total_receivable;
      updateData["total_formatted"] = formatCurrency(total_receivable);
      updateData["bcy_total"] = total_receivable;

      // Calculate balance considering payments and credits
      const paymentMade = Number(
        updateData.payment_made || invoice.payment_made || 0
      );
      const creditsApplied = Number(
        updateData.credits_applied || invoice.credits_applied || 0
      );
      const balance = total_receivable - paymentMade - creditsApplied;

      updateData["balance"] = balance;
      updateData["balance_formatted"] = formatCurrency(balance);

      // ✅ Prepare Journal Line Items using same structure as createInvoice
      const Journal_line_items = [
        {
          coa_account_id: "AC_046",
          coa_account_name: "Sales",
          creditOrDebit: "Credit",
          amount: sub_total,
          amount_formatted: formatCurrency(sub_total),
        },
      ];

      // Add tax-specific entry
      if (tax_type === "TCS" && tax_amount > 0) {
        Journal_line_items.push({
          coa_account_id: "AC_025",
          coa_account_name: "TCS Payable",
          creditOrDebit: "Credit",
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
      if (discountAmount > 0) {
        Journal_line_items.push({
          coa_account_id: "AC_050",
          coa_account_name: "Discount",
          creditOrDebit: "Debit",
          amount: discountAmount,
          amount_formatted: formatCurrency(discountAmount),
        });
      }

      // Add shipping charge if any
      if (shipping_charge > 0) {
        Journal_line_items.push({
          coa_account_id: "AC_045",
          coa_account_name: "Shipping Charge",
          creditOrDebit: "Credit",
          amount: shipping_charge,
          amount_formatted: formatCurrency(shipping_charge),
        });
      }

      // Add adjustment if any
      if (adjustment !== 0) {
        Journal_line_items.push({
          coa_account_id: "AC_044",
          coa_account_name: "Other Charges",
          creditOrDebit: adjustment > 0 ? "Credit" : "Debit",
          amount: Math.abs(adjustment),
          amount_formatted: formatCurrency(Math.abs(adjustment)),
        });
      }

      // Final receivable entry
      Journal_line_items.push({
        coa_account_id: "AC_019",
        coa_account_name: "Accounts Receivable",
        creditOrDebit: "Debit",
        amount: total_receivable,
        amount_formatted: formatCurrency(total_receivable),
      });

      // ✅ Prepare journal update data (keeping same journal_id)
      const updatedJournal = {
        organization_id: organization_id,
        admin_id: admin_id,
        journal_date: updateData.date || invoice.date,
        journal_date_formatted:
          updateData.date_formatted || invoice.date_formatted,
        total_amount: total_receivable,
        total_amount_formatted: formatCurrency(total_receivable),
        customer_name: updateData.customer_name || invoice.customer_name,
        line_items: Journal_line_items,
        type: "Invoice",
        posting_status: postingStatusFor(updateData.status || invoice.status),
        updated_at: new Date(),
      };

      console.log("Updated Journal Data:", updatedJournal);

      // ✅ Update the existing journal entry. Without a journal_id the filter
      // would match some other journal of the organisation, so never query
      // with it missing.
      const updateJournal = invoice.journal_id
        ? await JournalCollection.findOneAndUpdate(
            {
              journal_id: invoice.journal_id,
              organization_id: organization_id,
            },
            { $set: updatedJournal },
            { new: true, runValidators: true }
          )
        : null;

      if (!updateJournal) {
        console.warn(
          `Journal entry not found for invoice ${invoice_id} with journal_id ${invoice.journal_id}`
        );
        // Don't fail the entire update if journal is not found, just log it
      }

      // ✅ Update the invoice directly using findOneAndUpdate
      const updatedInvoice = await InvoiceCollection.findOneAndUpdate(
        {
          invoice_id: invoice_id,
          organization_id: organization_id,
          deleted_at: null,
        },
        { $set: updateData },
        {
          new: true, // Return the updated document
          runValidators: true, // Run schema validations
        }
      );

      if (!updatedInvoice) {
        return res.status(404).json({
          success: false,
          message: "Failed to update invoice",
        });
      }
      // Invoices converted before journals were posted for them get one now.
      if (!invoice.journal_id) await postInvoiceJournal(updatedInvoice);

      // Log user activity
      await userActivityHelper(
        admin_id,
        organization_id,
        updateData.customer_id || invoice.customer_id,
        `Invoice updated for ${formatCurrency(total_receivable)}`,
        "Invoice updated",
        invoice_id,
        "Invoice"
      );

      console.log("Invoice updated successfully:", updateData);

      // Success Response
      return res.status(200).json({
        success: true,
        message: "Invoice updated successfully",
        data: updatedInvoice,
        journalData: updateJournal,
      });
    } catch (error) {
      console.error("updateInvoice Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error: Unable to update invoice",
        error: error.message,
      });
    }
  }
  // 📌 Delete invoice
  async deleteInvoice(req, res) {
    try {
      let { org_id, invoice_id } = req.query;

      // Validate required parameters
      if (!org_id || !invoice_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Organization ID and Invoice ID are required for delete invoice.",
        });
      }

      console.log("Input Parameters:", {
        org_id,
        invoice_id,
        admin_id: res.locals.user_id,
      });

      // First, find the invoice to get the journal_id
      const findInvoice = await InvoiceCollection.findOne({
        admin_id: res.locals.user_id,
        invoice_id: invoice_id,
        organization_id: org_id,
      });

      if (!findInvoice) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Invoice not found for delete",
        });
      }

      // Get journal_id from the found invoice
      const journal_id = findInvoice.journal_id;

      if (!journal_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "The Journal ID is required for delete invoice.",
        });
      }

      // Delete the invoice
      const deleteInvoice = await InvoiceCollection.findOneAndDelete({
        admin_id: res.locals.user_id,
        invoice_id: invoice_id,
        organization_id: org_id,
      });

      // Delete the journal entry using the journal_id from invoice
      const deleteJournal = await JournalCollection.findOneAndDelete({
        journal_id: journal_id,
        organization_id: org_id, // Add organization filter for security
      });

      if (!deleteInvoice) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Invoice not found for delete",
        });
      }

      // Currency formatting function
      const formatCurrency = (amount) => {
        return `₹${Number(amount).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      };

      // Handle estimate update if this is a converted invoice
      if (deleteInvoice.estimate_id) {
        try {
          // Validate estimate_id to ensure it's a valid ObjectId
          if (mongoose.Types.ObjectId.isValid(deleteInvoice.estimate_id)) {
            const estimate = await EstimateCollection.findOne({
              _id: deleteInvoice.estimate_id,
              organization_id: org_id,
              deleted_at: null,
            });

            if (estimate) {
              // Remove the deleted invoice's ID from the invoice_ids array
              estimate.invoice_ids = estimate.invoice_ids.filter(
                (id) => id !== deleteInvoice.invoice_id
              );

              // Remove the deleted invoice's details from the invoices array
              estimate.invoices = estimate.invoices.filter(
                (inv) => inv.invoice_id !== deleteInvoice.invoice_id
              );

              // Check if this is the last invoice created by the estimate
              if (estimate.invoice_ids.length === 0) {
                // Restore the original status of the estimate
                estimate.status = estimate.current_sub_status || "draft";
                estimate.status_formatted =
                  estimate.current_sub_status_formatted || "Draft";

                // Clear the invoiced amount fields
                estimate.invoiced_amount = null;
                estimate.invoiced_amount_formatted = null;

                // Clear current_sub_status fields
                estimate.current_sub_status = null;
                estimate.current_sub_status_formatted = null;
              }

              // Add audit fields to estimate
              estimate.last_modified_by_id = res.locals.user_id;
              estimate.updated_at = new Date();

              // Save the updated estimate
              await estimate.save();
              console.log(
                `Estimate ${deleteInvoice.estimate_id} updated successfully`
              );
            }
          }
        } catch (estimateError) {
          console.error("Error updating estimate:", estimateError);
          // Don't fail the entire operation if estimate update fails
        }
      }

      // Handle salesorder update if this is a converted invoice
      if (deleteInvoice.salesorder_id) {
        try {
          const salesorder = await SalesOrderCollection.findOne({
            salesorder_id: deleteInvoice.salesorder_id,
            organization_id: org_id,
            deleted_at: null,
          });

          if (salesorder) {
            // Remove the deleted invoice's ID from the invoice_ids array
            salesorder.invoice_ids = salesorder.invoice_ids.filter(
              (id) => id !== deleteInvoice.invoice_id
            );

            // Remove the deleted invoice's details from the invoices array
            salesorder.invoices = salesorder.invoices.filter(
              (inv) => inv.invoice_id !== deleteInvoice.invoice_id
            );

            // Update status if no more invoices
            if (salesorder.invoice_ids.length === 0) {
              salesorder.status = salesorder.current_sub_status || "draft";
              salesorder.status_formatted =
                salesorder.current_sub_status_formatted || "Draft";
            }

            // Add audit fields
            salesorder.last_modified_by_id = res.locals.user_id;
            salesorder.updated_at = new Date();

            await salesorder.save();
            console.log(
              `Sales Order ${deleteInvoice.salesorder_id} updated successfully`
            );
          }
        } catch (salesorderError) {
          console.error("Error updating sales order:", salesorderError);
        }
      }

      // Handle delivery challan update if this is a converted invoice
      if (deleteInvoice.deliverychallan_id) {
        try {
          const deliverychallan = await DeliveryChallanCollection.findOne({
            deliverychallan_id: deleteInvoice.deliverychallan_id,
            organization_id: org_id,
            deleted_at: null,
          });

          if (deliverychallan) {
            // Remove the deleted invoice's ID from the invoice_ids array
            deliverychallan.invoice_ids = deliverychallan.invoice_ids.filter(
              (id) => id !== deleteInvoice.invoice_id
            );

            // Remove the deleted invoice's details from the invoices array
            deliverychallan.invoices = deliverychallan.invoices.filter(
              (inv) => inv.invoice_id !== deleteInvoice.invoice_id
            );

            // Update status if no more invoices
            if (deliverychallan.invoice_ids.length === 0) {
              deliverychallan.status =
                deliverychallan.current_sub_status || "draft";
              deliverychallan.status_formatted =
                deliverychallan.current_sub_status_formatted || "Draft";
            }

            // Add audit fields
            deliverychallan.last_modified_by_id = res.locals.user_id;
            deliverychallan.updated_at = new Date();

            await deliverychallan.save();
            console.log(
              `Delivery Challan ${deleteInvoice.deliverychallan_id} updated successfully`
            );
          }
        } catch (challanError) {
          console.error("Error updating delivery challan:", challanError);
        }
      }

      // Log user activity
      await userActivityHelper(
        res.locals.user_id,
        org_id,
        deleteInvoice.customer_id,
        `Invoice deleted for ${formatCurrency(deleteInvoice.total || 0)}`,
        "Invoice deleted",
        deleteInvoice.invoice_id,
        "Invoice"
      );

      console.log("Invoice and Journal deleted successfully:", {
        invoice_id: invoice_id,
        journal_id: journal_id,
        organization_id: org_id,
        admin_id: res.locals.user_id,
      });

      return res.status(ST_CODES.OK).json({
        success: true,
        message: "Invoice deleted successfully",
        data: deleteInvoice,
      });
    } catch (error) {
      console.log("Error in Invoice delete", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to delete invoice. Please try again later.",
      });
    }
  }
  // 📌 get invoice unique Id
  async getUniqueId(req, res) {
    try {
      let invoiceId = await commonHelper.generateUniqueId(
        InvoiceCollection,
        "invoice_number",
        6,
        "INV"
      );
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Invoice Id has been generated",
        data: invoiceId,
      });
    } catch (err) {
      console.error("generatingInvoiceId Error:", err);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while generating invoice id",
      });
    }
  }
  askAI = async (req, res) => {
    try {
      const { question } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      console.log("Fetching invoice data...");

      // Fetch invoices from MongoDB
      const invoices = await InvoiceCollection.find(
        {},
        "customer_name total status"
      ).lean();

      if (!invoices.length) {
        return res
          .status(404)
          .json({ error: "No invoices found in the database" });
      }

      // Transform data for AI processing
      const invoiceSummary = invoices.map((invoice) => ({
        customerName: invoice.customer_name,
        totalAmount: invoice.total,
        status: invoice.status_formatted,
      }));

      const prompt = `
      Based on the provided invoice data:
  
      ${JSON.stringify(invoiceSummary, null, 2)}
  
      Answer the following question: "${question}"
      `;

      console.log("Sending request to Gemini API...");

      // Ensure the API key is set correctly
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error("Gemini API Key is missing!");
        return res
          .status(500)
          .json({ error: "AI service configuration error" });
      }

      // Call Gemini AI
      const aiResponse = await askGemini(prompt, apiKey);

      if (!aiResponse) {
        return res
          .status(500)
          .json({ error: "AI service did not return a response" });
      }

      // Extract text from AI response properly
      let responseText = "";

      if (typeof aiResponse === "string") {
        responseText = aiResponse;
      } else if (
        typeof aiResponse === "object" &&
        aiResponse.parts &&
        aiResponse.parts[0] &&
        aiResponse.parts[0].text
      ) {
        responseText = aiResponse.parts[0].text; // Extract actual text from the AI response
      } else {
        responseText = JSON.stringify(aiResponse); // Fallback to JSON string
      }

      // Clean the extracted response
      const cleanedResponse = responseText.replace(/\/\*\/n/g, "").trim();

      console.log("Cleaned AI Response:", cleanedResponse);

      return res.status(200).json({ answer: cleanedResponse });
    } catch (error) {
      console.error("askAI Error:", error);
      return res
        .status(500)
        .json({ error: "Internal Server Error: Unable to process request" });
    }
  };
  // 📌email fetch
  async getInvoiceEmailDetails(req, res) {
    try {
      const { organization_id } = req.query;
      const { invoice_id } = req.params;
      const token = req.headers.authorization;

      // Validate required parameters
      if (!organization_id || !invoice_id || !token) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id, invoice_id, or token",
        });
      }

      // Fetch Sales Order
      const invoice = await InvoiceCollection.findOne({
        organization_id: organization_id,
        invoice_id: invoice_id,
      });

      if (!invoice) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Invoices not found",
        });
      }

      if (!invoice.customer_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Invoices does not have a valid customer_id",
        });
      }

      let organization = {};
      let contactPerson = {};

      try {
        console.log("Fetching organization and contact person details...");

        // Fetch organization and contact person data in parallel
        const [organizationResponse, contactPersonResponse] = await Promise.all(
          [
            apiHandler.getOrganizationDetails(organization_id, token),
            apiHandler.getContactPersonInformation(
              invoice.customer_id,
              organization_id,
              token
            ),
          ]
        );

        if (!organizationResponse?.data?.data) {
          return res.status(ST_CODES.ORG_NOT_FOUND).send({
            success: true,
            message: MESSAGES.ORG_NOT_FOUND,
          });
        }

        organization = organizationResponse.data.data;
        console.log("✅ Organization data retrieved successfully.");

        if (contactPersonResponse?.data) {
          contactPerson = contactPersonResponse.data;
          console.log("✅ Contact person data retrieved successfully.");
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
        return res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
          success: false,
          message: "Error fetching organization or contact details",
        });
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
            email: contact.email || "", // Ensure email is included here
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

      const admin = await UserCollection.findOne(
        { _id: res.locals.user_id },
        { email: 1 }
      );

      // Prepare Email Details Object
      const emailDetails = {
        from_email: organization.email || admin ? admin.email : null,
        subject: `Invoice - ${invoice.invoice_number} from ${organization.organization_name}`,
        body: `Thank you for contacting us. Your quote can be viewed, printed and downloaded as PDF from the link below`,
        customer_name: invoice.customer_name || "",
        customer_id: invoice.customer_id || "",
        organization_name: organization.organization_name || "",
        organization_id: organization_id,
        invoice_number: invoice.invoice_number || "",
        quote_id: invoice.quote_id,
        total: invoice.total || 0,
        total_formatted: invoice.total_formatted || "",
        date: invoice.date || "",
        date_formatted: invoice.date_formatted || "",
        due_date: invoice.date || "",
        due_date_formatted: invoice.date_formatted || "",
        file_name: invoice.invoice_number,
        file_name_without_extension: `${invoice.invoice_number}.pdf`,
        orgemail_detail: orgemail_name, // Include the correctly formatted orgemail_name array
        to_contact, // Include the contact list with emails
        status: invoice.status || "",
        entity_type: "invoice",
      };

      // console.log("✅ Email details successfully prepared:", emailDetails);

      // Return the email details
      res.status(ST_CODES.OK).json({
        status: true,
        message: "Email details retrieved successfully",
        data: emailDetails,
      });
    } catch (error) {
      // console.error("❌ getInvoiceEmailDetails Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Something went wrong while fetching email details",
        error: error.message,
      });
    }
  }
  // 📌 Change sales order status
  async updateInvoiceStatus(req, res) {
    try {
      const { organization_id, invoice_id } = req.query;
      const { status, status_formatted } = req.body;
      // const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!organization_id || !invoice_id || !status || !status_formatted) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      // Validate status value
      const validStatuses = [
        "draft",
        "sent",
        "void",
        "closed",
        "unpaid",
        "paid",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message:
            "Invalid status value. Must be one of: draft, sent, accepted, declined, expired",
        });
      }

      // Find and update the sales order
      const updatedInvoice = await InvoiceCollection.findOneAndUpdate(
        {
          invoice_id: invoice_id,
          organization_id: organization_id,
          // admin_id: admin_id,
          deleted_at: null,
        },
        {
          $set: {
            status: status,
            status_formatted: status_formatted,
            status_updated_at: new Date(),
          },
        },
        { new: true }
      );

      if (!updatedInvoice) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Invoice not found or unauthorized access",
        });
      }
      await syncJournalPosting(updatedInvoice.journal_id, organization_id, status);

      res.status(ST_CODES.OK).send({
        status: true,
        message: `The status of the Invoice has been changed to ${status_formatted}.`,
        data: {
          invoice_id: updatedInvoice.invoice_id,
          status: updatedInvoice.status_formatted,
        },
      });
    } catch (error) {
      // console.error("updateInvoiceStatus Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while updating sales order status",
      });
    }
  }

  async getCustomerInvoiceSummary(req, res) {
    try {
      const formatDate = (date) => {
        if (!date) return null;
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      };

      const { organization_id, customer_id } = req.query;

      if (!organization_id || !customer_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Organization ID and Customer ID are required",
        });
      }

      const customerQuery = {
        organization_id,
        status: { $ne: "paid" },
      };

      if (mongoose.Types.ObjectId.isValid(customer_id)) {
        customerQuery["$or"] = [
          { customer_id: customer_id },
          { customer_id: mongoose.Types.ObjectId(customer_id) },
        ];
      } else {
        customerQuery.customer_id = customer_id;
      }
      const invoices = await InvoiceCollection.find(customerQuery);

      const customer = await CustomerCollection.findOne(
        {
          organization_id: organization_id,
          contact_id: customer_id,
        },
        {
          opening_balance_amount: 1,
          created_time: 1,
          contact_id: 1,
          customer_name: 1,
          phone: 1,
          email: 1,
        }
      );

      if (!customer) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Customer not found",
        });
      }
      const openingBalanceAmount = customer.opening_balance_amount || 0;
      console.log(openingBalanceAmount, "openingBalanceAmount");
      // Helper to format date as DD/MM/YYYY

      const formatted = invoices.map((invoice) => ({
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.date_formatted,
        invoice_amount: invoice.total,
        invoice_amount_format: invoice.total_formatted,
        invoice_status: invoice.status_formatted,
        invoice_due_date: invoice.due_date_formatted,
        invoice_due_amount: invoice.balance,
        invoice_due_amount_formatted: invoice.balance_formatted,
      }));

      // Add opening balance as a fake invoice entry if applicable
      // if (openingBalanceAmount > 0) {
      //   formatted.unshift({
      //     invoice_number: "Vendor opening balance",
      //     invoice_date: formatDate(customer.created_time) || null,
      //     invoice_amount: `₹${openingBalanceAmount.toFixed(2)}`,
      //     invoice_status: "Opening",
      //     contact_id: customer.contact_id,
      //   });
      // }

      return res.status(ST_CODES.OK).json({
        success: true,
        data: formatted,
      });
    } catch (err) {
      console.error("getCustomerInvoiceSummary error", err);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }

  async applyInvoice(req, res) {
    try {
      const { invoice_id, organization_id } = req.query;
      const { amount_applied } = req.body;

      if (!invoice_id || !organization_id || amount_applied == null) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "invoice_id, organization_id and amount_applied are required",
        });
      }

      const appliedAmount = Number(amount_applied);

      let invoiceQuery = {
        organization_id: organization_id,
      };

      if (mongoose.Types.ObjectId.isValid(invoice_id)) {
        invoiceQuery["$or"] = [
          { _id: new mongoose.Types.ObjectId(invoice_id) },
          { invoice_id: invoice_id },
        ];
      } else {
        invoiceQuery["invoice_id"] = invoice_id;
      }

      const invoice = await InvoiceCollection.findOne(invoiceQuery); // ✅ FIXED

      if (!invoice) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Invoice not found",
        });
      }

      if (appliedAmount > invoice.total) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Applied amount cannot be greater than invoice total",
        });
      }

      invoice.payment_made = appliedAmount;
      invoice.payment_made_formatted = invoice.payment_made
        ? `₹${parseFloat(invoice.payment_made).toFixed(2)}`
        : "₹0.00";
      invoice.balance = invoice.balance - appliedAmount;
      invoice.balance_formatted = invoice.balance
        ? `₹${parseFloat(invoice.balance).toFixed(2)}`
        : "₹0.00";

      if (invoice.total === appliedAmount) {
        invoice.status = "paid";
        invoice.status_formatted = "Paid";
      } else {
        invoice.status = "partially paid";
        invoice.status_formatted = "Partially Paid";
      }

      await invoice.save();

      return res.status(ST_CODES.OK).json({
        success: true,
        message: "Invoice updated successfully",
      });
    } catch (error) {
      console.error(error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
}
module.exports = new InvoiceController();
