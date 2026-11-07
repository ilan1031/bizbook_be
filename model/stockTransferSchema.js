const mongoose = require("mongoose");

// Moves stock between two warehouses. Quantity only: the business owns the
// same goods at the same cost either way, so no journal is posted.
const StockTransferSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    transfer_number: { type: String, required: true },
    date: { type: Date, required: true },
    from_warehouse_id: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    to_warehouse_id: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    note: { type: String, default: "" },
    lines: [
      {
        item_ref: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
        item_id: { type: String, default: "" },
        item_name: { type: String, default: "" },
        qty: { type: Number, required: true },
      },
    ],
  },
  { timestamps: true }
);

StockTransferSchema.index({ organization_id: 1, date: -1 });

module.exports = mongoose.models.StockTransfer || mongoose.model("StockTransfer", StockTransferSchema);
