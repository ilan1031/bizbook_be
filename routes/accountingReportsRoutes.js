const express = require("express");
const Reports = require("../controllers/accountingReportsController");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// Each report has its own page permission (helpers/rbac.js), checked by authMiddleware.
router.get("/reports/trial-balance", authMiddleware, Reports.getTrialBalance);
router.get("/reports/general-ledger", authMiddleware, Reports.getGeneralLedger);
router.get("/reports/day-book", authMiddleware, Reports.getDayBook);
router.get("/reports/cash-flow", authMiddleware, Reports.getCashFlow);
router.get("/reports/gst-summary", authMiddleware, Reports.getGstSummary);
router.get("/reports/aged-receivables", authMiddleware, Reports.getAgedReceivables);
router.get("/reports/aged-payables", authMiddleware, Reports.getAgedPayables);

module.exports = router;
