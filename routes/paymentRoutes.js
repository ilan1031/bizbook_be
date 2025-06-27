const express = require("express");
const router = express.Router();
const { upload } = require("../helpers/multer");

const authMiddleware = require("../middleware/userMiddleware");
const paymentController = require("../controllers/customerPaymentController");

// 📌 Create a new PaymentReceived & Customer Advance
router.post("/payment/customerpayments",authMiddleware,upload.single("documents"), paymentController.createCustomerPayment);
// 📌 Get all  PaymentReceived & Customer Advance with pagination
router.get("/payment/getPaymentsReceived",authMiddleware, paymentController.getPaymentsReceived);
// 📌 Get individual  PaymentReceived & Customer Advance by payment_id
router.get("/payment/individual",authMiddleware, paymentController.getIndividualPaymentReceived);
// 📌 Delete individual  PaymentReceived & Customer Advance by payment_id
router.delete("/payment",authMiddleware,paymentController.deleteCustomerPayment);
// 📌 Update individual  PaymentReceived & Customer Advance by payment_id
router.put("/payment/individual/update",authMiddleware,paymentController.updateCustomerPayment);
// 📌 Refund  PaymentReceived & Customer Advance by payment_id
router.post("/payment/refund",authMiddleware,paymentController.refundCustomerPayment);

router.get("/payment/id",authMiddleware,paymentController.getUniqueId);

// router.put('/payment/confirm', authMiddleware, paymentController.updatePaymentAfterSuccess);

router.post('/payment/verify-payment', authMiddleware, paymentController.verifyPayment);


module.exports = router;