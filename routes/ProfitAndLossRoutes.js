// routes/profitLossRoutes.js
const express = require("express");
const router = express.Router();
const ProfitLossController = require("../controllers/ProfitAndLoss_controller");
const authMiddleware = require("../middleware/userMiddleware");

router.get("/reports/profit-loss", authMiddleware, ProfitLossController.getProfitLossReport);

module.exports = router;
