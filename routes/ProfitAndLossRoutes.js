// routes/profitLossRoutes.js
const express = require("express");
const router = express.Router();
const ProfitLossController = require("../controllers/ProfitAndLoss_controller");
const authMiddleware = require("../middleware/userMiddleware");

// Get profit and loss report (bill & invoice)
router.get("/reports/profit-loss/bill-invoice", authMiddleware, ProfitLossController.getProfitLossReport);

module.exports = router;
