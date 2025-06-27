const mongoose = require("mongoose");

const EmployeeSchema = new mongoose.Schema({
  employee_id: {
    type: String,
    unique: true,
    required: true,
  },
  employee_name: {
    type: String,
    required: true,
  },
  employee_email: {
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

module.exports = mongoose.model("Employee", EmployeeSchema);