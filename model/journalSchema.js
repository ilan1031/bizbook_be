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

    // Used by manual journal entries (type "Manual Journal").
    reference_number: { type: String, default: "" },
    notes: { type: String, default: "" },

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

// Every journal write goes through these hooks so line items always reference
// real chart-of-accounts IDs (see resolveJournalLines). Required lazily to
// keep model loading free of helper load-order concerns.
JournalSchema.pre("save", async function () {
  if (!this.isModified("line_items")) return;
  const { resolveJournalLines } = require("../helpers/accountingHelper");
  await resolveJournalLines(this.organization_id, this.admin_id, this.line_items);
});

JournalSchema.pre(["findOneAndUpdate", "updateOne"], async function () {
  const update = this.getUpdate() || {};
  const lines = update.line_items || (update.$set && update.$set.line_items);
  if (!Array.isArray(lines)) return;
  const { resolveJournalLines } = require("../helpers/accountingHelper");
  let { organization_id, admin_id } = { ...this.getQuery(), ...update, ...(update.$set || {}) };
  if (!organization_id || !admin_id) {
    const existing = await this.model
      .findOne(this.getQuery())
      .select("organization_id admin_id")
      .lean();
    organization_id = organization_id || existing?.organization_id;
    admin_id = admin_id || existing?.admin_id;
  }
  await resolveJournalLines(organization_id, admin_id, lines);
});

module.exports = mongoose.model("Journal", JournalSchema);
