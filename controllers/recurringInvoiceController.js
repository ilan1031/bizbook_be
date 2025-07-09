// invoiceController.js
const mongoose = require("mongoose");
const RecurringInvoiceCollection = require("../model/recurringInvoice");
const InvoiceCollection = require("../model/invoice");
const SalesOrderCollection = require("../model/salesOrder");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { default: axios } = require("axios");
const commonHelper = require("../helpers/commonHelpers");
const CustomerCollection = require("../model/contactModel");
const OrganizationCollection = require("../model/organizationSchema");
const moment = require("moment");
const apiHandler = require("../handler/api-handler");
const constants = require("../config/constant");
const numWords = require("num-words");

require("dotenv").config();

function numberToWordsINR(num) {
  if (typeof num !== "number") return "";
  const integerPart = Math.floor(num);
  return (
    numWords(integerPart).replace(/\b\w/g, (c) => c.toUpperCase()) +
    " Rupees Only"
  );
}

class RecurringInvoiceController {
  // 📌create Recurring Invoice
  async createRecurringInvoice(req, res) {
    try {
      const bData = req.body;
      const admin_id = res.locals.user_id;
      const organization_id = req.query.organization_id;
      console.log(organization_id, "organization_id");
      console.log(admin_id, "admin_id");
      
      let documents = req.body.documents;
      if (req.file) {
        documents = req.file.filename;
      }

      bData.documents = documents;

      // const { organization_id } = req.query;

      // Add debug logging
      console.log("Received recurrence_frequency:", bData.recurrence_frequency);
      console.log("Full request body:", bData);

      // Validate required fields
      if (!organization_id) {
        return res.status(400).json({
          status: false,
          message: "Organization ID is required",
        });
      }



      // Check if customer data exists
      if (!bData.customer_id && !bData.customer_name) {
        return res.status(400).json({
          status: false,
          message: "Customer information is required",
        });
      }

      // Generate unique invoice ID
      const invoiceId = await commonHelper.generateUniqueId(
        RecurringInvoiceCollection,
        "recurring_invoice_id"
      );
      bData.recurring_invoice_id = invoiceId;
      console.log("Generated recurring_invoice_id:", invoiceId);

      // Generate invoice number if not provided
      if (!bData.recurring_number) {
        const invoiceNumber = await commonHelper.generateUniqueId(
          RecurringInvoiceCollection,
          "recurring_invoice_id"
        );
        bData.recurring_number = `RI-${invoiceNumber}`;
      }

      const currentDate = new Date();

      // Default values with proper date handling
      bData.start_date =
        bData.start_date || currentDate.toISOString().split("T")[0];
      bData.next_invoice_date = bData.next_invoice_date || bData.start_date;

      // Format dates properly as strings for storage
      try {
        bData.next_invoice_date_formatted = new Date(
          bData.next_invoice_date
        ).toLocaleDateString("en-GB");
        bData.start_date_formatted = new Date(
          bData.start_date
        ).toLocaleDateString("en-GB");
      } catch (err) {
        console.error("Date formatting error:", err);
        bData.next_invoice_date_formatted = new Date().toLocaleDateString(
          "en-GB"
        );
        bData.start_date_formatted = new Date().toLocaleDateString("en-GB");
      }

      // Handle end date for recurrence if provided
      if (bData.end_date) {
        try {
          bData.end_date_formatted = new Date(
            bData.end_date
          ).toLocaleDateString("en-GB");
        } catch (err) {
          console.error("End date formatting error:", err);
          delete bData.end_date;
          delete bData.end_date_formatted;
        }
      }

      // Validate recurrence frequency
      const validFrequencies = ["day", "week", "month", "year"];
      if (!validFrequencies.includes(bData["recurrence_frequency"])) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid recurrence_frequency. Allowed: day, week, month, year.",
          received_value: bData["recurrence_frequency"],
        });
      }

      const repeatEvery = parseInt(bData["repeat_every"], 10);
      const frequency = bData["recurrence_frequency"];
      const startDate = moment(bData.start_date, "YYYY-MM-DD");

      if (!startDate.isValid()) {
        return res.status(400).json({
          success: false,
          message: "Invalid start_date format. Use YYYY-MM-DD.",
        });
      }

      // Calculate next_bill_date
      const nextBillDate = startDate.clone().add(repeatEvery, frequency);
      bData.next_invoice_date = nextBillDate.format("YYYY-MM-DD");

      // Metadata fields
      bData.admin_id = admin_id;
      bData.created_by_id = admin_id;
      bData.last_modified_by_id = admin_id;
      bData.status = bData.status || "draft";
      bData.status_formatted = bData.status_formatted || "Draft";
      bData.organization_id = organization_id;
      bData.date = bData.date || currentDate.toISOString();

      try {
        bData.date_formatted = new Date(bData.date).toLocaleDateString("en-GB");
      } catch (err) {
        console.error("Date formatting error:", err);
        bData.date_formatted = new Date().toLocaleDateString("en-GB");
      }

      // Set default values for optional fields
      bData.customer_name = bData.customer_name || "";
      bData.place_of_supply = bData.place_of_supply || "";
      bData.order_number = bData.order_number || "";
      bData.vat_treatment = bData.vat_treatment || "";
      bData.tax_treatment = bData.tax_treatment || "";
      bData.is_reverse_charge_applied =
        bData.is_reverse_charge_applied || false;
      bData.gst_treatment = bData.gst_treatment || "";
      bData.gst_no = bData.gst_no || "";
      bData.cfdi_usage = bData.cfdi_usage || "";
      bData.reference_number = bData.reference_number || "";
      bData.invoiced_estimate_id = bData.invoiced_estimate_id || "";
      bData.salesperson_name = bData.salesperson_name || "";
      bData.allow_partial_payments = bData.allow_partial_payments || false;
      bData.custom_body = bData.custom_body || "";
      bData.custom_subject = bData.custom_subject || "";
      bData.shipping_charge = parseFloat(bData.shipping_charge || 0);
      bData.adjustment = parseFloat(bData.adjustment || 0);
      bData.adjustment_description = bData.adjustment_description || "";
      bData.reason = bData.reason || "";
      bData.tax_authority_id = bData.tax_authority_id || "";
      bData.tax_exemption_id = bData.tax_exemption_id || "";
      bData.billing_address_id = bData.billing_address_id || "";
      bData.shipping_address_id = bData.shipping_address_id || "";
      bData.avatax_use_code = bData.avatax_use_code || "";
      bData.avatax_exempt_no = bData.avatax_exempt_no || "";
      bData.tax_id = bData.tcs_id || bData.tds_id || "";
      bData.expense_id = bData.expense_id || "";
      bData.salesorder_item_id = bData.salesorder_item_id || "";
      bData.avatax_tax_code = bData.avatax_tax_code || "";
      bData.time_entry_ids = bData.time_entry_ids || [];
      bData.discount_amount = parseFloat(bData.discount_amount || 0);
      bData.discount_percent = parseFloat(bData.discount_percent || 0);
      bData.tax_type = bData.tax_type || "";
      bData.payment_terms_label = bData.payment_terms_label || "";
      bData.payment_terms = bData.payment_terms || "";
      bData.tds_option = bData.tds_option || "";
      bData.is_last_child_invoice = false;

      // Recurrence Settings with proper defaults
      bData.recurrence_preferences =
        bData.recurrence_preferences || "save_as_draft"; // save_as_draft, send_automatically
      bData.recurrence_frequency = bData.recurrence_frequency || "month"; // day, week, month, year
      bData.repeat_every = parseInt(bData.repeat_every || 1);

      // Flag to indicate if emails should be sent for recurring invoices
      bData.send_email = bData.send_email === true;

      // Line Items Calculation
      if (bData.line_items && bData.line_items.length > 0) {
        let subTotal = 0;
        bData.line_items.forEach((item) => {
          item.line_item_id =
            item.line_item_id || Math.random().toString(36).substring(2, 15);
          item.quantity = parseFloat(item.quantity || 0);
          item.rate = parseFloat(item.rate || 0);
          const lineTotal = item.quantity * item.rate;

          item.item_total = lineTotal;
          item.item_total_formatted = `₹${lineTotal.toFixed(2)}`;
          item.item_total_inclusive_of_tax = lineTotal;
          item.item_total_inclusive_of_tax_formatted = `₹${lineTotal.toFixed(
            2
          )}`;

          item.progress_invoice_details = {
            invoiced_quantity: 0,
            invoiced_quantity_formatted: "0.00",
            invoiced_value: 0,
            invoiced_value_formatted: "₹0.00",
            balance_amount: lineTotal,
            balance_amount_formatted: `₹${lineTotal.toFixed(2)}`,
            is_invoiced: false,
          };

          item.tags = Array.isArray(item.tags) ? item.tags : [];

          subTotal += lineTotal;
        });

        bData.sub_total = subTotal;
        bData.sub_total_formatted = `₹${subTotal.toFixed(2)}`;
        bData.bcy_sub_total = subTotal;

        let discountAmount = 0;
        if (bData.discount_type === "percentage" && bData.discount_percent) {
          discountAmount = (subTotal * bData.discount_percent) / 100;
        } else if (bData.discount_amount) {
          discountAmount = bData.discount_amount;
        }

        bData.discount_amount = discountAmount;
        bData.discount_amount_formatted = `₹${discountAmount.toFixed(2)}`;
        bData.discount_total = discountAmount;
        bData.discount_total_formatted = `₹${discountAmount.toFixed(2)}`;
        bData.bcy_discount_total = discountAmount;

        const subTotalAfterDiscount = subTotal - discountAmount;
        bData.sub_total_exclusive_of_discount = subTotalAfterDiscount;
        bData.sub_total_exclusive_of_discount_formatted = `₹${subTotalAfterDiscount.toFixed(
          2
        )}`;

        let taxTotal = 0;
        if (bData.taxes && Array.isArray(bData.taxes)) {
          bData.taxes.forEach((tax) => {
            const taxBase = bData.is_discount_before_tax
              ? subTotalAfterDiscount
              : subTotal;
            const taxAmount = parseFloat(
              ((taxBase * (parseFloat(tax.tax_percentage) || 0)) / 100).toFixed(
                2
              )
            );
            tax.tax_amount = taxAmount;
            tax.tax_amount_formatted = `₹${taxAmount.toFixed(2)}`;
            taxTotal += taxAmount;
          });
        }

        bData.tax_total = taxTotal;
        bData.tax_total_formatted = `₹${taxTotal.toFixed(2)}`;
        bData.bcy_tax_total = taxTotal;

        const shippingCharge = parseFloat(bData.shipping_charge || 0);
        const adjustment = parseFloat(bData.adjustment || 0);
        const total =
          subTotal - discountAmount + taxTotal + shippingCharge + adjustment;

        bData.total = total;
        bData.total_formatted = `₹${total.toFixed(2)}`;
        bData.bcy_total = total;

        const paymentMade = parseFloat(bData.payment_made || 0);
        const creditsApplied = parseFloat(bData.credits_applied || 0);
        const balance = total - paymentMade - creditsApplied;

        bData.balance = balance;
        bData.balance_formatted = `₹${balance.toFixed(2)}`;
      } else {
        bData.sub_total = 0;
        bData.sub_total_formatted = "₹0.00";
        bData.tax_total = 0;
        bData.tax_total_formatted = "₹0.00";
        bData.total = 0;
        bData.total_formatted = "₹0.00";
        bData.balance = 0;
        bData.balance_formatted = "₹0.00";
        bData.line_items = [];
      }

      // Billing & Shipping Address
      bData.billing_address = {
        street: bData.billing_address?.street || "",
        address: bData.billing_address?.address || "",
        street2: bData.billing_address?.street2 || "",
        city: bData.billing_address?.city || "",
        state: bData.billing_address?.state || "",
        zip: bData.billing_address?.zip || "",
        country: bData.billing_address?.country || "",
        fax: bData.billing_address?.fax || "",
        phone: bData.billing_address?.phone || "",
        attention: bData.billing_address?.attention || "",
      };

      bData.shipping_address = {
        street: bData.shipping_address?.street || "",
        address: bData.shipping_address?.address || "",
        street2: bData.shipping_address?.street2 || "",
        city: bData.shipping_address?.city || "",
        state: bData.shipping_address?.state || "",
        zip: bData.shipping_address?.zip || "",
        country: bData.shipping_address?.country || "",
        fax: bData.shipping_address?.fax || "",
        phone: bData.shipping_address?.phone || "",
        attention: bData.shipping_address?.attention || "",
      };

      // Create comment
      const commentData = {
        comment_id: await commonHelper.generateUniqueId(
          RecurringInvoiceCollection,
          "comment_id",
          5,
          "CMT"
        ),
        description: `Recurring invoice created ${bData.total_formatted}`,
        commented_by_id: admin_id,
        commented_by: bData.customer_name || res.locals.user_name || "System",
        comment_type: "system",
        date: currentDate.toISOString(),
        date_formatted: currentDate.toLocaleDateString("en-GB"),
        date_with_time: `${currentDate.toLocaleDateString(
          "en-GB"
        )} ${currentDate.toLocaleTimeString("en-GB")}`,
        date_description: `Created on ${currentDate.toLocaleDateString(
          "en-GB"
        )}`,
        time: currentDate.toLocaleTimeString("en-GB"),
        operation_type: "Added",
        transaction_id: bData.recurring_invoice_id,
        transaction_type: "recurring_invoice",
        sentiment: "positive",
      };

      bData.comments = bData.comments || [];
      bData.comments.push(commentData);

      // Insert into DB
      console.log("Inserting recurring invoice with data:", {
        recurring_invoice_id: bData.recurring_invoice_id,
        organization_id: bData.organization_id,
        admin_id: bData.admin_id,
        created_by_id: bData.created_by_id,
        last_modified_by_id: bData.last_modified_by_id
      });
      
      const result = await queryHelper.insertData(
        RecurringInvoiceCollection,
        bData
      );

      if (!result.status) {
        return res.status(400).json({
          code: 1,
          message: result.msg || "Failed to create recurring invoice",
        });
      }
      
      console.log("Recurring invoice created successfully:", result.msg);
      console.log("Full result data:", JSON.stringify(result.msg, null, 2));

      // Now create a regular invoice using the same data
      try {
        const invoiceCreateUrl = `${constants.SO_BACKEND_URL}/invoices?organization_id=${organization_id}`;
        const token =
          req.headers.authorization?.split("Bearer ")[1] || res.locals.token;

        if (!token) {
          throw new Error("Authentication token not found");
        }

        // Add admin and organization details to the invoice data
        const invoiceData = {
          ...bData,
          admin_id: admin_id,
          organization_id: organization_id,
          created_by_id: admin_id,
          last_modified_by_id: admin_id,
        };

        const invoiceResponse = await axios.post(invoiceCreateUrl, invoiceData, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        console.log("Regular invoice created:", invoiceResponse.data);
      } catch (invoiceError) {
        console.error(
          "Failed to create regular invoice:",
          invoiceError.message
        );
        // Decide whether to rollback recurring invoice creation or proceed
      }

      return res.status(200).json({
        code: 0,
        message: "Recurring invoice created successfully",
        data: result.msg,
      });
    } catch (err) {
      console.error("Create Recurring Invoice Error:", err);
      return res.status(500).json({
        code: 1,
        message: "Internal server error while creating recurring invoice",
        error: err.message,
      });
    }
  }
  // 📌get recurring invoice by id
  async getRecurringInvoiceById(req, res) {
    try {
      const {
        organization_id,
        recurring_invoice_id,
        filter_status,
        page = 1,
        limit = 10,
      } = req.query;
      if (!organization_id || !recurring_invoice_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and recurring_invoice_id",
        });
      }
      // Parse pagination values
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      const skip = (pageNum - 1) * limitNum;
      // Find recurring invoice with proper error handling
      console.log("Searching for recurring invoice with:", {
        organization_id,
        recurring_invoice_id,
        deleted_at: null
      });
      
      let recurringInvoice;
      try {
        recurringInvoice = await RecurringInvoiceCollection.findOne({
          organization_id,
          recurring_invoice_id,
          deleted_at: null,
        }).lean();
        
        console.log("Query result:", recurringInvoice ? "Found" : "Not found");
        if (recurringInvoice) {
          console.log("Recurring invoice data from DB:", {
            admin_id: recurringInvoice.admin_id,
            created_by_id: recurringInvoice.created_by_id,
            last_modified_by_id: recurringInvoice.last_modified_by_id,
            organization_id: recurringInvoice.organization_id
          });
        }
      } catch (dbError) {
        console.error("Database Error:", dbError);
        return res.status(500).json({
          code: 1,
          message: "Database error while fetching recurring invoice",
        });
      }
      if (!recurringInvoice) {
        console.log("Recurring invoice not found. Query params:", {
          organization_id,
          recurring_invoice_id
        });
        return res.status(404).json({
          code: 1,
          message: "Recurring invoice not found or unauthorized access",
        });
      }
      // Fetch organization data
      let organization;
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
          }
        ).lean();
      } catch (dbError) {
        console.error("Organization Fetch Error:", dbError);
        organization = null;
      }
      // Get sales order info if available
      let salesOrderNumber = "";
      if (recurringInvoice.salesorder_id) {
        try {
          const salesOrder = await SalesOrderCollection.findOne(
            {
              organization_id,
              _id: recurringInvoice.salesorder_id,
              deleted_at: null,
            },
            { salesorder_number: 1 }
          ).lean();

          if (salesOrder) {
            salesOrderNumber = salesOrder.salesorder_number;
          }
        } catch (dbError) {
          console.error("Sales Order Fetch Error:", dbError);
        }
      }
      // Get customer invoices with optional filter and pagination
      let invoicesForCustomer = [];
      let manualInvoiceCount = 0;
      let manualInvoiceTotal = 0;
      let hasMorePage = false;
      if (recurringInvoice.recurring_invoice_id) {
        try {
          const invoiceQuery = {
            organization_id,
            recurring_invoice_id: recurringInvoice.recurring_invoice_id,
            deleted_at: null,
          };
          // Apply status filter if provided
          if (filter_status === "paid") {
            invoiceQuery.status = { $in: ["paid"] };
          } else if (filter_status === "unpaid") {
            invoiceQuery.status = {
              $in: ["invoice_sent", "partially_paid", "draft"],
            };
          }
          // Count total matching invoices
          const totalCount = await InvoiceCollection.countDocuments(
            invoiceQuery
          );
          // Fetch paginated invoices
          invoicesForCustomer = await InvoiceCollection.find(invoiceQuery, {
            invoice_number: 1,
            invoice_id: 1,
            recurring_number: 1,
            date: 1,
            date_formatted: 1,
            order_number: 1,
            status: 1,
            status_formatted: 1,
            total: 1,
            total_formatted: 1,
            _id: 0,
          })
            .skip(skip)
            .limit(limitNum)
            .lean();
          manualInvoiceCount = totalCount;
          // Aggregate total sum of filtered invoices
          const aggregationResult = await InvoiceCollection.aggregate([
            { $match: invoiceQuery },
            { $group: { _id: null, totalSum: { $sum: "$total" } } },
          ]);
          manualInvoiceTotal = aggregationResult[0]?.totalSum || 0;
          // Pagination metadata
          hasMorePage = pageNum * limitNum < totalCount;
        } catch (dbError) {
          console.error("Customer Invoices Fetch Error:", dbError);
        }
      }
      // Get customer details
      let customerDetails = [];
      if (recurringInvoice.customer_id) {
        try {
          customerDetails = await CustomerCollection.findOne(
            {
              organization_id,
              contact_id: recurringInvoice.customer_id,
              deleted_at: null,
            },
            {
              customer_name: 1,
              contact_name: 1,
              email: 1,
              company_name: 1,
              status_formatted: 1,
            }
          ).lean();
        } catch (dbError) {
          console.error("Customer Details Fetch Error:", dbError);
        }
      }
      const responseData = {
        admin_id: recurringInvoice.admin_id,
        recurring_invoice_id: recurringInvoice.recurring_invoice_id,
        status: recurringInvoice.status,
        status_formatted: recurringInvoice.status_formatted,
        next_invoice_date: recurringInvoice.next_invoice_date,
        next_invoice_date_formatted: recurringInvoice.next_invoice_date,
        start_date: recurringInvoice.start_date,
        start_date_formatted: recurringInvoice.start_date_formatted,
        end_date: recurringInvoice.end_date,
        end_date_formatted:
          recurringInvoice.never_expires === false
            ? "Never Expires"
            : recurringInvoice.end_date
            ? new Date(recurringInvoice.end_date).toLocaleDateString("en-GB")
            : "",
        terms: recurringInvoice.terms,
        salesorder_number: salesOrderNumber,
        recurrence_frequency: recurringInvoice.recurrence_frequency || "month",
        repeat_every: recurringInvoice.repeat_every || 1,
        recurrence_preferences:
          recurringInvoice.recurrence_preferences || "save_as_draft",
        send_email: recurringInvoice.send_email || false,
        sub_total: recurringInvoice.sub_total,
        sub_total_formatted: recurringInvoice.sub_total_formatted,
        tax_total: recurringInvoice.tax_total,
        tax_total_formatted: recurringInvoice.tax_total_formatted,
        tds_option: recurringInvoice.tds_option,
        discount_total: recurringInvoice.discount_total,
        discount_total_formatted: recurringInvoice.discount_total_formatted,
        discount_percent: recurringInvoice.discount_percent,
        discount_amount: recurringInvoice.discount_amount,
        discount_amount_formatted: recurringInvoice.discount_amount_formatted,
        discount: recurringInvoice.discount,
        discount_applied_on_amount: recurringInvoice.discount_applied_on_amount,
        discount_applied_on_amount_formatted:
          recurringInvoice.discount_applied_on_amount_formatted,
        discount_type: recurringInvoice.discount_type,
        discount_account_id: recurringInvoice.discount_account_id,
        discount_account_name: recurringInvoice.discount_account_name,
        tds_override_preference: recurringInvoice.tds_override_preference,
        is_discount_before_tax: recurringInvoice.is_discount_before_tax,
        adjustment: recurringInvoice.adjustment,
        adjustment_formatted: recurringInvoice.adjustment_formatted,
        adjustment_description: recurringInvoice.adjustment_description,
        tax_amount_withheld: recurringInvoice.tax_amount_withheld,
        tax_amount_withheld_formatted:
          recurringInvoice.tax_amount_withheld_formatted,
        bcy_sub_total: recurringInvoice.bcy_sub_total,
        bcy_discount_total: recurringInvoice.bcy_discount_total,
        bcy_tax_total: recurringInvoice.bcy_tax_total,
        bcy_total: recurringInvoice.bcy_total,
        total: recurringInvoice.total,
        total_formatted: recurringInvoice.total_formatted,
        total_text: numberToWordsINR(recurringInvoice.total),
        balance: recurringInvoice.balance,
        balance_formatted: recurringInvoice.balance_formatted,
        line_items: recurringInvoice.line_items || [],
        customer_name: recurringInvoice.customer_name,
        customer_id: recurringInvoice.customer_id,
        reference_number: recurringInvoice.reference_number,
        organization_details: organization || {},
        invoices_for_customer: invoicesForCustomer,
        history: recurringInvoice.comments,
        manual_invoice_total: manualInvoiceTotal,
        manual_invoice_total_formatted: `₹${manualInvoiceTotal.toFixed(2)}`,
        manually_created_invoice_count: manualInvoiceCount,
        applied_filter: filter_status || "all",
        recurrence_name: recurringInvoice.recurrence_name,
        place_of_supply: recurringInvoice.place_of_supply,
        payment_terms_label: recurringInvoice.payment_terms_label,
        payment_terms: recurringInvoice.payment_terms,
        repeat_value: recurringInvoice.repeat_value,
        invoice_pagination: {
          page: pageNum,
          per_page: limitNum,
          total: manualInvoiceCount,
          has_more_page: hasMorePage,
        },
        customer_Data: customerDetails,
      };
      
      console.log("Response data admin_id:", responseData.admin_id);
      console.log("Full response data keys:", Object.keys(responseData));
      
      return res.status(200).json({
        code: 0,
        message: "Recurring invoice retrieved successfully",
        data: responseData,
      });
    } catch (error) {
      console.error("getRecurringInvoiceById Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to fetch recurring invoice.",
        error: error.message,
      });
    }
  }
  // 📌get RecurringInvoice
  async getRecurringInvoices(req, res) {
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
      console.log(req.query);

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
        case "Status.Draft":
          query.status = "draft";
          break;
        case "Status.Active":
          query.status = "active";
          break;
        case "Status.Stopped":
          query.status = "stopped";
          break;
        case "Status.Expired":
          query.status = "expired";
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
        console.log(customer_id, "customer_idcustomer_id");
        query.customer_id = customer_id;
      }

      const allowedSortColumns = [
        "customer_name",
        "recurrence_name",
        "next_invoice_date",
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

      // Fetch specific fields
      const projection = {
        _id: 1,
        admin_id: 1,
        recurring_invoice_id: 1,
        customer_id: 1,
        customer_name: 1,
        company_name: 1,
        status: 1,
        status_formatted: 1,
        recurring_number: 1,
        reference_number: 1,
        date: 1,
        date_formatted: 1,
        start_date: 1,
        profile_name: 1,
        recurrence_name: 1,
        start_date_formatted: 1,
        next_invoice_date: 1,
        next_invoice_date_formatted: 1,
        end_date: 1,
        end_date_formatted: 1,
        currency_id: 1,
        currency_code: 1,
        recurrence_frequency: 1,
        repeat_every: 1,
        recurrence_preferences: 1,
        send_email: 1,
        total: 1,
        total_formatted: 1,
        sub_total: 1,
        sub_total_formatted: 1,
        tax_total: 1,
        tax_total_formatted: 1,
        discount_total: 1,
        discount_total_formatted: 1,
        created_time: 1,
        last_modified_time: 1,
        salesperson_id: 1,
        salesperson_name: 1,
        custom_field_hash: 1,
        tax_type: 1,
        adjustment: 1,
        documents: 1,
      };

      // Fetch recurring invoices with pagination & sorting
      const results = await queryHelper.findData(
        RecurringInvoiceCollection,
        query,
        projection,
        sort,
        limit,
        page
      );

      // Check if recurring invoices exist
      const recurringInvoices = results?.status ? results.msg : [];
      const totalCount = await queryHelper.countDocuments(
        RecurringInvoiceCollection,
        query
      );
      const hasMorePage = page * limit < totalCount;

      // Transform recurring invoices to match expected output
      const transformedRecurringInvoices = await Promise.all(
        recurringInvoices.map(async (recurringInvoice) => {
          // Extract the actual recurring invoice object if it's a Mongoose document
          const recurringInvoiceData = recurringInvoice._doc
            ? recurringInvoice._doc
            : recurringInvoice;

          let customer_name = recurringInvoiceData.customer_name || "";
          let company_name = "";

          // Fetch customer details if customer_id is present
          if (recurringInvoiceData.customer_id) {
            try {
              const [contactResponse] = await axios.all([
                apiHandler.getContactInformation(
                  recurringInvoiceData.customer_id,
                  organization_id,
                  req.headers.authorization
                ),
              ]);

              if (contactResponse?.data?.data) {
                customer_name =
                  contactResponse.data.data.contact_name || customer_name;
                company_name = contactResponse.data.data.company_name || "";
              }
            } catch (error) {
              console.error(
                "Error fetching customer information:",
                error.message
              );
            }
          }

          // Calculate recurrence status for display purposes
          let recurrenceStatus = "Active";
          const now = new Date();
          const endDate = recurringInvoiceData.end_date
            ? new Date(recurringInvoiceData.end_date)
            : null;

          if (recurringInvoiceData.status === "stopped") {
            recurrenceStatus = "Stopped";
          } else if (endDate && endDate < now) {
            recurrenceStatus = "Expired";
          } else if (recurringInvoiceData.status === "draft") {
            recurrenceStatus = "Draft";
          }

          let frequency = "";
          const freqMap = {
            day: "Day",
            days: "Day",
            week: "Week",
            weeks: "Week",
            month: "Month",
            months: "Month",
            year: "Year",
            years: "Year",
          };

          const freqKey = recurringInvoiceData.recurrence_frequency
            ?.toLowerCase()
            ?.trim();
          const unit = freqMap[freqKey];

          if (unit) {
            if (recurringInvoiceData.repeat_every === 1) {
              frequency = `${unit}ly`; // e.g., Daily, Weekly
            } else {
              frequency = `Every ${recurringInvoiceData.repeat_every} ${unit}s`; // e.g., Every 2 Weeks
            }
          } else {
            console.warn(
              "Unknown frequency:",
              recurringInvoiceData.recurrence_frequency
            );
            frequency = "Invalid Frequency";
          }

          return {
            admin_id: recurringInvoiceData.admin_id || "",
            recurring_invoice_id:
              recurringInvoiceData.recurring_invoice_id || "",
            _id: recurringInvoiceData._id || "",
            customer_id: recurringInvoiceData.customer_id || "",
            customer_name: customer_name,
            company_name: company_name,
            status: recurringInvoiceData.status || "",
            status_formatted: recurringInvoiceData.status_formatted || "",
            recurrence_status: recurrenceStatus,
            recurring_number: recurringInvoiceData.recurring_number || "",
            reference_number: recurringInvoiceData.reference_number || "",
            date: recurringInvoiceData.date || "",
            date_formatted: recurringInvoiceData.date_formatted || "",
            start_date: recurringInvoiceData.start_date || "",
            start_date_formatted:
              recurringInvoiceData.start_date_formatted || "",
            next_invoice_date: recurringInvoiceData.next_invoice_date || "",
            next_invoice_date_formatted:
              recurringInvoiceData.next_invoice_date_formatted || "",
            end_date: recurringInvoiceData.end_date || "",
            end_date_formatted: recurringInvoiceData.end_date_formatted || "",
            currency_id: recurringInvoiceData.currency_id || "",
            currency_code: recurringInvoiceData.currency_code || "",
            recurrence_frequency: frequency,
            repeat_every: recurringInvoiceData.repeat_every || 1,
            recurrence_preferences:
              recurringInvoiceData.recurrence_preferences || "save_as_draft",
            send_email: !!recurringInvoiceData.send_email,
            total: recurringInvoiceData.total || 0,
            total_formatted: recurringInvoiceData.total_formatted || "",
            total_text: numberToWordsINR(recurringInvoice.total),
            sub_total: recurringInvoiceData.sub_total || 0,
            sub_total_formatted: recurringInvoiceData.sub_total_formatted || "",
            tax_total: recurringInvoiceData.tax_total || 0,
            tax_total_formatted: recurringInvoiceData.tax_total_formatted || "",
            discount_total: recurringInvoiceData.discount_total || 0,
            discount_total_formatted:
              recurringInvoiceData.discount_total_formatted || "",
            created_time: recurringInvoiceData.created_time || "",
            last_modified_time: recurringInvoiceData.last_modified_time || "",
            salesperson_id: recurringInvoiceData.salesperson_id || "",
            salesperson_name: recurringInvoiceData.salesperson_name || "",
            custom_field_hash: recurringInvoiceData.custom_field_hash || {},
            tax_type: recurringInvoiceData.tax_type || "",
            adjustment: recurringInvoiceData.adjustment || 0,
            next_invoice_date_next_sentence: `Next Invoice on ${recurringInvoiceData.next_invoice_date} `,
            profile_name: recurringInvoiceData.recurrence_name || "",
            recurrence_name: recurringInvoiceData.recurrence_name || "",
            documents: recurringInvoiceData.documents || null,
          };
        })
      );

      // Construct response
      return res.status(200).json({
        code: 0,
        message: "success",
        recurring_invoices: transformedRecurringInvoices,
        totalCount: totalCount,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage,
          report_name: "Recurring Invoices",
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
  // 📌update Recurring Invoice
  async updateRecurringInvoice(req, res) {
    try {
      const bData = req.body;
      const { organization_id, recurring_invoice_id } = req.query;
      const admin_id = res.locals.user_id;

      // Validate required fields
      if (!organization_id || !recurring_invoice_id) {
        return res.status(400).json({
          status: false,
          message: "Organization ID and Recurring Invoice ID are required",
        });
      }

      // Find the existing recurring invoice
      const existingInvoice = await RecurringInvoiceCollection.findOne({
        organization_id,
        recurring_invoice_id,
        deleted_at: null,
      }).lean();

      if (!existingInvoice) {
        return res.status(404).json({
          status: false,
          message: "Recurring invoice not found",
        });
      }

      // Track changes for comment generation
      const changesTracking = [];

      // Format dates properly as strings for storage
      const currentDate = new Date();

      // Update start date if provided
      if (bData.start_date) {
        try {
          const oldDate = existingInvoice.start_date_formatted || "Not set";
          const newDate = new Date(bData.start_date).toLocaleDateString(
            "en-GB"
          );
          bData.start_date_formatted = newDate;

          if (oldDate !== newDate) {
            changesTracking.push(
              `Start date changed from ${oldDate} to ${newDate}`
            );
          }
        } catch (err) {
          console.error("Start date formatting error:", err);
          bData.start_date_formatted = new Date(
            existingInvoice.start_date
          ).toLocaleDateString("en-GB");
        }
      }

      // Update next invoice date if provided
      if (bData.next_invoice_date) {
        try {
          const oldDate =
            existingInvoice.next_invoice_date_formatted || "Not set";
          const newDate = new Date(bData.next_invoice_date).toLocaleDateString(
            "en-GB"
          );
          bData.next_invoice_date_formatted = newDate;

          if (oldDate !== newDate) {
            changesTracking.push(
              `Next invoice date changed from ${oldDate} to ${newDate}`
            );
          }
        } catch (err) {
          console.error("Next invoice date formatting error:", err);
          bData.next_invoice_date_formatted = new Date(
            existingInvoice.next_invoice_date
          ).toLocaleDateString("en-GB");
        }
      }

      // Handle end date update if provided
      if (bData.end_date) {
        try {
          const oldDate = existingInvoice.end_date_formatted || "Not set";
          const newDate = new Date(bData.end_date).toLocaleDateString("en-GB");
          bData.end_date_formatted = newDate;

          if (oldDate !== newDate) {
            changesTracking.push(
              `End date changed from ${oldDate} to ${newDate}`
            );
          }
        } catch (err) {
          console.error("End date formatting error:", err);
          // Keep existing end date if new one is invalid
          if (existingInvoice.end_date) {
            bData.end_date = existingInvoice.end_date;
            bData.end_date_formatted = existingInvoice.end_date_formatted;
          } else {
            // Don't set an end date if it's invalid and no existing one
            delete bData.end_date;
            delete bData.end_date_formatted;
          }
        }
      }

      // Update metadata fields
      bData.last_modified_by_id = admin_id;
      bData.last_modified_time = currentDate;

      // If status is being updated, format it properly and track change
      if (bData.status) {
        // Map status to formatted status
        const statusMap = {
          draft: "Draft",
          active: "Active",
          stopped: "Stopped",
          expired: "Expired",
          resume: "Active",
        };
        const newStatus = statusMap[bData.status] || "Draft";
        bData.status_formatted = newStatus;

        if (existingInvoice.status_formatted !== newStatus) {
          changesTracking.push(
            `Status changed from ${
              existingInvoice.status_formatted || "Not set"
            } to ${newStatus}`
          );
        }
      }

      // Process line items if provided
      let subTotalChanged = false;
      let oldSubTotal = existingInvoice.sub_total || 0;
      let newSubTotal = 0;

      if (bData.line_items && bData.line_items.length > 0) {
        let subTotal = 0;

        // Track line item changes
        const oldLineItemsCount = existingInvoice.line_items?.length || 0;
        const newLineItemsCount = bData.line_items.length;

        if (oldLineItemsCount !== newLineItemsCount) {
          changesTracking.push(
            `Line items count changed from ${oldLineItemsCount} to ${newLineItemsCount}`
          );
        }

        bData.line_items.forEach((item) => {
          // Generate line item ID if not provided
          if (!item.line_item_id) {
            item.line_item_id = Math.random().toString(36).substring(2, 15);
          }

          // Ensure numeric values
          item.quantity = parseFloat(item.quantity || 0);
          item.rate = parseFloat(item.rate || 0);

          // Calculate line total
          const lineTotal = item.quantity * item.rate;
          item.item_total = lineTotal;
          item.item_total_formatted = `₹${lineTotal.toFixed(2)}`;
          item.item_total_inclusive_of_tax = lineTotal;
          item.item_total_inclusive_of_tax_formatted = `₹${lineTotal.toFixed(
            2
          )}`;

          // Add progress invoice details
          if (!item.progress_invoice_details) {
            item.progress_invoice_details = {
              invoiced_quantity: 0,
              invoiced_quantity_formatted: "0.00",
              invoiced_value: 0,
              invoiced_value_formatted: "₹0.00",
              balance_amount: lineTotal,
              balance_amount_formatted: `₹${lineTotal.toFixed(2)}`,
              is_invoiced: false,
            };
          }

          // Handle tags
          if (!Array.isArray(item.tags)) {
            item.tags = []; // Default to an empty array if tags are missing or invalid
          } else {
            // Validate and ensure tags match the schema
            item.tags = item.tags.filter((tag) => {
              return (
                typeof tag === "object" &&
                tag !== null &&
                typeof tag.tag_id === "number" &&
                typeof tag.tag_option_id === "number"
              );
            });
          }

          subTotal += lineTotal;
        });

        // Inject subtotal into bData
        newSubTotal = subTotal;
        bData.sub_total = subTotal;
        bData.sub_total_formatted = `₹${subTotal.toFixed(2)}`;
        bData.bcy_sub_total = subTotal;

        if (oldSubTotal !== newSubTotal) {
          subTotalChanged = true;
          changesTracking.push(
            `Subtotal changed from ₹${oldSubTotal.toFixed(
              2
            )} to ₹${newSubTotal.toFixed(2)}`
          );
        }

        // Calculate discount if applicable
        let discountAmount = 0;
        let oldDiscountAmount = existingInvoice.discount_amount || 0;

        if (bData.discount_type === "percentage" && bData.discount_percent) {
          discountAmount =
            (subTotal * parseFloat(bData.discount_percent)) / 100;

          if (bData.discount_percent !== existingInvoice.discount_percent) {
            changesTracking.push(
              `Discount percentage changed from ${
                existingInvoice.discount_percent || 0
              }% to ${bData.discount_percent}%`
            );
          }
        } else if (bData.discount_amount) {
          discountAmount = parseFloat(bData.discount_amount);

          if (existingInvoice.discount_amount !== bData.discount_amount) {
            changesTracking.push(
              `Discount amount changed from ₹${
                existingInvoice.discount_amount || 0
              } to ₹${bData.discount_amount}`
            );
          }
        }

        bData.discount_amount = discountAmount;
        bData.discount_amount_formatted = `₹${discountAmount.toFixed(2)}`;
        bData.discount_total = discountAmount;
        bData.discount_total_formatted = `₹${discountAmount.toFixed(2)}`;
        bData.bcy_discount_total = discountAmount;

        const subTotalAfterDiscount = subTotal - discountAmount;
        bData.sub_total_exclusive_of_discount = subTotalAfterDiscount;
        bData.sub_total_exclusive_of_discount_formatted = `₹${subTotalAfterDiscount.toFixed(
          2
        )}`;

        // Calculate tax amount if applicable
        let taxTotal = 0;
        let oldTaxTotal = existingInvoice.tax_total || 0;
        let taxesChanged = false;

        if (
          bData.taxes &&
          Array.isArray(bData.taxes) &&
          bData.taxes.length > 0
        ) {
          // Check if taxes configuration has changed
          if (
            !existingInvoice.taxes ||
            !Array.isArray(existingInvoice.taxes) ||
            existingInvoice.taxes.length !== bData.taxes.length
          ) {
            taxesChanged = true;
          }

          bData.taxes.forEach((tax, index) => {
            const taxBase = bData.is_discount_before_tax
              ? subTotalAfterDiscount
              : subTotal;
            const taxAmount = parseFloat(
              ((taxBase * (parseFloat(tax.tax_percentage) || 0)) / 100).toFixed(
                2
              )
            );
            tax.tax_amount = taxAmount;
            tax.tax_amount_formatted = `₹${taxAmount.toFixed(2)}`;
            taxTotal += taxAmount;

            // Check if this specific tax has changed
            if (
              !taxesChanged &&
              existingInvoice.taxes &&
              existingInvoice.taxes[index] &&
              existingInvoice.taxes[index].tax_percentage !== tax.tax_percentage
            ) {
              taxesChanged = true;
            }
          });
        }

        bData.tax_total = taxTotal;
        bData.tax_total_formatted = `₹${taxTotal.toFixed(2)}`;
        bData.bcy_tax_total = taxTotal;

        if (taxesChanged || oldTaxTotal !== taxTotal) {
          changesTracking.push(
            `Tax total changed from ₹${oldTaxTotal.toFixed(
              2
            )} to ₹${taxTotal.toFixed(2)}`
          );
        }

        // Calculate final total
        const shippingCharge = parseFloat(bData.shipping_charge || 0);
        const oldShippingCharge = existingInvoice.shipping_charge || 0;

        if (oldShippingCharge !== shippingCharge) {
          changesTracking.push(
            `Shipping charge changed from ₹${oldShippingCharge.toFixed(
              2
            )} to ₹${shippingCharge.toFixed(2)}`
          );
        }

        const adjustment = parseFloat(bData.adjustment || 0);
        const oldAdjustment = existingInvoice.adjustment || 0;

        if (oldAdjustment !== adjustment) {
          changesTracking.push(
            `Adjustment changed from ₹${oldAdjustment.toFixed(
              2
            )} to ₹${adjustment.toFixed(2)}`
          );
        }

        // Calculate total properly accounting for discounts
        let total =
          subTotal - discountAmount + taxTotal + shippingCharge + adjustment;
        const oldTotal = existingInvoice.total || 0;

        bData.total = total;
        bData.total_formatted = `₹${total.toFixed(2)}`;
        bData.bcy_total = total;

        if (oldTotal !== total) {
          changesTracking.push(
            `Total amount changed from ₹${oldTotal.toFixed(
              2
            )} to ₹${total.toFixed(2)}`
          );
        }

        // Calculate balance
        const paymentMade = parseFloat(bData.payment_made || 0);
        const creditsApplied = parseFloat(bData.credits_applied || 0);

        // Don't double-count discount in balance calculation
        const balance = total - paymentMade - creditsApplied;
        const oldBalance = existingInvoice.balance || oldTotal;

        bData.balance = balance;
        bData.balance_formatted = `₹${balance.toFixed(2)}`;

        if (oldBalance !== balance) {
          changesTracking.push(
            `Balance changed from ₹${oldBalance.toFixed(
              2
            )} to ₹${balance.toFixed(2)}`
          );
        }
      }

      // Update recurrence settings if provided
      if (
        bData.recurrence_frequency &&
        bData.recurrence_frequency !== existingInvoice.recurrence_frequency
      ) {
        changesTracking.push(
          `Recurrence frequency changed from ${
            existingInvoice.recurrence_frequency || "Not set"
          } to ${bData.recurrence_frequency}`
        );
      }

      if (bData.repeat_every) {
        const newRepeatEvery = parseInt(bData.repeat_every || 1);
        const oldRepeatEvery = existingInvoice.repeat_every || 1;

        if (oldRepeatEvery !== newRepeatEvery) {
          changesTracking.push(
            `Repeat every changed from ${oldRepeatEvery} to ${newRepeatEvery}`
          );
        }
      }

      if (
        bData.hasOwnProperty("recurrence_preferences") &&
        bData.recurrence_preferences !== existingInvoice.recurrence_preferences
      ) {
        changesTracking.push(
          `Recurrence preferences changed from ${
            existingInvoice.recurrence_preferences || "save_as_draft"
          } to ${bData.recurrence_preferences}`
        );
      }

      if (
        bData.hasOwnProperty("send_email") &&
        bData.send_email !== existingInvoice.send_email
      ) {
        changesTracking.push(
          `Send email setting changed from ${
            existingInvoice.send_email ? "Yes" : "No"
          } to ${bData.send_email ? "Yes" : "No"}`
        );
      }

      // Update billing and shipping addresses if provided
      if (bData.billing_address) {
        const oldAddress = existingInvoice.billing_address || {};
        const newAddress = {
          street:
            bData.billing_address?.street ||
            existingInvoice.billing_address?.street ||
            "",
          address:
            bData.billing_address?.address ||
            existingInvoice.billing_address?.address ||
            "",
          street2:
            bData.billing_address?.street2 ||
            existingInvoice.billing_address?.street2 ||
            "",
          city:
            bData.billing_address?.city ||
            existingInvoice.billing_address?.city ||
            "",
          state:
            bData.billing_address?.state ||
            existingInvoice.billing_address?.state ||
            "",
          zip:
            bData.billing_address?.zip ||
            existingInvoice.billing_address?.zip ||
            "",
          country:
            bData.billing_address?.country ||
            existingInvoice.billing_address?.country ||
            "",
          fax:
            bData.billing_address?.fax ||
            existingInvoice.billing_address?.fax ||
            "",
          phone:
            bData.billing_address?.phone ||
            existingInvoice.billing_address?.phone ||
            "",
          attention:
            bData.billing_address?.attention ||
            existingInvoice.billing_address?.attention ||
            "",
        };

        // Check if any billing address field has changed
        const addressFields = [
          "street",
          "address",
          "street2",
          "city",
          "state",
          "zip",
          "country",
          "phone",
        ];
        let billingAddressChanged = false;

        for (const field of addressFields) {
          if (newAddress[field] !== oldAddress[field]) {
            billingAddressChanged = true;
            break;
          }
        }

        if (billingAddressChanged) {
          changesTracking.push(`Billing address updated`);
        }

        bData.billing_address = newAddress;
      }

      if (bData.shipping_address) {
        const oldAddress = existingInvoice.shipping_address || {};
        const newAddress = {
          street:
            bData.shipping_address?.street ||
            existingInvoice.shipping_address?.street ||
            "",
          address:
            bData.shipping_address?.address ||
            existingInvoice.shipping_address?.address ||
            "",
          street2:
            bData.shipping_address?.street2 ||
            existingInvoice.shipping_address?.street2 ||
            "",
          city:
            bData.shipping_address?.city ||
            existingInvoice.shipping_address?.city ||
            "",
          state:
            bData.shipping_address?.state ||
            existingInvoice.shipping_address?.state ||
            "",
          zip:
            bData.shipping_address?.zip ||
            existingInvoice.shipping_address?.zip ||
            "",
          country:
            bData.shipping_address?.country ||
            existingInvoice.shipping_address?.country ||
            "",
          fax:
            bData.shipping_address?.fax ||
            existingInvoice.shipping_address?.fax ||
            "",
          phone:
            bData.shipping_address?.phone ||
            existingInvoice.shipping_address?.phone ||
            "",
          attention:
            bData.shipping_address?.attention ||
            existingInvoice.shipping_address?.attention ||
            "",
        };

        // Check if any shipping address field has changed
        const addressFields = [
          "street",
          "address",
          "street2",
          "city",
          "state",
          "zip",
          "country",
          "phone",
        ];
        let shippingAddressChanged = false;

        for (const field of addressFields) {
          if (newAddress[field] !== oldAddress[field]) {
            shippingAddressChanged = true;
            break;
          }
        }

        if (shippingAddressChanged) {
          changesTracking.push(`Shipping address updated`);
        }

        bData.shipping_address = newAddress;
      }

      // Create comment for the update
      const commentDescription =
        changesTracking.length > 0
          ? `Recurring invoice updated: ${changesTracking.join(", ")}`
          : `Recurring invoice updated with no significant changes`;

      const commentData = {
        comment_id: await commonHelper.generateUniqueId(
          RecurringInvoiceCollection,
          "comment_id",
          5,
          "CMT"
        ),
        description: commentDescription,
        commented_by_id: admin_id,
        commented_by: res.locals.user_name || "System",
        comment_type: "system",
        date: currentDate.toISOString(),
        date_formatted: currentDate.toLocaleDateString("en-GB"),
        date_with_time: `${currentDate.toLocaleDateString(
          "en-GB"
        )} ${currentDate.toLocaleTimeString("en-GB")}`,
        date_description: `Updated on ${currentDate.toLocaleDateString(
          "en-GB"
        )}`,
        time: currentDate.toLocaleTimeString("en-GB"),
        operation_type: "Updated",
        transaction_id: recurring_invoice_id,
        transaction_type: "recurring_invoice",
        sentiment: "neutral",
        changes: changesTracking,
      };

      // Update the comments array
      if (!bData.comments) {
        bData.comments = existingInvoice.comments || [];
      }
      bData.comments.push(commentData);

      // Execute the update
      try {
        const updateResult = await RecurringInvoiceCollection.findOneAndUpdate(
          {
            organization_id,
            recurring_invoice_id,
            deleted_at: null,
          },
          { $set: bData },
          { new: true }
        ).lean();

        if (!updateResult) {
          return res.status(404).json({
            code: 1,
            message:
              "Failed to update recurring invoice. Invoice not found or access denied.",
          });
        }

        return res.status(200).json({
          code: 0,
          message: "Recurring invoice updated successfully",
          data: updateResult,
        });
      } catch (dbError) {
        console.error("Database Update Error:", dbError);
        return res.status(500).json({
          code: 1,
          message: "Database error while updating recurring invoice",
          error: dbError.message,
        });
      }
    } catch (err) {
      console.error("Update Recurring Invoice Error:", err);
      return res.status(500).json({
        code: 1,
        message: "Internal server error while updating recurring invoice",
        error: err.message,
      });
    }
  }
  // 📌soft delete Recurring Invoice
  async deleteRecurringInvoice(req, res) {
    try {
      const { organization_id, recurring_invoice_id } = req.query;
      const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!organization_id || !recurring_invoice_id) {
        return res.status(400).json({
          code: 1,
          message: "Organization ID and Recurring Invoice ID are required",
        });
      }

      // Find the existing recurring invoice
      const existingInvoice = await RecurringInvoiceCollection.findOne({
        organization_id,
        recurring_invoice_id,
        deleted_at: null,
      }).lean();

      if (!existingInvoice) {
        return res.status(404).json({
          code: 1,
          message: "Recurring invoice not found or already deleted",
        });
      }

      // Current date for the deletion timestamp
      const currentDate = new Date();

      // Prepare update data for soft delete
      const updateData = {
        deleted_at: currentDate,
        status: "deleted",
        status_formatted: "Deleted",
        last_modified_by_id: admin_id,
        last_modified_time: currentDate,
      };

      // Create comment for the deletion
      const commentData = {
        comment_id: await commonHelper.generateUniqueId(
          RecurringInvoiceCollection,
          "comment_id",
          5,
          "CMT"
        ),
        description: `Recurring invoice deleted ${existingInvoice.total_formatted}`,
        commented_by_id: admin_id,
        commented_by: res.locals.user_name || "System",
        comment_type: "system",
        date: currentDate.toISOString(),
        date_formatted: currentDate.toLocaleDateString("en-GB"),
        date_with_time: `${currentDate.toLocaleDateString(
          "en-GB"
        )} ${currentDate.toLocaleTimeString("en-GB")}`,
        date_description: `Deleted on ${currentDate.toLocaleDateString(
          "en-GB"
        )}`,
        time: currentDate.toLocaleTimeString("en-GB"),
        operation_type: "Deleted",
        transaction_id: recurring_invoice_id,
        transaction_type: "recurring_invoice",
        sentiment: "negative",
      };

      // Execute the soft delete with comment addition
      try {
        const updateResult = await RecurringInvoiceCollection.findOneAndUpdate(
          {
            organization_id,
            recurring_invoice_id,
            deleted_at: null,
          },
          {
            $set: updateData,
            $push: { history: commentData },
          },
          { new: true }
        ).lean();

        if (!updateResult) {
          return res.status(404).json({
            code: 1,
            message:
              "Failed to delete recurring invoice. Invoice not found or already deleted.",
          });
        }

        return res.status(200).json({
          code: 0,
          message: "Recurring invoice deleted successfully",
        });
      } catch (dbError) {
        console.error("Database Delete Error:", dbError);
        return res.status(500).json({
          code: 1,
          message: "Database error while deleting recurring invoice",
          error: dbError.message,
        });
      }
    } catch (err) {
      console.error("Delete Recurring Invoice Error:", err);
      return res.status(500).json({
        code: 1,
        message: "Internal server error while deleting recurring invoice",
        error: err.message,
      });
    }
  }
}

module.exports = new RecurringInvoiceController();
