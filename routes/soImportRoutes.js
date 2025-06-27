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
router.get("/get-column", authMiddleware, SoImportController.sendCollecetionKeys);
router.post("/quote", authMiddleware, SoImportController.importQuote);
// router.post(
//   "/purchase-order",
//   authMiddleware,
//   ImportController.uploadPurchaseOrder
// );
module.exports = router;
