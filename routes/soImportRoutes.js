const express = require("express");
const router = express.Router();
const SoImportController = require("../controllers/soImportController");
const authMiddleware = require("../middleware/userMiddleware");
// const { upload, uploadBills } = require("../helpers/multer");

/**
 * Routes for import functionality
 */

// Route for uploading a file and generating preview
// router.post(
//   "/preview",
//   authMiddleware,
//   uploadBills.single("file"),
//   ImportController.uploadFiles
// );
// Get collection keys (columns) for SO import
router.get("/get-column", authMiddleware, SoImportController.sendCollecetionKeys);
// Import quote for sales order
router.post("/quote", authMiddleware, SoImportController.importQuote);
// router.post(
//   "/purchase-order",
//   authMiddleware,
//   ImportController.uploadPurchaseOrder
// );
module.exports = router;
