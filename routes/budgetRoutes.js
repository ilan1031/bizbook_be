const express = require("express");
const Budgets = require("../controllers/budgetController");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// Page permission "budgets" (helpers/rbac.js): view reads and runs the report,
// create adds, edit changes, delete removes.
router.get("/budgets", authMiddleware, Budgets.list);
router.post("/budgets", authMiddleware, Budgets.create);
router.patch("/budgets/:id", authMiddleware, Budgets.update);
router.delete("/budgets/:id", authMiddleware, Budgets.remove);
router.get("/reports/budget-vs-actual", authMiddleware, Budgets.versusActual);

module.exports = router;
