const express = require("express");
const router = express.Router();
const recurringInvoiceController = require("../controllers/recurringInvoiceController");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadRecurringInvoice } = require("../helpers/multer");

// 📌Recurring Invoice 
router.post("/RecurringInvoices/recurring",authMiddleware, uploadRecurringInvoice.single("documents") ,recurringInvoiceController.createRecurringInvoice);
// 📌get INdividual Recurring Invoice 
router.get( "/RecurringInvoices/individual/:recurring_invoice_id",authMiddleware,recurringInvoiceController.getRecurringInvoiceById);

router.get( "/RecurringInvoices/individual",authMiddleware,recurringInvoiceController.getRecurringInvoiceById);
// 📌Update   Recurring Invoice 
router.put("/RecurringInvoices/individual/update",authMiddleware,recurringInvoiceController.updateRecurringInvoice);
// 📌get  Recurring Invoice 
router.get("/RecurringInvoices/getall",authMiddleware,recurringInvoiceController.getRecurringInvoices);
// 📌Soft Delete Recurring Invoice 
router.delete("/RecurringInvoices/individual/delete",authMiddleware,recurringInvoiceController.deleteRecurringInvoice);



module.exports = router;



