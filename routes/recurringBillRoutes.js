const express = require("express");
const recurringBillController = require("../controllers/recurringBillController");
const authMiddleware = require("../middleware/userMiddleware");
const { upload } = require("../helpers/multer");
const router = express.Router();

//create recurring bill
router.post(
    "/recurring-bill/create",
    authMiddleware,
    upload.single("documents"),
    recurringBillController.createRecurring
);

//Get recurring bill by id
router.get(
    "/recurring-bill/:recurring_id",
    authMiddleware,
    recurringBillController.getRecurringById
)

router.put(
    "/recurring-bill/update-status/:status",
    authMiddleware,
    recurringBillController.updateRecurringStatus
)

//Update recurring bill
router.put(
    "/recurring-bill/:recurring_id",
    authMiddleware,
    recurringBillController.updateRecurring
)

router.delete(
    "/recurring-bill/:recurring_bill_id",
    authMiddleware,
    recurringBillController.deleteRecurring
)

//List of recurring bill
router.get(
    "/recurring-bill",
    authMiddleware,
    recurringBillController.getRecurringBill
)

//Create Bill from Recurring
router.post(
    "/recurring-bill/create-bill/:recurring_bill_id",
    authMiddleware,
    recurringBillController.createBillFromRecurring
)
module.exports = router;