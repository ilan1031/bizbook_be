const mongoose = require("mongoose");

// One line of a bank (or cash) statement, imported so it can be matched to the
// books and the account reconciled. Amounts are signed: money in is positive,
// money out is negative.
const BankTransactionSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    // The bank or cash account of the chart of accounts this line belongs to.
    account_id: { type: String, required: true },
    date: { type: Date, required: true },
    description: { type: String, default: "" },
    reference: { type: String, default: "" },
    amount: { type: Number, required: true },
    // Identifies the line so importing the same statement twice adds nothing.
    fingerprint: { type: String, required: true },
    batch_id: { type: String, default: "" },
    status: { type: String, enum: ["unmatched", "matched", "ignored"], default: "unmatched" },
    matched_journal_id: { type: String, default: "" },
    matched_at: { type: Date },
    created_by_id: { type: String, default: "" },
  },
  { timestamps: true }
);

BankTransactionSchema.index({ organization_id: 1, account_id: 1, fingerprint: 1 }, { unique: true });
BankTransactionSchema.index({ organization_id: 1, admin_id: 1, account_id: 1, date: 1 });

module.exports = mongoose.models.BankTransaction || mongoose.model("BankTransaction", BankTransactionSchema);
