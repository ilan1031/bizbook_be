const express = require("express");
const recurringBillController = require("../controllers/recurringBillController");
const authMiddleware = require("../middleware/userMiddleware");
const { upload } = require("../helpers/multer");
const router = express.Router();

// Create a recurring bill
router.post("/recurring-bill/create", authMiddleware, recurringBillController.createRecurring);
// Get recurring bill by ID
router.get("/recurring-bill/:recurring_id", authMiddleware, recurringBillController.getRecurringById);
// Update recurring bill status by status
router.put("/recurring-bill/update-status/:status", authMiddleware, recurringBillController.updateRecurringStatus);
// Update recurring bill by ID
router.put("/recurring-bill/:recurring_id", authMiddleware, recurringBillController.updateRecurring);
// Delete recurring bill by ID
router.delete("/recurring-bill/:recurring_bill_id", authMiddleware, recurringBillController.deleteRecurring);
// List all recurring bills
router.get("/recurring-bill", authMiddleware, recurringBillController.getRecurringBill);
// Create bill from recurring bill by ID
router.post("/recurring-bill/create-bill/:recurring_bill_id", authMiddleware, recurringBillController.createBillFromRecurring);
module.exports = router;