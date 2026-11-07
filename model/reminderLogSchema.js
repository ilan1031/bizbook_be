const mongoose = require("mongoose");

// One payment reminder email sent (or tried) for an invoice.
const ReminderLogSchema = new mongoose.Schema(
  {
    organization_id: { type: Number, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    invoice_ref: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    invoice_number: { type: String, default: "" },
    customer_name: { type: String, default: "" },
    to: { type: String, default: "" },
    days_past_due: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    ok: { type: Boolean, default: false },
    error: { type: String, default: "" },
    sent_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ReminderLog || mongoose.model("ReminderLog", ReminderLogSchema);
