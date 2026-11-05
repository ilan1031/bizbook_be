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
    // Team accounts (helpers/teamService.js) are created from an invite,
    // which only has an email address.
    mobile: { type: String, required: function () { return !this.team_account; } },
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
    // Create limits set by the superadmin (null = no limit); see
    // helpers/usageLimits.js.
    limits: {
      per_day: { type: Number, default: null },
      per_month: { type: Number, default: null },
      per_year: { type: Number, default: null },
      max_organizations: { type: Number, default: null },
    },
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
      // "admin" when the superadmin issued it from Users & Access (no email sent).
      source: { type: String, enum: ["email", "admin"], default: "email" },
      issued_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
      issued_at: Date,
      // A code the email couldn't deliver (reason "email_failed", auto true),
      // kept encrypted for its 5 minutes so the superadmin can pass it on.
      auto: Boolean,
      reason: String,
      sealed: String,
    },
    // Who issued and used superadmin sign-in codes, and when. Never holds a code.
    sign_in_code_log: [
      {
        _id: false,
        action: { type: String, enum: ["issued", "used", "email_failed"] },
        at: Date,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
        by_email: String,
        detail: String,
      },
    ],
    last_login_at: { type: Date },
    approved_at: { type: Date },
    // Tokens issued before this are refused (middleware/userMiddleware.js).
    password_changed_at: { type: Date },
    // Team members: an account made from an invite, and when it accepted.
    team_account: { type: Boolean, default: false },
    team_accepted_at: { type: Date },
    // Set when the person is removed from a team: their sessions end (401).
    team_session_cutoff: { type: Date },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// Sign-in looks users up by email (indexed by the unique email field) or by mobile.
userSchema.index({ mobile: 1 });

module.exports = mongoose.model("user", userSchema);
