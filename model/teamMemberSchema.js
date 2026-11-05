// A person on an organisation's team. One row per user: a user can belong to
// one organisation only in this build. The role is a preset key ("sales") or
// the _id of a custom role of the same organisation (model/teamRoleSchema.js).
const mongoose = require("mongoose");

const teamMemberSchema = new mongoose.Schema(
  {
    organization_id: { type: Number, required: true, index: true },
    // The organisation admin (the org's admin_id) who owns the team.
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, unique: true },
    name: { type: String, default: "" },
    role_id: { type: String, required: true },
    status: { type: String, enum: ["invited", "active", "disabled"], default: "invited" },
    invited_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    invited_at: { type: Date, default: Date.now },
    // sha256 of the nonce inside the current invite link. Cleared when the
    // link is used, so each link works once; a resend replaces it.
    invite_hash: { type: String, default: null },
    invite_expires_at: { type: Date, default: null },
    accepted_at: { type: Date },
    disabled_at: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("team_member", teamMemberSchema);
