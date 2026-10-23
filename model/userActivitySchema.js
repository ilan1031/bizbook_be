const mongoose = require("mongoose");
const userActivityScema = new mongoose.Schema(
  {
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    organization_id: {
      type: String,
    },
    // The contact the activity is about: a Contact _id or its contact_id
    // (callers pass either).
    user_id: {
      type: String,
    },
    ref_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    ref_collection: {
      type: String,
      enum: ["purchase_order", "po_bill", "invoice", "Invoice", "Expense", "expense", "Recurring_Expense", "payment"],
      required: true,
    },
    message: {
      type: String,
    },
    description: {
      type: String,
    },
    action: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("user_activity", userActivityScema);
