const InvoiceCollection = require("../model/invoice"); // Adjust path
const commonHelper = require("../helpers/commonHelpers"); // Your existing helper
const mongoose = require("mongoose");
const { postingStatusFor } = require("./accountingHelper");

const money = (amount) =>
  `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Posts the journal for an invoice that was saved without one (invoices
// converted from a quote, sales order or delivery challan) using the
// invoice's own totals, and links it to the invoice. Same lines as
// InvoiceController.createInvoice: Sales, TDS/TCS, discount, shipping,
// adjustment, and the receivable.
exports.postInvoiceJournal = async (invoice) => {
  if (!invoice || invoice.journal_id) return null;
  const JournalCollection = mongoose.model("Journal");
  const InvoiceModel = mongoose.model("Invoice");
  const num = (v) => Number(v || 0);
  const sub_total = num(invoice.sub_total);
  const discount = num(invoice.discount_amount);
  const tax = num(invoice.tax_total);
  const shipping = num(invoice.shipping_charge);
  const adjustment = num(invoice.adjustment);
  const total = num(invoice.total) || sub_total - discount + shipping + adjustment;

  const line = (coa_account_id, coa_account_name, creditOrDebit, amount) => ({
    coa_account_id,
    coa_account_name,
    creditOrDebit,
    amount,
    amount_formatted: money(amount),
  });
  const lines = [line("AC_046", "Sales", "Credit", sub_total)];
  if (invoice.tax_type === "TCS" && tax > 0) lines.push(line("AC_025", "TCS Payable", "Credit", tax));
  else if (invoice.tax_type === "TDS" && tax > 0) lines.push(line("AC_006", "TDS Receivable", "Debit", tax));
  if (discount > 0) lines.push(line("AC_050", "Discount", "Debit", discount));
  if (shipping > 0) lines.push(line("AC_045", "Shipping Charge", "Credit", shipping));
  if (adjustment !== 0) lines.push(line("AC_044", "Other Charges", adjustment > 0 ? "Credit" : "Debit", Math.abs(adjustment)));
  lines.push(line("AC_019", "Accounts Receivable", "Debit", total));

  const journal_id = await commonHelper.generateUniqueId(JournalCollection, "journal_id", 5, "JL");
  const journal = await JournalCollection.create({
    organization_id: String(invoice.organization_id),
    admin_id: invoice.admin_id,
    journal_id,
    journal_date: invoice.date || new Date(),
    journal_date_formatted: commonHelper.formatDateString(invoice.date || new Date()),
    total_amount: total,
    total_amount_formatted: money(total),
    type: "Invoice",
    customer_name: invoice.customer_name || "",
    line_items: lines,
    posting_status: postingStatusFor(invoice.status),
  });
  await InvoiceModel.updateOne({ _id: invoice._id }, { $set: { journal_id } });
  invoice.journal_id = journal_id;
  return journal;
};

exports.createInvoiceData = async (req, rawData) => {
  const { organization_id } = req.query;
  const userId = req.res?.locals?.user_id || null;

  let bData = { ...rawData };

  if (!organization_id) {
    throw new Error("Organization ID is required");
  }

  // Invoice ID
  bData.invoice_id = await commonHelper.generateUniqueId(
    InvoiceCollection,
    "invoice_id",
    6
  );

  // Invoice number
  if (!bData.invoice_number) {
    bData.invoice_number = await commonHelper.generateUniqueId(
      InvoiceCollection,
      "invoice_number",
      6,
      "INV"
    );
  } else {
    const trimmed = bData.invoice_number.trim();
    if (!trimmed.startsWith("INV-")) {
      throw new Error(
        "Invalid invoice_number format. It must start with 'INV-'"
      );
    }
    bData.invoice_number = trimmed;
  }

  // User info and default status
  bData.admin_id = bData.admin_id || userId;
  bData.created_by_id = userId;
  bData.last_modified_by_id = userId;
  bData.status = bData.status || "draft";
  bData.status_formatted = bData.status_formatted || "Draft";
  bData.organization_id = organization_id;

  // Dates
  const currentDate = new Date();
  const parsedDate = new Date(bData.date || currentDate);
  bData.date = parsedDate.toISOString();
  bData.date_formatted = parsedDate.toLocaleDateString("en-GB");

  const dueDate = new Date(parsedDate);
  dueDate.setDate(dueDate.getDate() + 30);
  bData.due_date = bData.due_date || dueDate.toISOString();
  bData.due_date_formatted = new Date(bData.due_date).toLocaleDateString(
    "en-GB"
  );
    let balance =0 ;
    bData.balance = bData.total;
    bData.balance_formatted = `₹${balance.toFixed(2)}`;

  // Set default fields
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
        tax_id: bData.tcs_id || bData.tds_id || "",
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
      };
    for (let key in defaultFields) {
        if (bData[key] === undefined) bData[key] = defaultFields[key];
    }

  return bData;
};


// exports.createInvoiceData = async (req, rawData) => {
//   const { organization_id } = req.query;
//   const userId = req.res?.locals?.user_id || null;

//   let bData = { ...rawData };

//   if (!organization_id) {
//     throw new Error("Organization ID is required");
//   }

//   // Generate unique invoice ID
//   bData.invoice_id = await commonHelper.generateUniqueId(
//     InvoiceCollection,
//     "invoice_id",
//     6
//   );

//   // Generate or validate invoice number
//   if (!bData.invoice_number) {
//     bData.invoice_number = await commonHelper.generateUniqueId(
//       InvoiceCollection,
//       "invoice_number",
//       6,
//       "INV"
//     );
//   } else {
//     const trimmed = bData.invoice_number.trim();
//     if (!trimmed.startsWith("INV-")) {
//       throw new Error(
//         "Invalid invoice_number format. It must start with 'INV-'"
//       );
//     }
//     bData.invoice_number = trimmed;
//   }

//   // Add user and status information
//   bData.created_by_id = userId;
//   bData.last_modified_by_id = userId;
//   bData.status = bData.status || "draft";
//   bData.status_formatted = bData.status_formatted || "Draft";
//   bData.organization_id = organization_id;

//   // Set dates
//   const currentDate = new Date();
//   bData.date = bData.date || currentDate.toISOString();
//   const parsedDate = new Date(bData.date);
//   bData.date_formatted = parsedDate.toLocaleDateString("en-GB");

//   const dueDate =
//     bData.due_date ||
//     new Date(parsedDate.setDate(parsedDate.getDate() + 30));
//   bData.due_date = dueDate;
//   bData.due_date_formatted = new Date(dueDate).toLocaleDateString("en-GB");

//   // Defaults for optional fields
//   const defaultFields = {
//     customer_name: "",
//     place_of_supply: "",
//     order_number: "",
//     vat_treatment: "",
//     tax_treatment: "",
//     is_reverse_charge_applied: false,
//     gst_treatment: "",
//     gst_no: "",
//     cfdi_usage: "",
//     reference_number: "",
//     invoiced_estimate_id: "",
//     salesperson_name: "",
//     allow_partial_payments: false,
//     custom_body: "",
//     custom_subject: "",
//     shipping_charge: 0,
//     adjustment: 0,
//     adjustment_description: "",
//     reason: "",
//     tax_authority_id: "",
//     tax_exemption_id: "",
//     billing_address_id: "",
//     shipping_address_id: "",
//     avatax_use_code: "",
//     avatax_exempt_no: "",
//     tax_id: bData.tcs_id || bData.tds_id || "",
//     expense_id: "",
//     salesorder_item_id: "",
//     avatax_tax_code: "",
//     time_entry_ids: [],
//     discount_amount: 0,
//     discount_percent: 0,
//     tax_type: "",
//     payment_terms_label: "",
//     payment_terms: "",
//     tds_option: "",
//   };

//   for (const key in defaultFields) {
//     if (bData[key] === undefined) {
//       bData[key] = defaultFields[key];
//     }
//   }

//   // Handle line items calculations
//   if (Array.isArray(bData.line_items) && bData.line_items.length > 0) {
//     let subTotal = 0;

//     bData.line_items.forEach((item) => {
//       if (!item.line_item_id) {
//         item.line_item_id = Math.random().toString(36).substring(2, 15);
//       }

//       const quantity = item.quantity || 0;
//       const rate = item.rate || 0;
//       const lineTotal = quantity * rate;

//       item.item_total = lineTotal;
//       item.item_total_formatted = `₹${lineTotal.toFixed(2)}`;
//       item.item_total_inclusive_of_tax = lineTotal;
//       item.item_total_inclusive_of_tax_formatted = `₹${lineTotal.toFixed(2)}`;

//       item.progress_invoice_details = {
//         invoiced_quantity: 0,
//         invoiced_quantity_formatted: "0.00",
//         invoiced_value: 0,
//         invoiced_value_formatted: "₹0.00",
//         balance_amount: lineTotal,
//         balance_amount_formatted: `₹${lineTotal.toFixed(2)}`,
//         is_invoiced: false,
//       };

//       item.tags = Array.isArray(item.tags)
//         ? item.tags.filter(
//             (tag) =>
//               typeof tag.tag_id === "number" &&
//               typeof tag.tag_option_id === "number"
//           )
//         : [];

//       subTotal += lineTotal;
//     });

//     bData.sub_total = subTotal;
//     bData.sub_total_formatted = `₹${subTotal.toFixed(2)}`;
//     bData.bcy_sub_total = subTotal;

//     // Calculate discount
//     let discountAmount = bData.discount_amount || 0;
//     if (bData.discount_type === "percentage" && bData.discount_percent) {
//       discountAmount = (subTotal * bData.discount_percent) / 100;
//     }

//     let discountAmt = Number(discountAmount) || 0;

//     bData.discount_amount = discountAmt;
//     bData.discount_total = discountAmt;
//     bData.discount_total_formatted = `₹${discountAmt.toFixed(2)}`;
//     bData.bcy_discount_total = discountAmt;

//     const subTotalAfterDiscount = subTotal - discountAmt;
//     bData.sub_total_exclusive_of_discount = subTotalAfterDiscount;
//     bData.sub_total_exclusive_of_discount_formatted = `₹${subTotalAfterDiscount.toFixed(2)}`;

//     // Tax calculations
//     let taxTotal = 0;
//     if (Array.isArray(bData.taxes)) {
//       bData.taxes.forEach((tax) => {
//         const taxBase = bData.is_discount_before_tax
//           ? subTotalAfterDiscount
//           : subTotal;
//         const taxAmount = (
//           (taxBase * (tax.tax_percentage || 0)) /
//           100
//         ).toFixed(2);
//         tax.tax_amount = taxAmount;
//         taxTotal += parseFloat(taxAmount);
//       });
//     }

//     bData.tax_total = taxTotal;
//     bData.tax_total_formatted = `₹${taxTotal.toFixed(2)}`;
//     bData.bcy_tax_total = taxTotal;

//     // Final total
//     const shippingCharge = bData.shipping_charge || 0;
//     const adjustment = bData.adjustment || 0;
//     const total = Number(
//       subTotal - discountAmount + taxTotal + shippingCharge + adjustment
//     );

//     console.log(total,"totaltotaltotaltotaltotal");
//     console.log(subTotal,"subTotalsubTotalsubTotalsubTotalsubTotal");
//     return
    

//     bData.total = total;
//     bData.total_formatted = `₹${total.toFixed(2)}`;
//     bData.bcy_total = total;

//     // Final balance
//     const paymentMade = bData.payment_made || 0;
//     const creditsApplied = bData.credits_applied || 0;
//     const balance = total - paymentMade - creditsApplied;
//     bData.balance = balance;
//     bData.balance_formatted = `₹${balance.toFixed(2)}`;
//   }

//   return bData;
// };