const mongoose = require("mongoose");
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      match: [
        /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\. [0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
        "Please add a valid email address.",
      ],
      required: [true, "Please enter Email Address"],
      unique: true,
      lowercase: true,
      dropDups: true,
    },
    password: {
      type: String,
      required: true,
    },
    mobile: { type: String, required: true },
    company_name: {
      type: String,
    },
    country: {
      type: String,
    },
    state: {
      type: String,
    },
    agreement_status: {
      type: Boolean,
      default: false,
    },

    // --- Access control (see helpers/rbac.js) ---
    // "superadmin" manages every other account; "user" is a normal account.
    role: { type: String, enum: ["superadmin", "user"], default: "user" },
    // New sign-ups start "pending" and can't log in until a superadmin
    // activates them. Missing status (older accounts) is treated as pending.
    status: {
      type: String,
      enum: ["pending", "active", "inactive"],
      default: "pending",
    },
    // { [pageKey]: ["view", "create", "edit", "delete"] }
    permissions: { type: Object, default: {} },
    // Max number of distinct IP addresses this user may log in from.
    ip_limit: { type: Number, default: 2, min: 0, max: 50 },
    allowed_ips: [
      {
        ip: { type: String, required: true },
        added_at: { type: Date, default: Date.now },
        last_login_at: { type: Date },
        user_agent: { type: String, default: "" },
      },
    ],
    // One-time code for approving a new login IP (hashed, never stored plain).
    login_otp: {
      code_hash: String,
      ip: String,
      expires_at: Date,
      attempts: { type: Number, default: 0 },
    },
    last_login_at: { type: Date },
    approved_at: { type: Date },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

module.exports = mongoose.model("user", userSchema);
