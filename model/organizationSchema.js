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
      unique: true,
    },
    org_name: {
      type: String,
      required: true,
    },
    org_image: {
      type: String,
      default: "",
    },
    contact_name: {
      type: String,
    },
    industry_name: {
      type: String,
    },
    industry_type: {
      type: String,
      default: "",
    },
    email: {
      type: String,
    },
    website: { type: String, default: "" },
    pan_no: { type: String, default: "" },
    // A short line under the name on documents, e.g. "Manufacturer & Distributor".
    tagline: { type: String, default: "" },
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
    // Image data URL shown on printed invoices and quotes.
    logo: {
      type: String,
      default: "",
    },
    phone: {
      type: String, // kept as typed: +91 and leading zeros matter
      required: true,
    },
    zip: {
      type: String, // postal codes are text (some start with 0)
      required: true,
    },
    org_type: {
      type: String,
      default: "",
    },
    state_code: {
      type: String,
    },
    // Most team members (invited or active) this organisation may have;
    // set by the superadmin (helpers/teamService.js).
    team_max_members: {
      type: Number,
      default: 5,
      min: 0,
      max: 500,
    },

    state: {
      type: String,
    },
    fiscal_year_start_month: {
      type: String,
    },
    language_code: {
      type: String,
    },
    theme: {
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
// Sign-in and the sidebar find an admin's organisation by admin_id (and org_type).
organizationSchema.index({ admin_id: 1, org_type: 1 });

module.exports = mongoose.model("Organization", organizationSchema);
