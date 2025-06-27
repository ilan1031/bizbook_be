const mongoose = require("mongoose");

const taxExemptionSchema = new mongoose.Schema(
  {
    organization_id :{
        type: String,
    },
    tax_exemption_id: {
      type: Number,
      required: true,
    },
    tax_exemption_code: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    type: {
      type: String,
    },
    deleted_at : {
        type: Date, default :null
    }
  },
  {
    timestamps: true,
  }
);
module.exports = mongoose.model("TaxExemption", taxExemptionSchema);
