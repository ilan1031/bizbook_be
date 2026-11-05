// routes/profitLossRoutes.js
const express = require("express");
const router = express.Router();
const ProfitLossController = require("../controllers/ProfitAndLoss_controller");
const authMiddleware = require("../middleware/userMiddleware");

// Get profit and loss report (bill & invoice)
router.get("/reports/profit-loss/bill-invoice", authMiddleware, ProfitLossController.getProfitLossReport);
// The same figures per calendar month, in one call (the home page income card)
router.get("/reports/profit-loss/bill-invoice/monthly", authMiddleware, ProfitLossController.getProfitLossMonthly);

module.exports = router;
