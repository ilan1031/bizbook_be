const mongoose = require('mongoose');
const { Schema } = mongoose;

// Define the schema for the credit note
const CreditNoteSchema = new Schema({
  code: { type: Number }, // Status code (e.g., 0 for success)
  message: { type: String }, // Message indicating the result
  creditnote: {
    type: new Schema({
      creditnote_id: { type: String }, // Unique ID of the credit note
      creditnote_number: { type: String }, // Human-readable credit note number
      status: { type: String }, // Current status (e.g., "draft")
      status_formatted: { type: String }, // Formatted status
      date: { type: String }, // Date in ISO format
      date_formatted: { type: String }, // Formatted date
      reference_number: { type: String }, // Reference number (optional)
      is_emailed: { type: Boolean, default: false }, // Whether the credit note has been emailed
      notes: { type: String }, // Additional notes
      terms: { type: String }, // Terms and conditions
      created_time: { type: String }, // Timestamp of creation
      created_by_id: { type: String }, // ID of the creator
      last_modified_by_id: { type: String }, // ID of the last modifier
      last_modified_time: { type: String }, // Timestamp of last modification
      subject_content: { type: String }, // Subject content (optional)
      invoice_id: { type: String }, // Associated invoice ID (optional)
      invoices_credited: [{ type: String }], // List of credited invoices
      customer_id: { type: String }, // Customer ID
      customer_name: { type: String }, // Customer name
      is_portal_enabled: { type: Boolean, default: true }, // Whether the portal is enabled
      is_viewed_by_client: { type: Boolean, default: false }, // Whether viewed by the client
      client_viewed_time: { type: String }, // Timestamp when viewed by the client
      client_viewed_time_formatted: { type: String }, // Formatted timestamp
      contact_persons: [{ type: String }], // List of contact person IDs
      contact_persons_associated: [{
        contact_person_id: { type: String },
        contact_person_email: { type: String },
        first_name: { type: String },
        last_name: { type: String },
        mobile: { type: String },
        communication_preference: {
          is_email_enabled: { type: Boolean }
        }
      }],
      salesperson_id: { type: String }, // Salesperson ID (optional)
      salesperson_name: { type: String }, // Salesperson name (optional)
      tds_calculation_type: { type: String }, // TDS calculation type
      is_pre_gst: { type: Boolean }, // Pre-GST flag
      contact_category: { type: String }, // Contact category (optional)
      tax_rounding: { type: String }, // Tax rounding method
      tds_override_preference: { type: String }, // TDS override preference
      color_code: { type: String }, // Color code (optional)
      current_sub_status_id: { type: String }, // Sub-status ID
      current_sub_status: { type: String }, // Current sub-status
      current_sub_status_formatted: { type: String }, // Formatted sub-status
      sub_statuses: [{ type: String }], // List of sub-statuses
      template_id: { type: String }, // Template ID
      template_type: { type: String }, // Template type (e.g., "excel")
      template_type_formatted: { type: String }, // Formatted template type
      template_name: { type: String }, // Template name
      page_width: { type: String }, // Page width (e.g., "8.27in")
      page_height: { type: String }, // Page height (e.g., "11.69in")
      orientation: { type: String }, // Page orientation (e.g., "portrait")
      currency_id: { type: String }, // Currency ID
      currency_code: { type: String }, // Currency code (e.g., "INR")
      currency_symbol: { type: String }, // Currency symbol (e.g., "₹")
      currency_name_formatted: { type: String }, // Formatted currency name
      exchange_rate: { type: Number }, // Exchange rate
      price_precision: { type: Number }, // Price precision
      is_inclusive_tax: { type: Boolean }, // Whether prices include tax
      discount_amount_formatted: { type: String }, // Formatted discount amount
      discount_amount: { type: Number }, // Discount amount
      discount: { type: Number }, // Discount percentage
      discount_applied_on_amount_formatted: { type: String }, // Formatted discount applied amount
      discount_applied_on_amount: { type: Number }, // Discount applied amount
      is_discount_before_tax: { type: Boolean }, // Whether discount is applied before tax
      discount_type: { type: String }, // Discount type (e.g., "entity_level")
      discount_account_id: { type: String }, // Discount account ID
      discount_account_name: { type: String }, // Discount account name
      is_eway_bill_required: { type: Boolean }, // E-way bill requirement
      ewaybills: [{ type: String }], // List of e-way bills
      dispatch_from_address: { type: Object }, // Dispatch address (optional)
      line_items: [{
        item_id: { type: String },
        line_item_id: { type: String },
        account_id: { type: String },
        account_name: { type: String },
        name: { type: String },
        internal_name: { type: String },
        description: { type: String },
        item_order: { type: Number },
        invoice_id: { type: String },
        invoice_item_id: { type: String },
        quantity: { type: Number },
        pricing_scheme: { type: String },
        unit: { type: String },
        item_custom_fields: [{ type: Object }],
        project_id: { type: String },
        pricebook_id: { type: String },
        discount: { type: Number },
        discounts: [{ type: Object }],
        discount_account_id: { type: String },
        discount_account_name: { type: String },
        bcy_rate: { type: Number },
        bcy_rate_formatted: { type: String },
        rate: { type: Number },
        rate_formatted: { type: String },
        sales_margin: { type: String },
        tax_id: { type: String },
        tax_name: { type: String },
        tax_type: { type: String },
        tax_percentage: { type: Number },
        tds_tax_id: { type: String },
        tds_tax_name: { type: String },
        tds_tax_percentage: { type: String },
        tds_tax_amount: { type: Number },
        tds_tax_amount_formatted: { type: String },
        line_item_taxes: [{ type: Object }],
        line_item_tds: [{ type: Object }],
        item_total: { type: Number },
        item_total_formatted: { type: String },
        item_total_inclusive_of_tax: { type: Number },
        item_total_inclusive_of_tax_formatted: { type: String },
        item_type: { type: String },
        item_type_formatted: { type: String },
        tags: [{ type: String }],
        is_credit_only_item: { type: Boolean }
      }],
      submitter_id: { type: String }, // Submitter ID (optional)
      approver_id: { type: String }, // Approver ID (optional)
      submitted_date: { type: String }, // Submitted date (optional)
      submitted_date_formatted: { type: String }, // Formatted submitted date
      submitted_by: { type: String }, // Submitted by (optional)
      submitted_by_name: { type: String }, // Name of the submitter
      submitted_by_email: { type: String }, // Email of the submitter
      submitted_by_photo_url: { type: String }, // Photo URL of the submitter
      documents: [{ type: Object }], // List of documents
      custom_fields: [{ type: Object }], // Custom fields
      custom_field_hash: { type: Object }, // Custom field hash
      is_square_transaction: { type: Boolean }, // Square transaction flag
      shipping_charge_tax_id: { type: String }, // Shipping charge tax ID
      shipping_charge_tax_name: { type: String }, // Shipping charge tax name
      shipping_charge_tax_type: { type: String }, // Shipping charge tax type
      shipping_charge_tax_percentage: { type: String }, // Shipping charge tax percentage
      shipping_charge_tax_exemption_id: { type: String }, // Shipping charge tax exemption ID
      shipping_charge_tax_exemption_code: { type: String }, // Shipping charge tax exemption code
      shipping_charge_tax: { type: String }, // Shipping charge tax
      bcy_shipping_charge_tax: { type: String }, // BCY shipping charge tax
      shipping_charge_exclusive_of_tax: { type: Number }, // Shipping charge exclusive of tax
      shipping_charge_inclusive_of_tax: { type: Number }, // Shipping charge inclusive of tax
      shipping_charge_tax_formatted: { type: String }, // Formatted shipping charge tax
      shipping_charge_exclusive_of_tax_formatted: { type: String }, // Formatted exclusive tax
      shipping_charge_inclusive_of_tax_formatted: { type: String }, // Formatted inclusive tax
      shipping_charge_account_id: { type: String }, // Shipping charge account ID
      shipping_charge_account_name: { type: String }, // Shipping charge account name
      shipping_charge: { type: Number }, // Shipping charge
      shipping_charge_formatted: { type: String }, // Formatted shipping charge
      adjustment: { type: Number }, // Adjustment amount
      adjustment_formatted: { type: String }, // Formatted adjustment
      adjustment_description: { type: String }, // Adjustment description
      roundoff_value: { type: Number }, // Round-off value
      roundoff_value_formatted: { type: String }, // Formatted round-off value
      transaction_rounding_type: { type: String }, // Transaction rounding type
      sub_total: { type: Number }, // Subtotal
      sub_total_formatted: { type: String }, // Formatted subtotal
      sub_total_inclusive_of_tax: { type: Number }, // Subtotal inclusive of tax
      sub_total_inclusive_of_tax_formatted: { type: String }, // Formatted subtotal inclusive of tax
      tax_total: { type: Number }, // Tax total
      tax_total_formatted: { type: String }, // Formatted tax total
      total: { type: Number }, // Total amount
      total_formatted: { type: String }, // Formatted total
      total_credits_used: { type: Number }, // Total credits used
      total_refunded_amount: { type: Number }, // Total refunded amount
      balance: { type: Number }, // Balance
      balance_formatted: { type: String }, // Formatted balance
      taxes: [{ type: Object }], // List of taxes
      computation_type: { type: String }, // Computation type
      tds_summary: [{ type: Object }], // TDS summary
      creditnote_refunds: [{ type: Object }], // Credit note refunds
      comments: [{
        comment_id: { type: String },
        creditnote_id: { type: String },
        description: { type: String },
        commented_by_id: { type: String },
        commented_by: { type: String },
        comment_type: { type: String },
        date: { type: String },
        date_formatted: { type: String },
        date_description: { type: String },
        time: { type: String },
        operation_type: { type: String },
        transaction_id: { type: String },
        transaction_type: { type: String }
      }],
      billing_address: {
        address: { type: String },
        street2: { type: String },
        city: { type: String },
        state: { type: String },
        zip: { type: String },
        country: { type: String },
        fax: { type: String },
        phone: { type: String },
        attention: { type: String }
      },
      shipping_address: {
        address: { type: String },
        street2: { type: String },
        city: { type: String },
        state: { type: String },
        zip: { type: String },
        country: { type: String },
        fax: { type: String },
        phone: { type: String },
        attention: { type: String }
      },
      lock_details: { type: Object }, // Lock details (optional)
      approvers_list: [{ type: Object }] // List of approvers
    })
  }
});

// Create the model
const CreditNote = mongoose.model('CreditNote', CreditNoteSchema);

module.exports = CreditNote;