const express = require("express");
const router = express.Router();
const SalesOrderController = require("../controllers/salesOrderController");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadSales, uploadInvoice } = require("../helpers/multer");


router.post("/salesorders", authMiddleware,uploadSales.single("documents"), SalesOrderController.createSalesOrder);


router.get("/salesorders", authMiddleware, SalesOrderController.getSalesOrders);


router.get("/sales-order/:salesorder_id", authMiddleware, SalesOrderController.getSalesOrderById);


router.put("/salesorders", authMiddleware,uploadSales.single("documents") , SalesOrderController.updateSalesOrder);


router.delete("/salesorders", authMiddleware, SalesOrderController.deleteSalesOrder);


router.post("/salesorders/convert-to-invoice",uploadInvoice.single("documents"), authMiddleware, SalesOrderController.convertToInvoice);

router.put("/sales-order/status", authMiddleware, SalesOrderController.updateSalesOrderStatus);


router.get("/sales/unique-id", authMiddleware, SalesOrderController.getUniqueId);


router.get("/salesorders/:salesorder_id/email", authMiddleware, SalesOrderController.getSalesOrderEmailDetails);

module.exports = router;