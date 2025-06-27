const express = require("express");
const router = express.Router();
const InvoiceController = require("../controllers/invoiceController_temp");
const invoiceController_temp = require("../controllers/invoiceController_temp");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadInvoice } = require("../helpers/multer");

// Create a new invoice
router.post("/invoices",authMiddleware,uploadInvoice.single("documents"), InvoiceController.createInvoice);
// Get all invoices with pagination and filtering
router.get("/invoices", authMiddleware, InvoiceController.getInvoices);
// Get a single invoice by ID
router.get(
  "/invoices/:invoice_id",
  authMiddleware,
  InvoiceController.getInvoiceById
);
// Update an invoice
router.patch("/invoices",authMiddleware,uploadInvoice.single("documents"), InvoiceController.updateInvoice);
// Example: /invoices?organization_id=60037967066&invoice_id=500001
// Delete an invoice (soft delete)
router.delete("/invoices",authMiddleware, InvoiceController.deleteInvoice);
// Example: /invoices?organization_id=60037967066&invoice_id=500001
router.get("/invoice-id",authMiddleware,InvoiceController.getUniqueId);
router.post('/ask', InvoiceController.askAI);
//email fetch
router.get("/invoice/:invoice_id/email",authMiddleware, InvoiceController.getInvoiceEmailDetails);
// 📌 Change sales order status
router.put("/invoices/status", authMiddleware, InvoiceController.updateInvoiceStatus);

// 📌 get invoice by customer id
router.get("/invoice/summary/list", authMiddleware, InvoiceController.getCustomerInvoiceSummary);

// 📌 update invoice by customer id based on the invoice id
router.put("/invoices/apply-invoice/payment",authMiddleware,InvoiceController.applyInvoice);

module.exports = router;
