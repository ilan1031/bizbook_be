const mongoose = require("mongoose");

const SalespersonSchema = new mongoose.Schema({
  salesperson_id: {
    type: String,
    unique: true,
    required: true,
  },
  salesperson_name: {
    type: String,
    required: true,
  },
  salesperson_email: {
    type: String,
    required: true,
    unique: true,
  },
  organization_id: {
    type: String,
    required: true,
  },
   admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
  status: {
    type: Number,
    default: 1,
  }
}, { timestamps: true });

module.exports = mongoose.model("Salesperson", SalespersonSchema);
