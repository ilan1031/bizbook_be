const mongoose = require("mongoose");

// "Books locked up to this date" for an organisation. Entries dated on or
// before it can't be added, changed or removed, so reports for a closed period
// (a filed GST return, a signed-off year) never move. Every change is kept.
const PeriodLockSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    locked_until: { type: Date, default: null },
    history: [
      {
        locked_until: { type: Date, default: null },
        set_by: { type: String, default: "" },
        set_at: { type: Date, default: Date.now },
        note: { type: String, default: "" },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

PeriodLockSchema.index({ organization_id: 1, admin_id: 1 }, { unique: true });

module.exports = mongoose.models.PeriodLock || mongoose.model("PeriodLock", PeriodLockSchema);
