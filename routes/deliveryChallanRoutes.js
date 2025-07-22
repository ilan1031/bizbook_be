const express = require("express");
const router = express.Router();
const DeliveryChallanController = require("../controllers/deliveryChallanController");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadDeliveryChallan, uploadInvoice } = require("../helpers/multer");


// -------------------- Delivery Challan CRUD Operations --------------------

// Create a new delivery challan
router.post("/deliverychallans", authMiddleware, uploadDeliveryChallan.single("documents"), DeliveryChallanController.createDeliveryChallan);

// Get all delivery challans with pagination
// Example: GET /api/v1/deliverychallans?organization_id=100021&limit=10&page=1&sort_column=created_time&sort_order=D&filter=Status.Draft&customer_id=2392275000000042178
router.get("/deliverychallans", authMiddleware, DeliveryChallanController.getDeliveryChallans);

// Get single delivery challan by ID
// Example: /delivery-challans/00001?organization_id=60037967066
router.get("/delivery-challans/:deliverychallan_id", authMiddleware, DeliveryChallanController.getDeliveryChallanById);

// Update a delivery challan
// Example: /deliverychallans?organization_id=60037967066&deliverychallan_id=DC-00001
router.put("/deliverychallans", authMiddleware, DeliveryChallanController.updateDeliveryChallan);

// Convert delivery challan to invoice
// Example: /deliverychallans?organization_id=60037967066&deliverychallan_id=DC-00001
router.post("/deliverychallans/convert-to-invoice", uploadInvoice.single("documents"), authMiddleware, DeliveryChallanController.convertToInvoice);

// Delete a delivery challan (soft delete)
// Example: /deliverychallans?organization_id=60037967066&deliverychallan_id=500001
router.delete("/deliverychallans", authMiddleware, DeliveryChallanController.deleteDeliveryChallan);

// Generate unique delivery challan ID
router.get("/deliveryunique-id", authMiddleware, DeliveryChallanController.getUniqueId);

// Update delivery challan status
// Example: /deliverychallan/status?organization_id=60037967066&deliverychallan_id=DC-00001&status=Draft
router.put("/deliverychallan/status", authMiddleware, DeliveryChallanController.updateChallanStatus);

module.exports = router;
