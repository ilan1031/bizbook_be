const express = require("express");
const Banking = require("../controllers/bankingController");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// All of these need the Banking page permission (helpers/rbac.js): reading
// needs view, importing create, matching edit and removing delete.
router.get("/banking/accounts", authMiddleware, Banking.listAccounts);
router.get("/banking/transactions", authMiddleware, Banking.listTransactions);
router.post("/banking/transactions/import", authMiddleware, Banking.importTransactions);
router.get("/banking/transactions/:id/suggestions", authMiddleware, Banking.suggestions);
router.patch("/banking/transactions/:id", authMiddleware, Banking.updateTransaction);
router.delete("/banking/transactions/:id", authMiddleware, Banking.deleteTransaction);
router.get("/banking/reconciliation", authMiddleware, Banking.reconciliation);

module.exports = router;
