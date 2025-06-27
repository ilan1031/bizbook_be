const express = require("express");
const router = express.Router();
const DeliveryChallanController = require("../controllers/deliveryChallanController");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadDeliveryChallan, uploadInvoice } = require("../helpers/multer");

// CRUD Operations

// 📝 Create a new delivery challan
router.post( "/deliverychallans", authMiddleware,uploadDeliveryChallan.single("documents"), DeliveryChallanController.createDeliveryChallan);

// 📝 Get all delivery challans with pagination
router.get("/deliverychallans",authMiddleware,DeliveryChallanController.getDeliveryChallans);
// Example: GET /api/v1/deliverychallans?organization_id=100021&limit=10&page=1&sort_column=created_time&sort_order=D&filter=Status.Draft&customer_id=2392275000000042178

// 📝 Get single delivery challan by ID
router.get("/delivery-challans/:deliverychallan_id",authMiddleware,DeliveryChallanController.getDeliveryChallanById);
// Example: /delivery-challans/00001?organization_id=60037967066

// 📌 Update a delivery challan
router.put("/deliverychallans", authMiddleware,DeliveryChallanController.updateDeliveryChallan);
// Example: /deliverychallans?organization_id=60037967066&deliverychallan_id=DC-00001

router.post("/deliverychallans/convert-to-invoice",uploadInvoice.single("documents"), authMiddleware,DeliveryChallanController.convertToInvoice
);
// Example: /deliverychallans?organization_id=60037967066&deliverychallan_id=DC-00001

// 📝 Delete an deliverychallans (soft delete)
router.delete("/deliverychallans", authMiddleware,DeliveryChallanController.deleteDeliveryChallan);
// Example: /deliverychallans?organization_id=60037967066&deliverychallan_id=500001

//Id Generate
router.get("/deliveryunique-id",authMiddleware,DeliveryChallanController.getUniqueId);

//status
router.put("/deliverychallan/status",authMiddleware, DeliveryChallanController.updateChallanStatus);

// Example: /deliverychallan/status?organization_id=60037967066&deliverychallan_id=DC-00001&status=Draft
module.exports = router;
