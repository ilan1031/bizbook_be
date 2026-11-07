const mongoose = require("mongoose");

// A Razorpay payment link for (part of) an unpaid invoice. When the customer
// pays, the webhook records a payment against the invoice.
const PaymentLinkSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    invoice_ref: { type: mongoose.Schema.Types.ObjectId, required: true },
    invoice_id: { type: String, required: true },
    invoice_number: { type: String, default: "" },
    customer_id: { type: String, default: "" },
    customer_name: { type: String, default: "" },
    customer_email: { type: String, default: "" },
    amount: { type: Number, required: true }, // rupees
    razorpay_link_id: { type: String, required: true, unique: true },
    short_url: { type: String, default: "" },
    status: { type: String, enum: ["created", "processing", "paid", "cancelled", "expired"], default: "created" },
    expires_at: { type: Date, default: null },
    paid_at: { type: Date, default: null },
    razorpay_payment_id: { type: String, default: "" },
    payment_id: { type: String, default: "" }, // the payment recorded in the books
    emailed_at: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.PaymentLink || mongoose.model("PaymentLink", PaymentLinkSchema);
