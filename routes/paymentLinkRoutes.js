const express = require("express");
const authMiddleware = require("../middleware/userMiddleware");
const links = require("../controllers/paymentLinkController");
const router = express.Router();

// Page permission "paymentLinks" (helpers/rbac.js): view lists, create makes a
// link, delete cancels one.
router.get("/payment-links/invoices", authMiddleware, links.invoices.bind(links));
router.get("/payment-links", authMiddleware, links.list.bind(links));
router.post("/payment-links", authMiddleware, links.create.bind(links));
router.delete("/payment-links/:id", authMiddleware, links.cancel.bind(links));

// Called by Razorpay, not by a signed-in user: checked by its signature instead.
router.post("/webhooks/razorpay", links.webhook.bind(links));

module.exports = router;
