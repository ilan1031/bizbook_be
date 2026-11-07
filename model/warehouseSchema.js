const mongoose = require("mongoose");

// A place stock is kept. One warehouse per organisation is the default: it
// holds everything that has not been moved elsewhere by a stock transfer.
const WarehouseSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    is_default: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

WarehouseSchema.index({ organization_id: 1, name: 1 });

module.exports = mongoose.models.Warehouse || mongoose.model("Warehouse", WarehouseSchema);
