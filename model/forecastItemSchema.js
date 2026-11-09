const mongoose = require("mongoose");

// A one-off amount the owner expects to receive or pay, added to the cash
// forecast on top of what the books already show (a loan instalment, an
// expected grant, an advance tax payment).
const ForecastItemSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    label: { type: String, required: true, trim: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ForecastItem || mongoose.model("ForecastItem", ForecastItemSchema);
