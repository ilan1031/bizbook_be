const express = require("express");
const router = express.Router();
const EstimateController = require("../controllers/quotesController");
const authMiddleware = require("../middleware/userMiddleware");
const authClientMiddleware = require("../middleware/authClientMiddleware");
const {uploadQuotation, uploadSales, uploadInvoice} = require("../helpers/multer");

// CRUD Operations
router.post("/estimates", authMiddleware,uploadQuotation.single("documents"),EstimateController.createEstimate);
router.get("/estimates", authMiddleware,EstimateController.getEstimates);
router.get("/estimates/:quote_id",authMiddleware,EstimateController.getEstimateById);
router.put("/estimates/:quote_id",authMiddleware,EstimateController.updateEstimate);
router.delete("/estimates/:quote_id",authMiddleware,EstimateController.deleteEstimate);

// Estimate-Specific Operations
router.post("/estimates/convert",authMiddleware,uploadInvoice.single("documents"), EstimateController.convertToInvoice);
// 📌 Convert estimate to sales order
router.post("/estimates/convert-to-salesorder", authMiddleware,uploadSales.single("documents"), EstimateController.convertToSalesOrder);
router.patch("/estimates/:quote_id/status",authMiddleware,EstimateController.updateEstimateStatus);

//Id Generate
router.get("/estimate-id", authMiddleware, EstimateController.getUniqueId);
//FILTER
// router.get("/estimates", authMiddleware, EstimateController.getFilteredQuotes);


//email fetch
router.get("/estimate/:quote_id/email",authMiddleware, EstimateController.getEstimateEmailDetails);
//change  quotes status 
router.put("/estimate/status", authMiddleware, EstimateController.updateEstimateStatus);

//Customer routes
router.get("/clientestimates",authMiddleware, EstimateController.getCustomerEstimates);

router.put("/clientestimates/:status",authMiddleware, EstimateController.acceptOrDeclined);

router.put("/clientestimates/comment/:quote_id",authMiddleware, EstimateController.comments)

router.get("/clientestimates/:quote_id",authMiddleware, EstimateController.getCustomerEstimate)


module.exports = router;
