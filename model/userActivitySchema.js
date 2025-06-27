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
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact", // Reference to Vendor collection
    },
    ref_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    ref_collection: {
      type: String,
      enum: ["purchase_order", "po_bill", "invoice","Expense"],
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
