const mongoose = require("mongoose");

// A company's own TDS / TCS rates, offered next to the built-in ones on
// invoices and bills.
const WithholdingTaxSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    type: { type: String, enum: ["TDS", "TCS"], required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    rate: { type: Number, required: true, min: 0, max: 100 },
    section: { type: String, default: "", trim: true, maxlength: 60 }, // TDS
    nature: { type: String, default: "", trim: true, maxlength: 60 }, // TCS
    status: { type: String, default: "Active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Withholding_tax", WithholdingTaxSchema);
