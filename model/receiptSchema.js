const mongoose = require("mongoose");

// A photographed or scanned receipt waiting to become an expense.
const ReceiptSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    file_name: { type: String, default: "" },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    status: { type: String, enum: ["new", "converted"], default: "new" },
    vendor: { type: String, default: "" },
    date: { type: String, default: "" }, // YYYY-MM-DD
    amount: { type: Number, default: 0 },
    note: { type: String, default: "" },
    read_by_ai: { type: Boolean, default: false },
    expense_id: { type: String, default: "" },
    expense_number: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Receipt || mongoose.model("Receipt", ReceiptSchema);
