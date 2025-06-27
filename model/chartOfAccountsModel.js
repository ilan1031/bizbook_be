const mongoose = require("mongoose");

const AccountSchema = new mongoose.Schema(
  {
    account_id: {
      type: String,
    },
    account_name: String,
    account_code: {
      type: String,
      default: "",
    },
    account_type: String,
    account_type_formatted: String,
    description: {
      type: String,
      default: "",
    },
    is_user_created: {
      type: Boolean,
      default: false,
    },
    is_system_account: {
      type: Boolean,
      default: false,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    can_show_in_ze: {
      type: Boolean,
      default: false,
    },
    parent_account_id: {
      type: String,
      default: "",
    },
    parent_account_name: {
      type: String,
      default: "",
    },
    depth: {
      type: Number,
      default: 0,
    },
    has_attachment: {
      type: Boolean,
      default: false,
    },
    is_child_present: {
      type: Boolean,
      default: false,
    },
    child_count: {
      type: Number,
      default: 0,
    },
    is_standalone_account: {
      type: Boolean,
      default: false,
    },
    is_ze_paid_through_account: {
      type: Boolean,
      default: false,
    },
  }
); // Disable _id for subdocuments if not needed

const ChartOfAccountSchema = new mongoose.Schema(
  {
    organization_id: {
      type: String,
    },
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    chart_of_accounts: {
      type: [AccountSchema], // This is an array of account objects
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("Chart_of_account", ChartOfAccountSchema);
