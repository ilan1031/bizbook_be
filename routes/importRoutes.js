const express = require("express");
const router = express.Router();
const ImportController = require("../controllers/importFileController");
const RecordImport = require("../controllers/recordImportController");
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
// Get collection keys (columns) for import
router.get("/get-column", authMiddleware, ImportController.sendCollecetionKeys);
// Import bills from uploaded file
router.post("/import-bills", authMiddleware, ImportController.uploadBills);
// Customers, vendors and items (rows already mapped on the import screen)
router.post("/customers", authMiddleware, RecordImport.importCustomers);
router.post("/vendors", authMiddleware, RecordImport.importVendors);
router.post("/items", authMiddleware, RecordImport.importItems);
// Import purchase order from uploaded file
router.post("/purchase-order", authMiddleware, ImportController.uploadPurchaseOrder);
module.exports = router;
