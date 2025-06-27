const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  organization_id: {
    type: String,
    required: true,
  },
  admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    required: true,
  },
  journal_id: {
    type: String,
  },
  transaction_id: {
    type: Number,
  },
  entity_name: {
    type: String,
  },
  entity_id: {
    type: String,
  },
  coa_account_id: {
    type: String,
  },
  amount: {
    type: Number,
  },
  amount_formatted: {
    type: String,
  },
  entity_data: {
    type: Date,
  },
  entity_data_formatted: {
    type: String,
  },
  user_id: {
    type: String,
  },
  user_name: {
    type: String,
  },
  credit_or_debit: { type: String, enum: ["Credit", "Debit"], required: true },
  opening_balance_status: {
    type: Boolean,
    default: false,
  },
  is_deleted: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("Transaction", transactionSchema);
