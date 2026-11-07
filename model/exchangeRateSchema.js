const mongoose = require("mongoose");

// What one unit of a foreign currency was worth, in the organisation's base
// currency, on a date.
const ExchangeRateSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    currency_code: { type: String, required: true, uppercase: true, trim: true },
    date: { type: Date, required: true },
    rate: { type: Number, required: true },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

ExchangeRateSchema.index({ organization_id: 1, currency_code: 1, date: 1 }, { unique: true });

module.exports = mongoose.models.ExchangeRate || mongoose.model("ExchangeRate", ExchangeRateSchema);
