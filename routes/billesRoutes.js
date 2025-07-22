const express = require("express");
const billsController = require("../controllers/billsController");
const authMiddleware = require("../middleware/userMiddleware");
const { upload } = require("../helpers/multer");
const router = express.Router();


// Get all vendors for bills
router.get("/bills/get-vendors", authMiddleware, billsController.getVendors);
// Create a new bill (with optional document upload)
router.post("/bills/create-bills", authMiddleware, upload.single("documents"), billsController.createBills);
// Get all bills
router.get("/bills/get-bills", authMiddleware, billsController.getAllBills);
// Get a specific bill by ID
router.get("/bills/get-individual-bill", authMiddleware, billsController.getIndividualBill);
// Update a specific bill (with optional document upload)
router.put("/bills/update-individual-bill", authMiddleware, upload.single("documents"), billsController.updateIndividualBill);
// Delete a specific bill
router.delete("/bills/delete-individual-bill", authMiddleware, billsController.deleteIndividualBill);
// Update billing address for a bill
router.post("/bills/update-billing-address", authMiddleware, billsController.updateBillingAddress);
// Mark a bill as void
router.post("/bills/update-status-void", authMiddleware, billsController.updateBillStatusToVoid);
// Mark a bill as draft
router.post("/bills/update-status-draft", authMiddleware, billsController.updateBillStatusToDraft);
// Change bill status from draft to another status
router.post("/bills/update-status-from-draft", authMiddleware, billsController.updateBillStatusFromDraft);
// Get summary of bills by vendor
router.get("/bills/vendor-summary", authMiddleware, billsController.getVendorBillSummary);
// Apply payment to a bill
router.put("/bills/apply-payment", authMiddleware, billsController.applyBillPayment);
// Get bill history
router.get("/bills/get-history", authMiddleware, billsController.getHistory);
// router.post('/add-assets-records',usersController.addAssetsRecords)

module.exports = router;
