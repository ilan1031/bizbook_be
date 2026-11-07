const mongoose = require("mongoose");

// Extra costs of getting goods in (freight, duty, handling) added to the value
// of the stock a purchase bill brought in. Each one books an inventory
// adjustment (Dr Inventory Asset, Cr the account the cost was paid from).
const LandedCostSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    landed_cost_number: { type: String, required: true },
    bill_number: { type: String, required: true },
    vendor_name: { type: String, default: "" },
    date: { type: Date, required: true },
    allocation: { type: String, enum: ["value", "qty"], default: "value" },
    charges: [{ description: { type: String, default: "" }, amount: { type: Number, required: true }, _id: false }],
    total: { type: Number, required: true },
    account_id: { type: String, required: true },
    account_name: { type: String, default: "" },
    // How the total was shared out over the bill's stock items.
    lines: [{ item_id: String, item_name: String, qty: Number, base: Number, amount: Number, _id: false }],
    adjustment_id: { type: String, required: true },
    adjustment_number: { type: String, default: "" },
    created_by_id: { type: String, default: "" },
  },
  { timestamps: true }
);

LandedCostSchema.index({ organization_id: 1, landed_cost_number: 1 }, { unique: true });

module.exports = mongoose.models.LandedCost || mongoose.model("LandedCost", LandedCostSchema);
