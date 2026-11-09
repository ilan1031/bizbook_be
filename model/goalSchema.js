const mongoose = require("mongoose");

// A savings target (an expansion fund, a tax reserve, a house deposit). Progress
// is what has been put aside by hand plus the current value of any holdings
// linked to it. Nothing here posts to the books.
const GoalSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    scope: { type: String, enum: ["company", "personal"], required: true },
    name: { type: String, required: true, trim: true },
    target_amount: { type: Number, required: true },
    start_date: { type: Date, required: true },
    target_date: { type: Date, required: true },
    note: { type: String, default: "" },
    linked_investments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Investment" }],
    contributions: [{ date: { type: Date, required: true }, amount: { type: Number, required: true }, note: { type: String, default: "" } }],
  },
  { timestamps: true }
);

module.exports = mongoose.models.Goal || mongoose.model("Goal", GoalSchema);
