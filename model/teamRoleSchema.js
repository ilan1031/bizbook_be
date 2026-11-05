// A custom role an organisation's admin built from the permission grid.
// Built-in presets live in helpers/teamRoles.js, not here.
const mongoose = require("mongoose");

const teamRoleSchema = new mongoose.Schema(
  {
    organization_id: { type: Number, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Lower-cased name, unique per organisation (no two roles called "Sales ").
    name_key: { type: String, required: true },
    description: { type: String, default: "", maxlength: 200 },
    permissions: { type: Object, default: {} },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
  },
  { timestamps: true }
);
teamRoleSchema.index({ organization_id: 1, name_key: 1 }, { unique: true });

module.exports = mongoose.model("team_role", teamRoleSchema);
