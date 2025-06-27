const express = require("express");
const vendorController = require("../controllers/vendorController");
const authMiddleware = require("../middleware/userMiddleware");
// const { upload } = require("../helpers/multer");
const router = express.Router();

router.get(
  "/vendor/get-all-bills",
  authMiddleware,
  vendorController.getVendorBills
);
router.get(
  "/vendor/get-all-purchase-orders",
  authMiddleware,
  vendorController.getVendorPurchaseOrder
);

module.exports = router;
