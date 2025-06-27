const mongoose = require("mongoose");

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

const LineItemSchema = new mongoose.Schema(
  {
    item_id: String,
    amount: String,
    sku: String,
    itemName: String,
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
  },
  {
    timestamps: true,
  }
);

const billing_address = new mongoose.Schema(
  {
    address_id: String,
    attention: String,
    address: String,
    street1: String,
    street2: String,
    city: String,
    state_code: String,
    state: String,
    zip: String,
    country: String,
    county: String,
    country_code: String,
    phone: String,
    phone_formatted: String,
    fax: String,
    tax_info_id: String,
  },
  {
    timestamps: true,
  }
);

// Fixed the syntax - removed the incorrect array assignment and fixed syntax
const additional_address = new mongoose.Schema(
  {
    address_id: String,
    attention: String,
    address: String,
    street1: String,
    street2: String,
    city: String,
    state: String,
    state_code: String,
    zip: String,
    country: String,
    country_code: String,
    phone: String,
    phone_formatted: String,
    fax: String,
    tax_info_id: String,
  },
  {
    timestamps: true,
  }
);

// Shipping Address
const shipping_address = new mongoose.Schema(
  {
    address_id: String,
    attention: String,
    address: String,
    street1: String,
    street2: String,
    city: String,
    state_code: String,
    state: String,
    zip: String,
    country: String,
    county: String,
    country_code: String,
    phone: String,
    phone_formatted: String,
    fax: String,
    latitude: String,
    longitude: String,
    is_shipping_address_verified: Boolean,
    is_verifiable: Boolean,
    is_valid: Boolean,
  },
  {
    timestamps: true,
  }
);

// Delivery Address
const delivery_address = new mongoose.Schema(
  {
    address_id: String,
    attention: String,
    address: String,
    street1: String,
    street2: String,
    city: String,
    state_code: String,
    state: String,
    zip: String,
    country: String,
    county: String,
    country_code: String,
    phone: String,
    phone_formatted: String,
    fax: String,
    latitude: String,
    longitude: String,
    is_shipping_address_verified: Boolean,
    is_verifiable: Boolean,
    is_valid: Boolean,
  },
  {
    timestamps: true,
  }
);

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

const purchaseOrderSchema = new mongoose.Schema(
  {
    billNumber: Number,
    orderNumber: Number,
    bill_number: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PO_bill",
    },
    purchase_number: { type: String },
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    org_id: {
      type: Number,
      //   required: true,
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact", // Reference to Vendor collection
      //   required: true,
    },
    tax_amount: Number,
    tds_tcs: { type: String },
    organizationPlanName: { type: String },
    organizationUserRole: { type: String },
    customer_id: { type: String },
    address_type: { type: String },
    organization_name: { type: String },
    terms_and_conditions: { type: String },
    purchase_order_number: { type: String },
    reference_number: { type: String },
    Purchase_Order: { type: String },
    Source_supply: { type: String },
    Destination_Supply: { type: String },
    shipment_preference: { type: String },
    tax_category: { type: String },
    source: { type: String },
    notes: { type: String },
    source_of_supply: { type: String },
    destination_of_supply: { type: String },
    gst_no: { type: String },
    reference_number: { type: String },
    status: { type: String, default: 0 }, // 0 - OPEN , 1 - DRAFT, 2 - VOID, 3 - PAID , 4 - CANCEL
    status_type: { type: String },
    status_formatted: { type: String },
    order_status: { type: String },
    order_status_formatted: { type: String },
    received_status: { type: String },
    received_status_formatted: { type: String},
    billed_status: { type: String},
    billed_status_formatted: { type: String },
    date: Date,
    due_date: Date,
    currency_id: { type: String },
    payment_terms: { type: String },
    exchange_rate: Number,
    items: [LineItemSchema],
    billing_address: [billing_address], // Changed from array to single schema
    additional_address: [additional_address], // Used as subdocument
    shipping_address: shipping_address, // Changed from array to single schema
    delivery_address: delivery_address, // Changed from array to single schema
    documents: { type: String, default: "" },
    comments: [CommentSchema],
    taxes: [TaxSchema],
    bills: [
      {
        bill_ref_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "PO_bill",
        },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    commission: Number,
    total: Number,
    subtotal: Number,
    taxAmount: { type: Number },
    adjustment: Number,
    payment_made: Number,
    balance: Number,
    created_by_id: String,
    last_modified_id: String,
    deleted_at: {
      type: Date,
      default: null,
    },
    created_time: { type: Date, default: Date.now },
    last_modified_time: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// Create the Purchase Order model
const PurchaseOrder = mongoose.model("Purchase_Order", purchaseOrderSchema);

module.exports = PurchaseOrder;
