const mongoose = require("mongoose");

// A holding: fixed deposit, mutual fund, shares, gold, a loan given, and so on.
// scope "company" holdings are posted to the books; "personal" ones are the
// owner's own tracking and never touch the ledger.
const InvestmentSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    scope: { type: String, enum: ["company", "personal"], required: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["fixed_deposit", "mutual_fund", "shares", "bonds", "gold", "loan_given", "property", "other"], default: "other" },
    institution: { type: String, default: "", trim: true },
    purchase_date: { type: Date, required: true },
    cost: { type: Number, required: true },
    units: { type: Number, default: 0 },
    interest_rate: { type: Number, default: 0 },
    maturity_date: { type: Date, default: null },
    note: { type: String, default: "" },
    status: { type: String, enum: ["active", "closed"], default: "active" },
    // Dated values, oldest first. The latest is the current value.
    valuations: [{ date: { type: Date, required: true }, value: { type: Number, required: true }, note: { type: String, default: "" } }],
    journal_id: { type: String, default: "" }, // company: the entry that booked the purchase
    closed: {
      date: Date,
      proceeds: Number,
      gain_or_loss: Number,
      journal_id: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Investment || mongoose.model("Investment", InvestmentSchema);
