// Who changed a team: invites, removals, role and status changes, the team
// switch and the member limit. (userActivitySchema doesn't fit: its records
// are tied to a document, and this log is about people and roles.)
const mongoose = require("mongoose");

const teamAuditSchema = new mongoose.Schema(
  {
    organization_id: { type: Number, required: true, index: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    actor_email: { type: String, default: "" },
    // "owner" = the organisation admin, "superadmin" = the platform superadmin, "member" = a person accepting an invite.
    actor_type: { type: String, enum: ["owner", "superadmin", "member"], required: true },
    action: { type: String, required: true },
    target_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    target_email: { type: String, default: "" },
    target_name: { type: String, default: "" },
    details: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);
teamAuditSchema.index({ organization_id: 1, created_at: -1 });

module.exports = mongoose.model("team_audit", teamAuditSchema);
