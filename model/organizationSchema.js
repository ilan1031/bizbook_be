const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema(
  {
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    organization_id: {
      type: Number,
      required: true,
    },
    org_name: {
      type: String,
      required: true,
    },
    contact_name: {
      type: String,
    },
    industry_name: {
      type: String,
    },
    email: {
      type: String,
    },
    first_street: {
      type: String,
    },
    second_street: {
      type: String,
    },
    city: {
      type: String,
    },
    country: {
      type: String,
    },
    country_code: {
      type: String,
    },
    org_settings: {
      type: Boolean,
      default: false,
    },
    gst_in: {
      type: String,
      default: false,
    },
    phone: {
      type: Number,
      required: true,
    },
    zip: {
      type: Number,
      required: true,
    },
    org_type: {
      type: String,
      default: "",
    },
    state_code: {
      type: String,
    },

    state: {
      type: String,
    },
    tax_basis: {
      type: String,
    },
    version: {
      type: String,
    },
    version_formatted: {
      type: String,
    },
    time_zone: {
      type: String,
      default: "Asia/Calcutta",
    },
    time_zone_formatted: {
      type: String,
      default: "(GMT 5:30) India Standard Time (Asia/Calcutta)",
    },
    date_format: {
      type: String,
      default: "dd/MM/yyyy",
    },
    currency_code: {
      type: String,
      default: "INR",
    },
    currency_symbol: {
      type: String,
      default: "₹",
    },
    plan_type: {
      type: Number,
      default: 0,
    },
    plan_name: {
      type: String,
      default: "TRIAL",
    },
    plan_period: {
      type: String,
      default: "",
    },
    account_created_date: {
      type: Date,
      default: Date.now(),
    },
    portal_name: {
      type: String,
      default: "",
    },
    user_status: {
      type: Number,
      default: 1,
    },
    user_status_formatted: {
      type: Boolean,
      default: true,
    },
    user_role: {
      type: String,
      default: "Admin",
    },
  },
  {
    timestamps: true,
  }
);
module.exports = mongoose.model("Organization", organizationSchema);
