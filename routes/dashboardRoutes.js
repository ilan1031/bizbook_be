const express = require("express");
const dashboardController = require("../controllers/dashBoardController");
const authMiddleware = require("../middleware/userMiddleware");
// const { upload } = require("../helpers/multer");
const router = express.Router();


// Receivable/payable totals for the dashboard cards
router.get("/summary", authMiddleware, dashboardController.getSummary);
// Get receivables data for dashboard
router.get("/get-receivables", authMiddleware, dashboardController.getReceivables);
// Get payables data for dashboard
router.get("/get-payable", authMiddleware, dashboardController.getPayables);

module.exports = router;
