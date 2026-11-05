// One line of the stock ledger for a tracked item: stock in (qty > 0) or out
// (qty < 0), or a value-only change (qty 0, value set) from an adjustment.
// A document owns its movements (source_type + source_id): saving the
// document replaces them, so re-applying a document never doubles stock.
const mongoose = require("mongoose");

const StockMovementSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    item_ref: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true, index: true },
    item_id: { type: String, default: "" },
    item_name: { type: String, default: "" },
    date: { type: Date, required: true },
    // Opening stock sorts before anything else on the same day.
    sort_rank: { type: Number, default: 1 },
    qty: { type: Number, default: 0 },
    // Unit cost as entered (null: valued at the item's current cost).
    rate_input: { type: Number, default: null },
    // Unit cost used for this movement, and its value (qty x rate; for
    // value-only lines the change in value entered).
    rate: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    // Balance after this movement.
    running_qty: { type: Number, default: 0 },
    running_value: { type: Number, default: 0 },
    unit_cost: { type: Number, default: 0 },
    source_type: {
      type: String,
      required: true,
      enum: ["opening", "bill", "invoice", "credit_note", "vendor_credit", "adjustment"],
    },
    source_id: { type: String, required: true },
    source_number: { type: String, default: "" },
    party_name: { type: String, default: "" },
  },
  { timestamps: true }
);

StockMovementSchema.index({ organization_id: 1, source_type: 1, source_id: 1 });

module.exports = mongoose.models.Stock_movement || mongoose.model("Stock_movement", StockMovementSchema);
