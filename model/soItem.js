// models/Item.js
const mongoose = require("mongoose");

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
    item_type: String,
    item_type_formatted: String,
    product_type: String,
    product_type_formatted: String,
    is_taxable: Boolean,
    tax_exemption_id: String,
    tax_exemption_code: String,
    has_attachment: Boolean,
    sku: String,
    image_name: String,
    created_time: String,
    last_modified_time: String,
    hsn_or_sac: String,
    tags: Array,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Item", ItemSchema);
