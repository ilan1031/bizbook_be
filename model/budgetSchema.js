const mongoose = require("mongoose");

// A twelve-month budget: for each income or expense account, an amount per
// month, starting at start_month ("YYYY-MM"). Compared with the books in the
// Budget vs Actual report.
const BudgetSchema = new mongoose.Schema(
  {
    organization_id: { type: String, required: true },
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    budget_id: { type: String, required: true },
    name: { type: String, required: true },
    start_month: { type: String, required: true },
    lines: [
      {
        account_id: { type: String, required: true },
        amounts: { type: [Number], default: [] },
        _id: false,
      },
    ],
    created_by_id: { type: String, default: "" },
  },
  { timestamps: true }
);

BudgetSchema.index({ organization_id: 1, budget_id: 1 }, { unique: true });
BudgetSchema.index({ organization_id: 1, admin_id: 1 });

module.exports = mongoose.models.Budget || mongoose.model("Budget", BudgetSchema);
