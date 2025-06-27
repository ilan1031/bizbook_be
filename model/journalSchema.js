const mongoose = require("mongoose");

const JournalSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true },
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },

    journal_id: { type: String },

    journal_date: { type: Date, required: true },

    journal_date_formatted: { type: String },

    vendor_name: { type: String, default: "" },
    customer_name: { type: String, default: "" },

    total_amount: { type: Number },

    total_amount_formatted: { type: String },

    type: { type: String },

    line_items: [
      {
        coa_account_id: { type: String },
        coa_account_name: { type: String },
        creditOrDebit: {
          type: String,
          enum: ["Credit", "Debit"],
          required: true,
        },
        amount: { type: Number },
        amount_formatted: { type: String },

        // "customer_id": "string",
        // "line_id": "460000000038005",
        // "description": "string",
        // "tax_exemption_id": "string",
        // "tax_authority_id": "string",
        // "tax_exemption_type": "string",
        // "tax_exemption_code": "string",
        // "tax_authority_name": "string",
        // "tax_id": "string",
        // "amount": 5000,
        // "debit_or_credit": "credit",
        // "acquisition_vat_id": "string",
        // "reverse_charge_vat_id": "string",
        // "location_id": "460000000038080",
        // "tags": [
        //     {
        //         "tag_id": "460000000094001",
        //         "tag_option_id": "460000000048001"
        //     }
        // ],
        // "project_id": "460000000898001"
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Journal", JournalSchema);
