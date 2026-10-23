const mongoose = require("mongoose");

// One row per record a business user creates through the API, used to
// enforce the per-day / month / year create limits the superadmin sets.
// Rows expire after about 13 months (the yearly window plus a margin).
const createEventSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
  page: { type: String, default: "" },
  at: { type: Date, default: Date.now },
});
createEventSchema.index({ user_id: 1, at: -1 });
createEventSchema.index({ at: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

module.exports = mongoose.models.create_event || mongoose.model("create_event", createEventSchema);
