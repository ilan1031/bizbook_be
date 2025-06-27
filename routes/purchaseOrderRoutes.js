const express = require("express");
const purchaseOrderController = require("../controllers/purchaseOrderController");
const authMiddleware = require("../middleware/userMiddleware");
const { upload } = require("../helpers/multer");
const router = express.Router();

router.get(
  "/purchase-orders/get-vendors",
  authMiddleware,
  purchaseOrderController.getVendors
);
router.post(
  "/purchaseorders/createpurchaseorder",
  authMiddleware,
  upload.single("documents"),
  purchaseOrderController.createPurchaseOrder
);
// router.get("/purchase-orders/get-purchase-orders", authMiddleware, purchaseOrderController.getAllPurchaseOrders);
router.get(
  "/purchaseorder/purchaseorders",
  authMiddleware,
  purchaseOrderController.getAllPurchaseOrders
);

router.get(
  "/purchase-orders/get-individual-purchase-order",
  authMiddleware,
  purchaseOrderController.getIndividualPurchaseOrder
);
router.put(
  "/purchase-orders/update-individual-purchase-order",
  authMiddleware,
  upload.single("documents"),
  purchaseOrderController.updateIndividualPurchaseOrder
);
router.delete(
  "/purchase-orders/delete-individual-purchase-order",
  authMiddleware,
  purchaseOrderController.deleteIndividualPurchaseOrder
);
router.post(
  "/purchase-orders/update-billing-address",
  authMiddleware,
  purchaseOrderController.updateBillingAddress
);
router.post(
  "/purchase-orders/update-shipping-address",
  authMiddleware,
  purchaseOrderController.updateShippingAddress
);
router.post(
  "/purchase-orders/update-delivery-address",
  authMiddleware,
  purchaseOrderController.updateDeliveryAddress
);
router.post(
  "/purchase-orders/update-status-void",
  authMiddleware,
  purchaseOrderController.updatePurchaseOrderStatusToVoid
);
router.post(
  "/purchase-orders/update-status-draft",
  authMiddleware,
  purchaseOrderController.updatePurchaseOrderStatusToDraft
);
router.post(
  "/purchase-orders/update-status-from-draft",
  authMiddleware,
  purchaseOrderController.updatePurchaseOrderStatusFromDraft
);
router.post(
  "/purchase-orders/add-comment",
  authMiddleware,
  purchaseOrderController.addCommentToPurchaseOrder
);
router.post(
  "/purchase-orders/add-document",
  authMiddleware,
  purchaseOrderController.addDocumentToPurchaseOrder
);
router.post(
  "/purchase-orders/update-purchase-to-bill",
  authMiddleware,
  upload.single("documents"),
  purchaseOrderController.updatePurchaseOrderToBill
);
router.get(
  "/purchase-orders/email/:po_id",
  authMiddleware,
  purchaseOrderController.getPurchaseOrderEmailDetails
);
// 📌 Get unique purchase order ID
router.get(
  "/purchase-orders/unique-id",
  authMiddleware,
  purchaseOrderController.getUniqueId
);

router.put(
  "/purchase-orders/update-status",
  authMiddleware,
  purchaseOrderController.updatePurchaseOrderStatus
);

router.post(
  "/purchase-orders/remove-document",
  authMiddleware,
  purchaseOrderController.removeDocumentFromPurchaseOrder
);

module.exports = router;
