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
const { createInvoiceData } = require("../helpers/invoiceHelper");
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
  // async createInvoice(req, res) {
  //   try {
  //     let bData = req.body;
  //     const { organization_id } = req.query;

  //     let documents = bData.documents;

  //     if (req.file) {
  //       documents = req.file.filename;
  //     }

  //     console.log("documents of invoice", documents);

  //     // Validate required organization ID
  //     if (!organization_id) {
  //       return res.status(400).json({
  //         status: false,
  //         message: "Organization ID is required",
  //       });
  //     }

  //     // Generate unique invoice ID
  //     const invoiceUniqueId = await commonHelper.generateUniqueId(
  //       InvoiceCollection,
  //       "invoice_id",
  //       6
  //     );
  //     bData.invoice_id = invoiceUniqueId;

  //     // Generate or validate invoice number
  //     if (!bData.invoice_number) {
  //       const uniqueInvoiceNumber = await commonHelper.generateUniqueId(
  //         InvoiceCollection,
  //         "invoice_number",
  //         6,
  //         "INV"
  //       );
  //       bData.invoice_number = uniqueInvoiceNumber;
  //     } else {
  //       const providedInvoiceNumber = bData.invoice_number.trim();
  //       if (!providedInvoiceNumber.startsWith("INV-")) {
  //         return res.status(400).json({
  //           code: 1,
  //           message:
  //             "Invalid invoice_number format. It must start with 'INV-'.",
  //         });
  //       }
  //       bData.invoice_number = providedInvoiceNumber;
  //     }

  //     // Add user and status information
  //     const userId = res.locals.user_id;
  //     bData.created_by_id = userId;
  //     bData.last_modified_by_id = userId;
  //     bData.status = bData.status || "draft";
  //     bData.status_formatted = bData.status_formatted || "Draft";
  //     bData.organization_id = organization_id;

  //     // Set dates
  //     const currentDate = new Date();
  //     bData.date = bData.date || currentDate.toISOString();
  //     const parsedDate = new Date(bData.date);
  //     bData.date_formatted = parsedDate.toLocaleDateString("en-GB");

  //     const dueDate =
  //       bData.due_date ||
  //       new Date(parsedDate.setDate(parsedDate.getDate() + 30));
  //     bData.due_date = dueDate;
  //     bData.due_date_formatted = new Date(dueDate).toLocaleDateString("en-GB");

  //     // Defaults for optional fields
  //     const defaultFields = {
  //       customer_name: "",
  //       place_of_supply: "",
  //       order_number: "",
  //       vat_treatment: "",
  //       tax_treatment: "",
  //       is_reverse_charge_applied: false,
  //       gst_treatment: "",
  //       gst_no: "",
  //       cfdi_usage: "",
  //       reference_number: "",
  //       invoiced_estimate_id: "",
  //       salesperson_name: "",
  //       allow_partial_payments: false,
  //       custom_body: "",
  //       custom_subject: "",
  //       shipping_charge: 0,
  //       adjustment: 0,
  //       adjustment_description: "",
  //       reason: "",
  //       tax_authority_id: "",
  //       tax_exemption_id: "",
  //       billing_address_id: "",
  //       shipping_address_id: "",
  //       avatax_use_code: "",
  //       avatax_exempt_no: "",
  //       tax_id: bData.tcs_id || bData.tds_id || "",
  //       expense_id: "",
  //       salesorder_item_id: "",
  //       avatax_tax_code: "",
  //       time_entry_ids: [],
  //       discount_amount: 0,
  //       discount_percent: 0,
  //       tax_type: "",
  //       payment_terms_label: "",
  //       payment_terms: "",
  //       tds_option: "",
  //     };

  //     for (const key in defaultFields) {
  //       if (bData[key] === undefined) {
  //         bData[key] = defaultFields[key];
  //       }
  //     }

  //     // Handle line items
  //     if (Array.isArray(bData.line_items) && bData.line_items.length > 0) {
  //       let subTotal = 0;

  //       bData.line_items.forEach((item) => {
  //         if (!item.line_item_id) {
  //           item.line_item_id = Math.random().toString(36).substring(2, 15);
  //         }

  //         const quantity = item.quantity || 0;
  //         const rate = item.rate || 0;
  //         const lineTotal = quantity * rate;

  //         item.item_total = lineTotal;
  //         item.item_total_formatted = `₹${lineTotal.toFixed(2)}`;
  //         item.item_total_inclusive_of_tax = lineTotal;
  //         item.item_total_inclusive_of_tax_formatted = `₹${lineTotal.toFixed(
  //           2
  //         )}`;

  //         item.progress_invoice_details = {
  //           invoiced_quantity: 0,
  //           invoiced_quantity_formatted: "0.00",
  //           invoiced_value: 0,
  //           invoiced_value_formatted: "₹0.00",
  //           balance_amount: lineTotal,
  //           balance_amount_formatted: `₹${lineTotal.toFixed(2)}`,
  //           is_invoiced: false,
  //         };

  //         item.tags = Array.isArray(item.tags)
  //           ? item.tags.filter(
  //               (tag) =>
  //                 typeof tag.tag_id === "number" &&
  //                 typeof tag.tag_option_id === "number"
  //             )
  //           : [];

  //         subTotal += lineTotal;
  //       });

  //       bData.sub_total = subTotal;
  //       bData.sub_total_formatted = `₹${subTotal.toFixed(2)}`;
  //       bData.bcy_sub_total = subTotal;

  //       // Calculate discount
  //       let discountAmount = bData.discount_amount || 0;
  //       if (bData.discount_type === "percentage" && bData.discount_percent) {
  //         discountAmount = (subTotal * bData.discount_percent) / 100;
  //       }

  //       let discountAmt = Number(discountAmount) || 0;

  //       bData.discount_amount = discountAmt;
  //       bData.discount_total = discountAmt;
  //       bData.discount_total_formatted = `₹${discountAmt.toFixed(2)}`;
  //       bData.bcy_discount_total = discountAmt;

  //       const subTotalAfterDiscount = subTotal - discountAmt;
  //       bData.sub_total_exclusive_of_discount = subTotalAfterDiscount;
  //       bData.sub_total_exclusive_of_discount_formatted = `₹${subTotalAfterDiscount.toFixed(
  //         2
  //       )}`;

  //       // Tax calculations
  //       let taxTotal = 0;
  //       if (Array.isArray(bData.taxes)) {
  //         bData.taxes.forEach((tax) => {
  //           const taxBase = bData.is_discount_before_tax
  //             ? subTotalAfterDiscount
  //             : subTotal;
  //           const taxAmount = (
  //             (taxBase * (tax.tax_percentage || 0)) /
  //             100
  //           ).toFixed(2);
  //           tax.tax_amount = taxAmount;
  //           taxTotal += parseFloat(taxAmount);
  //         });
  //       }

  //       bData.tax_total = taxTotal;
  //       bData.tax_total_formatted = `₹${taxTotal.toFixed(2)}`;
  //       bData.bcy_tax_total = taxTotal;

  //       // Final total
  //       const shippingCharge = bData.shipping_charge || 0;
  //       const adjustment = bData.adjustment || 0;
  //       const total = Number(
  //         subTotal - discountAmount + taxTotal + shippingCharge + adjustment
  //       );

  //       bData.total = total;
  //       bData.total_formatted = `₹${total.toFixed(2)}`;
  //       bData.bcy_total = total;

  //       // Final balance
  //       const paymentMade = bData.payment_made || 0;
  //       const creditsApplied = bData.credits_applied || 0;
  //       const balance = total - paymentMade - creditsApplied;
  //       bData.balance = balance;
  //       bData.balance_formatted = `₹${balance.toFixed(2)}`;
  //     }

  //     // Billing and shipping address structure
  //     // const addressFields = [
  //     //   "address",
  //     //   "street2",
  //     //   "city",
  //     //   "state",
  //     //   "zip",
  //     //   "country",
  //     //   "fax",
  //     //   "phone",
  //     //   "attention",
  //     // ];

  //     // // bData.billing_address = {};
  //     // // bData.shipping_address = {};

  //     // addressFields.forEach((field) => {
  //     //   bData.billing_address[field] = bData.billing_address?.[field] || "";
  //     //   bData.shipping_address[field] = bData.shipping_address?.[field] || "";
  //     // });

  //     // Attach document if any
  //     bData.documents = documents;

  //     // Save to database
  //     const invoiceCreated = await InvoiceCollection.create(bData);

  //     res.status(200).json({
  //       status: true,
  //       message: "Invoice created successfully",
  //       data: invoiceCreated,
  //     });
  //   } catch (error) {
  //     console.error("Error creating invoice:", error);
  //     res.status(500).json({
  //       status: false,
  //       message: "Internal server error",
  //       error: error.message,
  //     });
  //   }
  // }

  async createInvoice(req, res) {
    try {
      const invoiceData = await createInvoiceData(req, req.body);
      const sub_total = Number(invoiceData.sub_total); // 2000
      const discount = Number(invoiceData.discount_amount); // 0
      const adjustment = Number(invoiceData.adjustment); // 0
      const tax_percentage = Number(invoiceData.tax_percentage); // 2
      const tax_type = invoiceData.tax_type; // "TDS" or "TCS"
      const tax_amount = (tax_percentage / 100) * (sub_total - discount); // 40
      const total_receivable =
        sub_total -
        discount +
        (tax_type === "TCS" ? tax_amount : -tax_amount) +
        adjustment; // 1960
      let journalUniqueId = await commonHelper.generateUniqueId(
        JournalCollection,
        "journal_id",
        5,
        "JL"
      );

      invoiceData["sub_total_formatted"] = formatCurrency(
        invoiceData.sub_total
      );
      invoiceData["total_formatted"] = formatCurrency(invoiceData.total);
      invoiceData["balance_formatted"] = formatCurrency(invoiceData.balance);
      // console.log(invoiceData, "----------invoiceData");
      // return;
      const Journal_line_items = [
        {
          coa_account_id: "AC_046",
          coa_account_name: "Sales",
          creditOrDebit: "Credit",
          amount: sub_total,
          amount_formatted: sub_total,
        },
      ];

      // Add tax-specific entry
      if (tax_type === "TCS") {
        Journal_line_items.push({
          coa_account_id: "AC_025",
          coa_account_name: "TCS Payable",
          creditOrDebit: "Credit",
          amount: tax_amount,
          amount_formatted: formatCurrency(tax_amount),
        });
      } else if (tax_type === "TDS") {
        Journal_line_items.push({
          coa_account_id: "AC_006",
          coa_account_name: "TDS Receivable",
          creditOrDebit: "Debit",
          amount: tax_amount,
          amount_formatted: formatCurrency(tax_amount),
        });
      }

      // Add adjustment if any
      if (adjustment !== 0) {
        Journal_line_items.push({
          coa_account_id: "AC_044",
          coa_account_name: "Other Charges",
          creditOrDebit: "Credit",
          amount: Math.abs(adjustment),
          amount_formatted: formatCurrency(adjustment),
        });
      }
      if (discount !== 0) {
        Journal_line_items.push({
          coa_account_id: "AC_050",
          coa_account_name: "Discount",
          creditOrDebit: "Debit",
          amount: Math.abs(discount),
          amount_formatted: formatCurrency(discount),
        });
      }

      // Final receivable
      Journal_line_items.push({
        coa_account_id: "AC_019",
        coa_account_name: "Accounts Receivable",
        creditOrDebit: "Debit",
        amount: total_receivable,
        amount_formatted: formatCurrency(total_receivable),
      });

      // console.log(Journal_line_items, "Journal_line_items");
      const journalData = {
        organization_id: invoiceData.organization_id,
        admin_id: invoiceData.admin_id,
        journal_id: journalUniqueId,
        journal_date: invoiceData.date,
        journal_date_formatted: invoiceData.date_formatted,
        total_amount: total_receivable,
        total_amount_formatted: formatCurrency(total_receivable),
        type: "Invoice",
        customer_name: invoiceData.customer_name,
        line_items: Journal_line_items,
      };
      invoiceData["journal_id"] = journalUniqueId;

      const savedJournal = await JournalCollection.create(journalData);

      const savedInvoice = await new InvoiceCollection(invoiceData).save();
      res.status(200).json({
        status: true,
        message: "Invoice has been added",
        data: savedInvoice,
      });
    } catch (error) {
      res.status(500).json({
        status: false,
        message: error.message || "Something went wrong",
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
  // 📌 Update invoice
  // async updateInvoice(req, res) {
  //   try {
  //     const { organization_id, invoice_id } = req.query;
  //     let updateData = { ...req.body };

  //     let documents = updateData.documents;
  //     if (req.file) {
  //       documents = req.file.filename;
  //     }

  //     updateData["documents"] = documents;

  //     // Validate required query params
  //     if (!organization_id || !invoice_id) {
  //       return res.status(400).json({
  //         code: 1,
  //         message:
  //           "Missing required parameters: organization_id and invoice_id",
  //       });
  //     }

  //     // Find existing invoice
  //     let invoice = await InvoiceCollection.findOne({
  //       invoice_id,
  //       organization_id,
  //       deleted_at: null, // Ensure it's not already soft-deleted
  //     });

  //     if (!invoice) {
  //       return res.status(404).json({
  //         code: 1,
  //         message: "Unauthorized or invoice not found",
  //       });
  //     }

  //     // Recalculate totals if line items are updated
  //     if (updateData.line_items && updateData.line_items.length > 0) {
  //       let subTotal = 0;

  //       // Calculate sub-total from line items
  //       updateData.line_items.forEach((item) => {
  //         const lineTotal = (item.quantity || 0) * (item.rate || 0);
  //         item.item_total = lineTotal;
  //         subTotal += lineTotal;
  //       });

  //       updateData["sub_total"] = subTotal;

  //       // Calculate tax amount if applicable
  //       const taxRate =
  //         updateData.tax_percentage || invoice.tax_percentage || 0;
  //       const taxAmount = (subTotal * taxRate) / 100;
  //       updateData["tax_total"] = taxAmount;

  //       // Calculate discount if applicable
  //       const discountAmount =
  //         updateData.discount_amount || invoice.discount_amount || 0;

  //       // Calculate final total
  //       updateData["total"] = subTotal + taxAmount - discountAmount;
  //     }

  //     // Perform the update
  //     let updatedInvoice = await InvoiceCollection.findOneAndUpdate(
  //       { invoice_id, organization_id },
  //       { $set: updateData },
  //       { new: true } // Return the updated document
  //     );

  //     // Success Response
  //     return res.status(200).json({
  //       code: 0,
  //       message: "Invoice updated successfully",
  //       invoice: updatedInvoice,
  //     });
  //   } catch (error) {
  //     console.error("updateInvoice Error:", error.message);
  //     return res.status(500).json({
  //       code: 1,
  //       message: "Internal Server Error: Unable to update invoice",
  //       error: error.message,
  //     });
  //   }
  // }

  async updateInvoice(req, res) {
    try {
      const { organization_id, invoice_id } = req.query;
      let updateData = { ...req.body };

      let documents = updateData.documents;
      if (req.file) {
        documents = req.file.filename;
      }

      updateData["documents"] = documents;

      // Validate required query params
      if (!organization_id || !invoice_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and invoice_id",
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
          code: 1,
          message: "Unauthorized or invoice not found",
        });
      }

      // ✅ Recalculate totals using the same logic as createInvoice
      if (updateData.line_items && updateData.line_items.length > 0) {
        let subTotal = 0;

        // Calculate sub-total from line items
        updateData.line_items.forEach((item) => {
          const lineTotal = (item.quantity || 0) * (item.rate || 0);
          item.item_total = lineTotal;
          subTotal += lineTotal;
        });

        updateData["sub_total"] = subTotal;
      }

      // ✅ Use existing values or updated values for calculations
      const sub_total = Number(updateData.sub_total || invoice.sub_total || 0);
      const discount = Number(
        updateData.discount_amount || invoice.discount_amount || 0
      );
      const adjustment = Number(
        updateData.adjustment || invoice.adjustment || 0
      );
      const tax_percentage = Number(
        updateData.tax_percentage || invoice.tax_percentage || 0
      );
      const tax_type = updateData.tax_type || invoice.tax_type || "";

      // Calculate tax amount using same logic as createInvoice
      const tax_amount = (tax_percentage / 100) * (sub_total - discount);

      // Calculate total receivable using same logic as createInvoice
      const total_receivable =
        sub_total -
        discount +
        (tax_type === "TCS" ? tax_amount : -tax_amount) +
        adjustment;

      // Update calculated values
      updateData["tax_amount"] = tax_amount;
      updateData["total"] = total_receivable;
      updateData["balance"] = total_receivable; // Assuming balance equals total for new invoices

      // Add formatted currency fields
      updateData["sub_total_formatted"] = formatCurrency(sub_total);
      updateData["total_formatted"] = formatCurrency(total_receivable);
      updateData["balance_formatted"] = formatCurrency(total_receivable);

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

      // Add discount if any
      if (discount !== 0) {
        Journal_line_items.push({
          coa_account_id: "AC_050",
          coa_account_name: "Discount",
          creditOrDebit: "Debit",
          amount: Math.abs(discount),
          amount_formatted: formatCurrency(Math.abs(discount)),
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
        journal_date: updateData.date || invoice.date,
        journal_date_formatted:
          updateData.date_formatted || invoice.date_formatted,
        total_amount: total_receivable,
        total_amount_formatted: formatCurrency(total_receivable),
        customer_name: updateData.customer_name || invoice.customer_name,
        line_items: Journal_line_items,
      };

      // ✅ Update the existing journal entry
      const updateJournal = await JournalCollection.findOneAndUpdate(
        { journal_id: invoice.journal_id }, // Use existing journal_id
        { $set: updatedJournal },
        { new: true, runValidators: true }
      );

      if (!updateJournal) {
        return res.status(404).json({
          code: 1,
          message: "Journal entry not found for this invoice",
        });
      }

      // ✅ Update the invoice
      let updatedInvoice = await InvoiceCollection.findOneAndUpdate(
        { invoice_id, organization_id },
        { $set: updateData },
        { new: true }
      );

      if (!updatedInvoice) {
        return res.status(404).json({
          code: 1,
          message: "Failed to update invoice",
        });
      }

      // Success Response
      return res.status(200).json({
        code: 0,
        message: "Invoice and journal updated successfully",
        invoice: updatedInvoice,
        journal: updateJournal,
      });
    } catch (error) {
      console.error("updateInvoice Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to update invoice",
        error: error.message,
      });
    }
  }
  // 📌 Delete invoice (soft delete)
  async deleteInvoice(req, res) {
    try {
      const { organization_id, invoice_id } = req.query;

      // Validate required parameters
      if (!organization_id || !invoice_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and invoice_id",
        });
      }

      console.log("Input Parameters:", { organization_id, invoice_id });

      // Convert invoice_id and organization_id to strings to match database format
      const formattedInvoiceId = String(invoice_id);
      const formattedOrganizationId = String(organization_id);
      let findInvoice = await InvoiceCollection.findOne({
        invoice_id: formattedInvoiceId,
      });
      if (findInvoice.journal_id != "") {
        let findJournal = await JournalCollection.findOneAndDelete({
          journal_id: findInvoice.journal_id,
        });
      }
      let invoice = await InvoiceCollection.findOne({
        invoice_id: formattedInvoiceId, // Ensure query uses the correct format
        organization_id: formattedOrganizationId,
        deleted_at: null, // Ensure it's not already soft-deleted
      });

      if (!invoice) {
        console.warn("Invoice not found for the given parameters:", {
          organization_id: formattedOrganizationId,
          invoice_id: formattedInvoiceId,
        });
        return res.status(404).json({
          code: 1,
          message: "Invoice not found for this organization",
        });
      }

      // Perform soft delete by setting deleted_at timestamp
      invoice.deleted_at = new Date();
      await invoice.save();

      // Check if the invoice is a "convert invoice" (has estimate_id)
      if (invoice.estimate_id) {
        // Validate estimate_id to ensure it's a valid ObjectId
        if (mongoose.Types.ObjectId.isValid(invoice.estimate_id)) {
          const estimate = await EstimateCollection.findById(
            invoice.estimate_id
          );

          if (estimate) {
            // Remove the deleted invoice's ID from the invoice_ids array
            estimate.invoice_ids = estimate.invoice_ids.filter(
              (id) => id !== invoice.invoice_id
            );

            // Remove the deleted invoice's details from the invoices array
            estimate.invoices = estimate.invoices.filter(
              (inv) => inv.invoice_id !== invoice.invoice_id
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

              // Optionally, clear current_sub_status and current_sub_status_formatted
              estimate.current_sub_status = null;
              estimate.current_sub_status_formatted = null;
            }

            // Save the updated estimate
            await estimate.save();
          } else {
            console.warn(`Estimate with ID ${invoice.estimate_id} not found.`);
          }
        } else {
          console.warn(
            `Invalid estimate_id (${invoice.estimate_id}) for invoice ${invoice.invoice_id}. Skipping estimate update.`
          );
        }
      } else {
        console.log("This is a direct invoice. No estimate to update.");
      }

      // Success Response
      return res.status(200).json({
        code: 0,
        message: "Invoice deleted successfully", // Soft delete
        invoice: invoice,
      });
    } catch (error) {
      console.error("deleteInvoice Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to delete invoice",
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
          message: "Sales Order not found or unauthorized access",
        });
      }

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
