const mongoose = require("mongoose");
const { Schema } = mongoose;

// Define the schema for each column definition
const ColumnDefinitionSchema = new Schema({
  key: {
    type: String,
    required: true,
  },
  value: {
    type: String,
    required: true,
  },
  is_sortable: {
    type: Boolean,
    default: false,
  },
  is_header: {
    type: Boolean,
    default: false,
  },
  is_editable: {
    type: Boolean,
    default: true,
  },
  is_default_select_column: {
    type: Boolean,
    default: false,
  },
  align: {
    type: String,
    default: "",
  },
  default_filter_order: {
    type: Number,
    default: -1,
  },
  is_mandatory: {
    type: Boolean,
    default: false,
  },
  alternate_values: {
    type: [String],
    default: undefined,
  },
  status: {
    type: String,
    default: undefined,
  },
  // Add other optional fields as needed based on your data
});

// Define the main schema for the entire document
const ColumnsSchema = new Schema(
  {
    column_headers: {
      type: new Schema({
        customer: [ColumnDefinitionSchema],
        customer_payment: [ColumnDefinitionSchema],
        bill: [ColumnDefinitionSchema],
        deliverychallan: [ColumnDefinitionSchema],
        estimate: [ColumnDefinitionSchema],
        expense: [ColumnDefinitionSchema],
        invoice: [ColumnDefinitionSchema],
        item: [ColumnDefinitionSchema],
        journal: [ColumnDefinitionSchema],
        purchaseorder: [ColumnDefinitionSchema],
        recurring_bill: [ColumnDefinitionSchema],
        recurring_expense: [ColumnDefinitionSchema],
        recurring_invoice: [ColumnDefinitionSchema],
        salesorder: [ColumnDefinitionSchema],
        vendor: [ColumnDefinitionSchema],
        vendor_credit: [ColumnDefinitionSchema],
        vendor_payment: [ColumnDefinitionSchema],
        creditnote: [ColumnDefinitionSchema],
        einvoice: [ColumnDefinitionSchema],
        project: [ColumnDefinitionSchema],
        payment_links: [ColumnDefinitionSchema],
        salesreturn: [ColumnDefinitionSchema],
        retainer_invoice: [ColumnDefinitionSchema],
        recurring_journal: [ColumnDefinitionSchema],
        sales_receipt: [ColumnDefinitionSchema],
        chart_of_account: [ColumnDefinitionSchema],
      }),
      required: true,
    },
    organization_id: {
      type: String,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Export the model
module.exports = mongoose.model("Columns", ColumnsSchema);
