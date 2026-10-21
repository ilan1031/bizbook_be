const mongoose = require("mongoose");

// Credit notes (sales: money owed back to a customer) and vendor credits
// (purchases: money a vendor owes back) share one shape. A credit is
// raised, then used up by applying it to invoices/bills or refunding it;
// `balance` is what's left.
const LineSchema = new mongoose.Schema(
  {
    item_id: { type: String, default: "" },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    quantity: { type: Number, default: 1 },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    account_id: { type: String, required: true },
    account_name: { type: String, default: "" },
  },
  { _id: false }
);

const ApplicationSchema = new mongoose.Schema(
  {
    document_id: { type: String, required: true }, // invoice_id / bill_number
    document_number: { type: String, default: "" },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const RefundSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    account_id: { type: String, required: true },
    account_name: { type: String, default: "" },
    mode: { type: String, default: "" },
    reference_number: { type: String, default: "" },
    journal_id: { type: String, default: "" },
  },
  { _id: true, timestamps: true }
);

const CreditSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true, index: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    credit_number: { type: String, required: true, index: true },
    contact_id: { type: String, required: true }, // customer contact_id / vendor _id
    contact_name: { type: String, default: "" },
    date: { type: Date, required: true },
    reference_number: { type: String, default: "" },
    notes: { type: String, default: "" },
    line_items: { type: [LineSchema], default: [] },
    total: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    // draft -> open -> closed (fully used); void cancels an unused credit.
    status: { type: String, enum: ["draft", "open", "closed", "void"], default: "open" },
    applications: { type: [ApplicationSchema], default: [] },
    refunds: { type: [RefundSchema], default: [] },
    journal_id: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = {
  CreditNote: mongoose.models.Credit_note || mongoose.model("Credit_note", CreditSchema),
  VendorCredit: mongoose.models.Vendor_credit || mongoose.model("Vendor_credit", CreditSchema.clone()),
};
