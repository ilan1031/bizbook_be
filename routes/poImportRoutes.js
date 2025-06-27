const express = require("express");
const router = express.Router();
const ImportController = require("../controllers/poImportController");
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
router.get("/get-column", authMiddleware, ImportController.sendCollecetionKeys);
router.post("/import-bills", authMiddleware, ImportController.uploadBills);
router.post(
  "/purchase-order",
  authMiddleware,
  ImportController.uploadPurchaseOrder
);
module.exports = router;
