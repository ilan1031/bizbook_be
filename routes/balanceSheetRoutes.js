const express = require("express");
const BalanceSheetController = require("../controllers/balanceSheetController");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// Get the balance sheet as of a date (?org_id=&as_of=YYYY-MM-DD)
router.get("/reports/balance-sheet", authMiddleware, BalanceSheetController.getBalanceSheet);

module.exports = router;
