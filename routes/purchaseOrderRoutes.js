const express = require("express");
const purchaseOrderController = require("../controllers/purchaseOrderController");
const authMiddleware = require("../middleware/userMiddleware");
const { upload } = require("../helpers/multer");
const router = express.Router();


// Get vendors for purchase orders
router.get("/purchase-orders/get-vendors", authMiddleware, purchaseOrderController.getVendors);
// Create a new purchase order
router.post("/purchaseorders/createpurchaseorder", authMiddleware, upload.single("documents"), purchaseOrderController.createPurchaseOrder);
// Get all purchase orders
router.get("/purchaseorder/purchaseorders", authMiddleware, purchaseOrderController.getAllPurchaseOrders);
// Get an individual purchase order
router.get("/purchase-orders/get-individual-purchase-order", authMiddleware, purchaseOrderController.getIndividualPurchaseOrder);
// Update an individual purchase order
router.put("/purchase-orders/update-individual-purchase-order", authMiddleware, upload.single("documents"), purchaseOrderController.updateIndividualPurchaseOrder);
// Delete an individual purchase order
router.delete("/purchase-orders/delete-individual-purchase-order", authMiddleware, purchaseOrderController.deleteIndividualPurchaseOrder);
// Update billing address for a purchase order
router.post("/purchase-orders/update-billing-address", authMiddleware, purchaseOrderController.updateBillingAddress);
// Update shipping address for a purchase order
router.post("/purchase-orders/update-shipping-address", authMiddleware, purchaseOrderController.updateShippingAddress);
// Update delivery address for a purchase order
router.post("/purchase-orders/update-delivery-address", authMiddleware, purchaseOrderController.updateDeliveryAddress);
// Mark a purchase order as void
router.post("/purchase-orders/update-status-void", authMiddleware, purchaseOrderController.updatePurchaseOrderStatusToVoid);
// Mark a purchase order as draft
router.post("/purchase-orders/update-status-draft", authMiddleware, purchaseOrderController.updatePurchaseOrderStatusToDraft);
// Change purchase order status from draft
router.post("/purchase-orders/update-status-from-draft", authMiddleware, purchaseOrderController.updatePurchaseOrderStatusFromDraft);
// Add a comment to a purchase order
router.post("/purchase-orders/add-comment", authMiddleware, purchaseOrderController.addCommentToPurchaseOrder);
// Add a document to a purchase order
router.post("/purchase-orders/add-document", authMiddleware, purchaseOrderController.addDocumentToPurchaseOrder);
// Convert purchase order to bill
router.post("/purchase-orders/update-purchase-to-bill", authMiddleware, upload.single("documents"), purchaseOrderController.updatePurchaseOrderToBill);
// Get purchase order email details
router.get("/purchase-orders/email/:po_id", authMiddleware, purchaseOrderController.getPurchaseOrderEmailDetails);
// Get unique purchase order ID
router.get("/purchase-orders/unique-id", authMiddleware, purchaseOrderController.getUniqueId);
// Update purchase order status
router.put("/purchase-orders/update-status", authMiddleware, purchaseOrderController.updatePurchaseOrderStatus);
// Remove document from purchase order
router.post("/purchase-orders/remove-document", authMiddleware, purchaseOrderController.removeDocumentFromPurchaseOrder);

module.exports = router;
