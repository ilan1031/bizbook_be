const express = require("express");
const router = express.Router();
const SalesOrderController = require("../controllers/salesOrderController");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadSales, uploadInvoice } = require("../helpers/multer");



// Create a new sales order
router.post("/salesorders", authMiddleware, uploadSales.single("documents"), SalesOrderController.createSalesOrder);
// Get all sales orders
router.get("/salesorders", authMiddleware, SalesOrderController.getSalesOrders);
// Get a sales order by ID
router.get("/sales-order/:salesorder_id", authMiddleware, SalesOrderController.getSalesOrderById);
// Update a sales order
router.put("/salesorders", authMiddleware, uploadSales.single("documents"), SalesOrderController.updateSalesOrder);
// Delete a sales order
router.delete("/salesorders", authMiddleware, SalesOrderController.deleteSalesOrder);
// Convert sales order to invoice
router.post("/salesorders/convert-to-invoice", uploadInvoice.single("documents"), authMiddleware, SalesOrderController.convertToInvoice);
// Update sales order status
router.put("/sales-order/status", authMiddleware, SalesOrderController.updateSalesOrderStatus);
// Get unique sales order ID
router.get("/sales/unique-id", authMiddleware, SalesOrderController.getUniqueId);
// Get sales order email details by ID
router.get("/salesorders/:salesorder_id/email", authMiddleware, SalesOrderController.getSalesOrderEmailDetails);

module.exports = router;