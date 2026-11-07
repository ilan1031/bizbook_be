const mongoose = require("mongoose");

// A batch (a quantity with one number and an optional expiry) or a serial
// number (always one unit) of a tracked item. Lots are a register kept beside
// the stock ledger: documents move book stock, lots say which batch or serial
// those units were.
const StockLotSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    item_ref: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true, index: true },
    item_name: { type: String, default: "" },
    kind: { type: String, enum: ["batch", "serial"], required: true },
    number: { type: String, required: true, trim: true },
    received_qty: { type: Number, required: true },
    qty: { type: Number, required: true }, // still in stock
    mfg_date: { type: Date, default: null },
    expiry_date: { type: Date, default: null },
    received_on: { type: Date, required: true },
    note: { type: String, default: "" },
    issues: [
      {
        date: Date,
        qty: Number,
        reference: { type: String, default: "" },
      },
    ],
  },
  { timestamps: true }
);

StockLotSchema.index({ organization_id: 1, item_ref: 1, number: 1 }, { unique: true });

module.exports = mongoose.models.StockLot || mongoose.model("StockLot", StockLotSchema);
