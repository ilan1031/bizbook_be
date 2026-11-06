const express = require("express");
const router = express.Router();
const PaymentController = require("../controllers/PaymentController");
const authMiddleware = require("../middleware/userMiddleware");
const periodLock = require("../helpers/periodLock");
const { uploadPaymentMade } = require("../helpers/multer");


// Update payment

// Update payment
router.put("/payments/update", authMiddleware, uploadPaymentMade.single("documents"), periodLock.guard("paymentMade"), PaymentController.updatePayment);
// Create payment
router.post("/payments/made", authMiddleware, uploadPaymentMade.single("documents"), periodLock.guard("paymentMade"), PaymentController.createPayment);
// Get all payment details with vendor and org details
router.get("/payments/allpayment", authMiddleware, PaymentController.getPaymentDetails);
// Soft delete payment
router.delete("/payments/delete", authMiddleware, periodLock.guard("paymentMade"), PaymentController.deletePayment);
// Get payments by payment type (vendor or customer)
router.get("/payments/type/:payment_type", authMiddleware, PaymentController.getPaymentsByType);
// Get all payments (with optional filtering)
router.get("/payments/getall", authMiddleware, PaymentController.getAllPayments);
// Get payment email details by payment ID
router.get("/payment-email/:payment_id", authMiddleware, PaymentController.getPaymentEmailDetails);
// Remove document from payment
router.post("/payments/remove-document", authMiddleware, PaymentController.removeDocumentFromPayment);
// Update payment status
router.put("/payments/status", authMiddleware, periodLock.guard("paymentMade"), PaymentController.updatePaymentStatus);

module.exports = router;
