// Per-organisation inventory settings. sell_policy: "warn" (save the sale
// and show a warning when it sells more than is on hand) or "block" (refuse).
const mongoose = require("mongoose");

const InventorySettingsSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, unique: true },
    sell_policy: { type: String, enum: ["warn", "block"], default: "warn" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Inventory_settings || mongoose.model("Inventory_settings", InventorySettingsSchema);
