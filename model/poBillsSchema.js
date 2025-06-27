const mongoose = require("mongoose");

const AddressSchema = new mongoose.Schema({
  address: String,
  street2: String,
  city: String,
  state: String,
  zip: String,
  country: String,
  phone: String,
  attention: String,
});

const DocumentSchema = new mongoose.Schema(
  {
    file_name: String,
    file_size: Number,
    file_type: String,
    uploaded_by: String,
  },
  {
    timestamps: true,
  }
);

const LineItemSchema = new mongoose.Schema({
  item_id: String,
  amount: String,
  sku: String,
  item_name: String,
  account_id: String,
  quantity: Number,
  rate: Number,
  discount: Number,
  tax: String,
  tax_id: String,
  tds_tax_id: String,
  item_total: Number,
  unit: String,
  details: String,
});

const CommentSchema = new mongoose.Schema(
  {
    commented_by_id: String,
    description: String,
    date: Date,
    operation_type: String,
  },
  {
    timestamps: true,
  }
);

const TaxSchema = new mongoose.Schema({
  tax_id: String,
  tax_name: String,
  tax_percentage: Number,
  tax_amount: Number,
});

const BillSchema = new mongoose.Schema(
  {
    billNumber: String,
    orderNumber: String,
    bill_number: { type: String, unique: true, required: true, index: true },
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    organization_id: {
      type: Number,
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact", // Reference to Vendor collection
    },
    taxCategory: { type: String },
    recurring_bill_id:{ type: String ,default:null} ,
    source: { type: String },
    notes: { type: String },
    source_of_supply: { type: String },
    destination_of_supply: { type: String },
    gst_no: { type: String },
    reference_number: { type: String },
    status: { type: Number, default: 0 }, // 0 - OPEN , 1 - DRAFT, 2 - VOID, 3 - PAID
    status_type: { type: String },
    billDate: Date,
    due_date: Date,
    currency_id: { type: String },
    paymentTerms: { type: String },
    exchange_rate: Number,
    items: [LineItemSchema],
    billing_address: AddressSchema,
    documents: { type: String, default: "" },
    comments: [CommentSchema],
    taxes: [TaxSchema],
    commission: Number,
    total: Number,
    subtotal: Number,
    taxAmount: Number,
    adjustment: Number,
    payment_made: { type: Number, default: 0 },
    balance: Number,
    due_amt: Number,
    created_by_id: String,
    last_modified_id: String,
    purchase_orders: [
      {
        po_ref_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Purchase_Order",
        },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    created_time: { type: Date, default: Date.now },
    last_modified_time: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

const Bill = mongoose.model("PO_bill", BillSchema);
module.exports = Bill;
