const express = require("express");
const COA_Controllers = require("../controllers/COA_controller");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// Get the list view of Chart of Accounts
router.get("/coa-list-view", authMiddleware, COA_Controllers.COA_list);
// Get all Chart of Accounts
router.get("/get-coa-list", authMiddleware, COA_Controllers.getCOAList);
// Get details of a specific Chart of Account
router.get("/coa-details", authMiddleware, COA_Controllers.IndividualView);
// Get paid through account for COA
router.get("/get-coa-paid-through-account",authMiddleware,COA_Controllers.getPaidThroughAccount);
// Edit a Chart of Account
router.post("/edit-coa", authMiddleware, COA_Controllers.edit_COA);
// Get all COA types
router.get("/get-coa-types", authMiddleware, COA_Controllers.getCOA_types);
// Add a new Chart of Account
router.post("/add-coa", authMiddleware, COA_Controllers.add_COA);
// Update status of a Chart of Account
router.post("/update-coa-status", authMiddleware, COA_Controllers.updateStatus);
// Get individual COA transaction details
router.get("/get-coa-transaction",authMiddleware,COA_Controllers.getIndividual_COA_transaction);

module.exports = router;
