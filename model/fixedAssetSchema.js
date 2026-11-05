const mongoose = require("mongoose");

// A fixed asset in the register. The purchase itself is booked the usual way
// (a bill, an expense or a journal); the register adds the depreciation.
const FixedAssetSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    asset_id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    purchase_date: { type: Date, required: true },
    // Depreciation begins in this date's month.
    depreciation_start_date: { type: Date, required: true },
    cost: { type: Number, required: true, min: 0 },
    salvage_value: { type: Number, default: 0, min: 0 },
    method: { type: String, enum: ["straight_line", "wdv"], default: "straight_line" },
    useful_life_months: { type: Number, default: 0 },
    // Yearly rate in percent, for the written-down-value method.
    rate: { type: Number, default: 0 },
    asset_account_id: { type: String, required: true },
    expense_account_id: { type: String, required: true },
    accumulated_account_id: { type: String, required: true },
    status: { type: String, enum: ["active", "disposed"], default: "active" },
    // One entry per month already posted to the books.
    postings: [{ month: String, amount: Number, journal_id: String, _id: false }],
    accumulated_depreciation: { type: Number, default: 0 },
    disposal: {
      date: Date,
      proceeds: Number,
      gain_or_loss: Number,
      journal_id: String,
    },
    created_by_id: { type: String, default: "" },
  },
  { timestamps: true }
);

FixedAssetSchema.index({ organization_id: 1, asset_id: 1 }, { unique: true });
FixedAssetSchema.index({ organization_id: 1, admin_id: 1 });

module.exports = mongoose.models.FixedAsset || mongoose.model("FixedAsset", FixedAssetSchema);
