// An inventory adjustment: stock counted up or down (quantity lines), or a
// change in stock value (value lines). It posts a journal between Inventory
// Asset and the chosen account, and its stock movements (source "adjustment").
const mongoose = require("mongoose");

const AdjustmentLineSchema = new mongoose.Schema(
  {
    item_ref: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    item_id: { type: String, default: "" },
    item_name: { type: String, default: "" },
    mode: { type: String, enum: ["quantity", "value"], default: "quantity" },
    qty_change: { type: Number, default: 0 },
    value_change: { type: Number, default: 0 },
    // Unit cost for stock coming in (blank: the item's current cost).
    rate: { type: Number, default: null },
    // Value of this line as booked (signed; + increases stock value).
    value: { type: Number, default: 0 },
  },
  { _id: false }
);

const InventoryAdjustmentSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    adjustment_number: { type: String, required: true },
    date: { type: Date, required: true },
    reason: { type: String, required: true },
    reference_number: { type: String, default: "" },
    notes: { type: String, default: "" },
    account_id: { type: String, default: "" },
    account_name: { type: String, default: "" },
    lines: { type: [AdjustmentLineSchema], default: [] },
    total_value: { type: Number, default: 0 },
    journal_id: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Inventory_adjustment || mongoose.model("Inventory_adjustment", InventoryAdjustmentSchema);
