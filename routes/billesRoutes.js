const express = require("express");
const billsController = require("../controllers/billsController");
const authMiddleware = require("../middleware/userMiddleware");
const { upload } = require("../helpers/multer");
const router = express.Router();

router.get("/bills/get-vendors", authMiddleware, billsController.getVendors);
router.post(
  "/bills/create-bills",
  authMiddleware,
  upload.single("documents"),
  billsController.createBills
);
// router.post("/bills/create-bills", authMiddleware,upload.single('documents'),billsController.createBills);
router.get("/bills/get-bills", authMiddleware, billsController.getAllBills);
router.get(
  "/bills/get-individual-bill",
  authMiddleware,
  billsController.getIndividualBill
);
router.put(
  "/bills/update-individual-bill",
  authMiddleware,
  upload.single("documents"),
  billsController.updateIndividualBill
);
router.delete(
  "/bills/delete-individual-bill",
  authMiddleware,
  billsController.deleteIndividualBill
);
router.post(
  "/bills/update-billing-address",
  authMiddleware,
  billsController.updateBillingAddress
);
router.post(
  "/bills/update-status-void",
  authMiddleware,
  billsController.updateBillStatusToVoid
);
router.post(
  "/bills/update-status-draft",
  authMiddleware,
  billsController.updateBillStatusToDraft
);
router.post(
  "/bills/update-status-from-draft",
  authMiddleware,
  billsController.updateBillStatusFromDraft
);

router.get('/bills/vendor-summary',authMiddleware,billsController.getVendorBillSummary);

router.put("/bills/apply-payment", authMiddleware,billsController.applyBillPayment);

router.get('/bills/get-history',authMiddleware,billsController.getHistory)
// router.post('/add-assets-records',usersController.addAssetsRecords)

module.exports = router;
