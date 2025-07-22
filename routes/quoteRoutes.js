const express = require("express");
const router = express.Router();
const EstimateController = require("../controllers/quotesController");
const authMiddleware = require("../middleware/userMiddleware");
const authClientMiddleware = require("../middleware/authClientMiddleware");
const {uploadQuotation, uploadSales, uploadInvoice} = require("../helpers/multer");


// Create a new estimate
router.post("/estimates", authMiddleware, uploadQuotation.single("documents"), EstimateController.createEstimate);
// Get all estimates
router.get("/estimates", authMiddleware, EstimateController.getEstimates);
// Get an estimate by ID
router.get("/estimates/:quote_id", authMiddleware, EstimateController.getEstimateById);
// Update an estimate by ID
router.put("/estimates/:quote_id", authMiddleware, EstimateController.updateEstimate);
// Delete an estimate by ID
router.delete("/estimates/:quote_id", authMiddleware, EstimateController.deleteEstimate);
// Convert estimate to invoice
router.post("/estimates/convert", authMiddleware, uploadInvoice.single("documents"), EstimateController.convertToInvoice);
// Convert estimate to sales order
router.post("/estimates/convert-to-salesorder", authMiddleware, uploadSales.single("documents"), EstimateController.convertToSalesOrder);
// Update estimate status by ID
router.patch("/estimates/:quote_id/status", authMiddleware, EstimateController.updateEstimateStatus);
// Generate unique estimate ID
router.get("/estimate-id", authMiddleware, EstimateController.getUniqueId);
// Get estimate email details by ID
router.get("/estimate/:quote_id/email", authMiddleware, EstimateController.getEstimateEmailDetails);
// Change estimate status
router.put("/estimate/status", authMiddleware, EstimateController.updateEstimateStatus);
// Get customer estimates
router.get("/clientestimates", authMiddleware, EstimateController.getCustomerEstimates);
// Accept or decline customer estimate by status
router.put("/clientestimates/:status", authMiddleware, EstimateController.acceptOrDeclined);
// Add comment to customer estimate by quote ID
router.put("/clientestimates/comment/:quote_id", authMiddleware, EstimateController.comments);
// Get customer estimate by quote ID
router.get("/clientestimates/:quote_id", authMiddleware, EstimateController.getCustomerEstimate);


module.exports = router;
