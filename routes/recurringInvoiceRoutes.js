const express = require("express");
const router = express.Router();
const recurringInvoiceController = require("../controllers/recurringInvoiceController");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadRecurringInvoice } = require("../helpers/multer");


// Create a recurring invoice
router.post("/RecurringInvoices/recurring", authMiddleware, uploadRecurringInvoice.single("documents"), recurringInvoiceController.createRecurringInvoice);
// Get an individual recurring invoice by ID
router.get("/RecurringInvoices/individual/:recurring_invoice_id", authMiddleware, recurringInvoiceController.getRecurringInvoiceById);
// Get an individual recurring invoice (alternate route)
router.get("/RecurringInvoices/individual", authMiddleware, recurringInvoiceController.getRecurringInvoiceById);
// Update a recurring invoice
router.put("/RecurringInvoices/individual/update", authMiddleware, recurringInvoiceController.updateRecurringInvoice);
// Get all recurring invoices
router.get("/RecurringInvoices/getall", authMiddleware, recurringInvoiceController.getRecurringInvoices);
// Soft delete a recurring invoice
router.delete("/RecurringInvoices/individual/delete", authMiddleware, recurringInvoiceController.deleteRecurringInvoice);



module.exports = router;



