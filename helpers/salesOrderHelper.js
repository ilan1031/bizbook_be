const SalesCollection = require("../model/salesOrder"); // Adjust path
const commonHelper = require("../helpers/commonHelpers"); // Your existing helper

exports.createSalesData = async (req, rawData) => {
  const { organization_id } = req.query;
  const userId = req.res?.locals?.user_id || null;

  let bData = { ...rawData };

  if (!organization_id) {
    throw new Error("Organization ID is required");
  }

  // Invoice ID
  bData.invoice_id = await commonHelper.generateUniqueId(
    SalesCollection,
    "salesorder_id",
    6
  );

  // Invoice number
  if (!bData.salesorder_number) {
    bData.salesorder_number = await commonHelper.generateUniqueId(
      SalesCollection,
      "salesorder_number",
      6,
      "SO"
    );
  } else {
    const trimmed = bData.salesorder_number.trim();
    if (!trimmed.startsWith("SO-")) {
      throw new Error(
        "Invalid salesorder_number format. It must start with 'SO-'"
      );
    }
    bData.salesorder_id = trimmed;
  }
  // Orders are keyed by their number (as when the form sends one).
  bData.salesorder_id = bData.salesorder_id || bData.salesorder_number;

  // User info and default status
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
