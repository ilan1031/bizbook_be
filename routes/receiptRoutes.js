const express = require("express");
const authMiddleware = require("../middleware/userMiddleware");
const receipts = require("../controllers/receiptController");
const router = express.Router();

// Page permission "receipts" (helpers/rbac.js): view lists and opens receipts,
// create uploads one, edit corrects the details and makes the expense, delete
// removes one that is not yet an expense.
router.get("/receipts/lookups", authMiddleware, receipts.lookups.bind(receipts));
router.get("/receipts", authMiddleware, receipts.list.bind(receipts));
router.post("/receipts", authMiddleware, receipts.parse, receipts.create.bind(receipts));
router.get("/receipts/:id/file", authMiddleware, receipts.file.bind(receipts));
router.patch("/receipts/:id", authMiddleware, receipts.update.bind(receipts));
router.post("/receipts/:id/expense", authMiddleware, receipts.toExpense.bind(receipts));
router.delete("/receipts/:id", authMiddleware, receipts.remove.bind(receipts));

module.exports = router;
