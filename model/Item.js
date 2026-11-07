// models/Item.js
const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema({
  comment_id: { type: String },
  description: { type: String },
  commented_by_id: { type: String },
  commented_by: { type: String },
  comment_type: { type: String },
  date: { type: String },
  date_formatted: { type: String },
  date_with_time: { type: String },
  date_description: { type: String },
  time: { type: String },
  operation_type: { type: String },
  transaction_id: { type: String, default: "" },
  transaction_type: { type: String },
  sentiment: { type: String, default: "none" },
});

const ItemSchema = new mongoose.Schema(
  {
    item_id: { type: String },
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    organization_id: String,
    name: String,
    item_name: String,
    unit: String,
    status: String,
    source: String,
    source_formatted: String,
    is_linked_with_zohocrm: Boolean,
    zcrm_product_id: String,
    description: String,
    rate: Number,
    rate_formatted: String,
    tax_id: String,
    item_tax_preferences: String,
    purchase_account_id: String,
    purchase_account_name: String,
    account_id: String,
    account_name: String,
    purchase_description: String,
    purchase_rate: Number,
    opening_stock: Number,
    opening_stock_rate: Number,
    purchase_rate_formatted: String,
    can_be_sold: Boolean,
    can_be_purchased: Boolean,
    track_inventory: Boolean,
    // Inventory: valuation ("average" by default, "fifo"), reorder level, and
    // the balances the stock ledger keeps up to date (see helpers/stockHelper).
    valuation_method: String,
    // The Inventory Account picked on the item form, stored as chosen.
    inventory_account_id: { type: String, default: "" },
    inventory_account_name: { type: String, default: "" },
    // The journal that books the opening stock (Dr Inventory Asset).
    opening_journal_id: { type: String, default: "" },
    reorder_level: { type: Number, default: 0 },
    // How much to order when stock reaches the reorder level (0: top up to twice the level).
    reorder_quantity: { type: Number, default: 0 },
    // "none", "batch" or "serial": how units are told apart (see the lot register).
    tracking: { type: String, enum: ["none", "batch", "serial"], default: "none" },
    stock_qty: { type: Number, default: 0 },
    stock_value: { type: Number, default: 0 },
    avg_cost: { type: Number, default: 0 },
    item_type: String,
    item_type_formatted: String,
    product_type: String,
    product_type_formatted: String,
    is_taxable: Boolean,
    gst_rate: { type: Number, default: 0 }, // % charged on sales (CGST+SGST or IGST)
    igst_rate: { type: Number, default: 0 }, // inter-state rate shown on the item form
    preferred_vendor_id: String,
    preferred_vendor_name: String,
    tax_exemption_id: String,
    tax_exemption_code: String,
    has_attachment: Boolean,
    sku: String,
    image_name: String,
    created_time: String,
    last_modified_time: String,
    hsn_or_sac: String,
    tags: Array,
    comments: [CommentSchema], // Added comments field if needed
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Item", ItemSchema);