const mongoose = require("mongoose");

const LineItemSchema = new mongoose.Schema(
  {
    line_item_id: Number,
    // account_id: Number, // This is Collection Joints
    account_id: String,
    account_name: String,
    description: String,
    amount: Number,
    tax_id: Number,
    item_order: Number,
    product_type: String,
    acquisition_vat_id: String,
    reverse_charge_vat_id: String,
    reverse_charge_tax_id: Number,
    tax_exemption_code: String,
    tax_exemption_id: Number,
    location_id: String,
  },
  { _id: false }
);

const TaxSchema = new mongoose.Schema(
  {
    tax_id: Number,
    tax_amount: Number,
  },
  { _id: false }
);

const ExpenseSchema = new mongoose.Schema(
  {
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    organization_id: {
      type: Number,
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
    },
    journal_id: {
      type: String,
    },
    unique_EX_id: {
      type: String,
    },
    expense_id: String,
    // paid_through_account_id: Number,  // This is Collection Joints
    paid_through_account_id: String,
    paid_through_account_name: String,
    document: { type: String },
    account_id: Number,
    form_status: { type: Number, default: 0 },
    date: Date,
    invoice_number: String,
    tot_amount: Number,
    tot_amount_with_tax: Number,
    expense_type: String,
    inclusive_exclusive: String,  
    base_amount: Number,
    tax_id: Number,
    source_of_supply: String,
    destination_of_supply: String,
    place_of_supply: String,
    hsn_code: String,
    sac_code: String,
    hsn_or_sac: Number,
    gst_no: String,
    gst_treatment: String,
    vendor_gst_no: String,
    reverse_charge_tax_id: Number,
    reverse_charge: Boolean,
    expense_tax_percent: String,
    expense_tax_amount: Number,
    location_id: String,
    lineItems: [LineItemSchema],
    taxes: [TaxSchema],
    is_inclusive_tax: Boolean,
    is_billable: Boolean,
    reference_number: { type: String, default: null },
    description: String,
    // customer_id: Number,
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
    },
    currency_id: String,
    exchange_rate: Number,
    project_id: Number,
    odometer_start_reading: String,
    odometer_end_reading: String,
    mileage_method: String,
    mileage_type: String,
    vat_treatment: String,
    tax_treatment: String,
    product_type: String,
    acquisition_vat_id: String,
    reverse_charge_vat_id: String,
    start_reading: String,
    end_reading: String,
    distance: String,
    notes: String,
    // upload_image:String,
    mileage_unit: String,
    mileage_rate: String,
    employee_name: String,
    vehicle_type: String,
    can_reclaim_vat_on_mileage: String,
    fuel_type: String,
    markup_percent: String,
    engine_capacity_range: String,
    custom_fields: { type: Array, default: [] },
    type: {
      type: String,
      default: "",
    },
    status: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Expense", ExpenseSchema);
