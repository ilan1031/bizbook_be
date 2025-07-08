const mongoose = require("mongoose");

const AddressSchema = new mongoose.Schema({
  address: String,
  street2: String,
  city: String,
  state: String,
  zip: String,
  country: String,
  fax: String,
  phone: String,
  attention: String,
});

const DocumentSchema = new mongoose.Schema(
  {
    file_name: String,
    file_size: Number,
    file_type: String,
    uploaded_by: String,
  },
  {
    timestamps: true,
  }
);

const LineItemSchema = new mongoose.Schema({
  item_id: String,
  amount: Number,
  name: String,
  account: String,
  quantity: Number,
  rate: Number,
  discount: Number,
  tax: String,
  tax_id: String,
  tds_tax_id: String,
  item_total: Number,
  unit: String,
  details: String,
});

const CommentSchema = new mongoose.Schema(
  {
    comment_id: { type: String },
    estimate_id: { type: String },
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
    transaction_type: { type: String },
    sentiment: { type: String },
  },
  {
    timestamps: true,
  }
);

const RecurringBillSchema = new mongoose.Schema(
  {
    recurring_bill_id: String,
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    organization_id: {
      type: Number,
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact", // Reference to Vendor collection
    },

    // Extra Added Schema

    vendorName: { type: String },
    discount_level: { type: String },
    discount_account: { type: String },
    tax_amount: { type: Number },
    tds_option: { type: String },
    tax_percentage: { type: Number, default: 0 },
    repeat_value: { type: String },
    custom_repeat_count: { type: String },
    custom_repeat_frequency: { type: String },
    source: { type: String },
    notes: { type: String },
    source_of_supply: { type: String },
    destination_of_supply: { type: String },
    gst_no: { type: String },
    status: { type: Number, default: 0 }, // 0 - active , 1 - stopped
    status_type: { type: String },
    start_date: String,
    end_date: String,
    last_sent_date: String,
    next_bill_date: String,
    tax_type: String,
    recurrence_frequency: { type: String },
    repeat_every: { type: Number, default: 0 },
    recurrence_name: { type: String },
    currency_id: { type: String },
    payment_terms: { type: Number },
    payment_terms_label: { type: String },
    exchange_rate: { type: Number },
    journal_id: String,
    line_items: [LineItemSchema],
    billing_address: AddressSchema,
    comments: [CommentSchema],
    documents: [DocumentSchema],
    total: { type: Number, default: 0 },
    sub_total: { type: Number, default: 0 },
    adjustment: { type: Number, default: 0 },
    discount_percent: { type: Number, default: 0 },
    discount_type: { type: String, default: "percentage" },
    discount_amount: { type: Number, default: 0 },
    adjustment_description: { type: String },
    client_viewed_time: { type: String, default: null },
    client_viewed_time_formatted: { type: String, default: null },
    is_expired: { type: Boolean, default: false },
    is_viewed_by_client: Boolean,
    created_by_id: String,
    last_modified_id: String,
    deleted_at: {
      type: Date,
      default: null,
    },
    created_time: { type: Date, default: Date.now },
    last_modified_time: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

const RecurringBill = mongoose.model("recurringBill", RecurringBillSchema);
module.exports = RecurringBill;
