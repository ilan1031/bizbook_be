const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
    journal_id : {type: String},
    unique_PM_id: {
      type: String,
    },
    payment_id: {
      type: String,
    },
    documents: {
      type: String,
    },
    contact_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact", // Reference to Vendor collection
      // required: true,
    },
    payment_mode: {
      type: String,
    },
    payment_type: { type: String },
    description: { type: String },
    date: { type: Date },
    reference_number: { type: String },
    amount: { type: Number },
    paid_through_account_id: { type: String },
    gst_treatment: { type: String },
    source_of_supply: { type: String },
    destination_of_supply: { type: String },
    reverse_charge_tax: { type: String },
    bills: [
      {
        bill_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "PO_bill", // Reference to Vendor collection
        },
        billNumber: { type: String },
        amount_applied: { type: Number },
        total_payment_amount: { type: Number },
      },
    ],
    custom_fields: [
      {
        field_name: String,
        field_value: mongoose.Schema.Types.Mixed, // Can hold different types of values
      },
    ],
    is_tds_amount_in_percent: { type: String },
    is_advance_payment: { type: Boolean, default: false },
    organization_id: { type: String },
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    // Status management fields
    status: {
      type: Number,
      default: 1, // 1 = DRAFT, 2 = PAID, 3 = VOID
    },
    status_type: {
      type: String,
      default: "DRAFT", // DRAFT, PAID, VOID
    },
    status_formatted: {
      type: String,
      default: "Draft", // Draft, Paid, Void
    },
    status_updated_at: {
      type: Date,
      default: null,
    },
    is_deleted: {
      type: Boolean,
      default: false,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
    deleted_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", PaymentSchema);
