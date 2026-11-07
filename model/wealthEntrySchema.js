const mongoose = require("mongoose");

// A personal asset or loan that is not an investment (a home, a vehicle, savings,
// a home loan, a card balance). Entered by hand; used in personal net worth.
const WealthEntrySchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    type: { type: String, enum: ["asset", "liability"], required: true },
    category: { type: String, default: "other" },
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    as_on: { type: Date, required: true },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.WealthEntry || mongoose.model("WealthEntry", WealthEntrySchema);
