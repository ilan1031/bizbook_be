const express = require("express");
const router = express.Router();
const InvoiceController = require("../controllers/invoiceController_temp");
const invoiceController_temp = require("../controllers/invoiceController_temp");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadInvoice } = require("../helpers/multer");


// Create a new invoice
router.post("/invoices", authMiddleware, uploadInvoice.single("documents"), InvoiceController.createInvoice);
// Get all invoices with pagination and filtering
router.get("/invoices", authMiddleware, InvoiceController.getInvoices);
// Get a single invoice by ID
router.get("/invoices/:invoice_id", authMiddleware, InvoiceController.getInvoiceById);
// Update an invoice
router.patch("/invoices", authMiddleware, uploadInvoice.single("documents"), InvoiceController.updateInvoice);
// Delete an invoice (soft delete)
router.delete("/invoices", authMiddleware, InvoiceController.deleteInvoice);
// Generate a unique invoice ID
router.get("/invoice-id", authMiddleware, InvoiceController.getUniqueId);
// Ask AI for invoice-related queries
router.post("/ask", authMiddleware, InvoiceController.askAI);
// Get invoice email details by invoice ID
router.get("/invoice/:invoice_id/email", authMiddleware, InvoiceController.getInvoiceEmailDetails);
// Change invoice status
router.put("/invoices/status", authMiddleware, InvoiceController.updateInvoiceStatus);
// Get invoice summary by customer ID
router.get("/invoice/summary/list", authMiddleware, InvoiceController.getCustomerInvoiceSummary);
// Apply payment to invoice by customer and invoice ID
router.put("/invoices/apply-invoice/payment", authMiddleware, InvoiceController.applyInvoice);

module.exports = router;
