const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema(
  {
    recurring_expense_id: { type: String },
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

const RecurringExpenseModel = new mongoose.Schema(
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
    vendor_name: {
      type: String,
      default: "",
    },
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      default: "",
    },
    customer_name: {
      type: String,
      default: "",
    },
    recurring_expense_id: {
      type: String,
    },
    item_list: [
      {
        expense_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Expense",
        },
        expense_number: {
          type: String,
        },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    recurrence_name: {
      type: String,
    },
    recurrence_frequency: {
      type: String,
    },
    recurrence_frequency_formatted: {
      type: String,
    },
    repeat_every: {
      type: Number,
    },
    last_created_date: {
      type: Date,
      default: Date.now,
    },
    last_created_date_formatted: {
      type: String,
    },
    next_expense_date: {
      type: Date,
      default: "",
    },
    next_expense_date_formatted: {
      type: String,
    },
    start_date: {
      type: Date,
    },
    start_date_formatted: {
      type: String,
    },
    end_date: {
      type: Date,
      default: "",
    },
    end_date_formatted: {
      type: String,
    },
    profile_name: {
      type: String,
    },
    account_name: {
      type: String,
    },
    paid_through_account_name: {
      type: String,
    },
    description: { type: String },
    currency_id: { type: String },
    currency_name: { type: String },
    total: { type: Number },
    total_formatted: { type: String },
    status: { type: String },
    status_formatted: { type: String },
    invoice_number: String,
    inclusive_exclusive: String,
    base_amount: Number,
    source_of_supply: String,
    destination_of_supply: String,
    hsn_code: String,
    sac_code: String,
    reverse_charge: Boolean,
    expense_tax_percent: String,
    expense_tax_amount: Number,
    expense_type: String,
    gst_treatment: String,
    gst_no: String,
    is_billable: Boolean,
    is_deleted: {
      type: Boolean,
      default: false,
    },
    comments: [CommentSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Recurring_Expense", RecurringExpenseModel);
