const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/userMiddleware");
const inventory = require("../controllers/inventoryController");

router.get("/inventory/summary", authMiddleware, inventory.summary.bind(inventory));
router.get("/inventory/lookups", authMiddleware, inventory.lookups.bind(inventory));
router.get("/inventory/valuation", authMiddleware, inventory.valuation.bind(inventory));
router.get("/inventory/items/:id/ledger", authMiddleware, inventory.ledger.bind(inventory));
router.get("/inventory/settings", authMiddleware, inventory.getSettings.bind(inventory));
router.put("/inventory/settings", authMiddleware, inventory.saveSettings.bind(inventory));
router.get("/inventory/adjustments", authMiddleware, inventory.listAdjustments.bind(inventory));
router.post("/inventory/adjustments", authMiddleware, inventory.createAdjustment.bind(inventory));
router.get("/inventory/adjustments/:id", authMiddleware, inventory.getAdjustment.bind(inventory));
router.delete("/inventory/adjustments/:id", authMiddleware, inventory.deleteAdjustment.bind(inventory));

module.exports = router;
