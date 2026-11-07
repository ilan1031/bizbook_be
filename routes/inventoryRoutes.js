const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/userMiddleware");
const inventory = require("../controllers/inventoryController");
const planning = require("../controllers/inventoryPlanningController");
const periodLock = require("../helpers/periodLock");

router.get("/inventory/summary", authMiddleware, inventory.summary.bind(inventory));
router.get("/inventory/lookups", authMiddleware, inventory.lookups.bind(inventory));
router.get("/inventory/valuation", authMiddleware, inventory.valuation.bind(inventory));
router.get("/inventory/items/:id/ledger", authMiddleware, inventory.ledger.bind(inventory));
router.get("/inventory/settings", authMiddleware, inventory.getSettings.bind(inventory));
router.put("/inventory/settings", authMiddleware, inventory.saveSettings.bind(inventory));
router.get("/inventory/adjustments", authMiddleware, inventory.listAdjustments.bind(inventory));
router.post("/inventory/adjustments", authMiddleware, periodLock.guard("inventoryAdjustment"), inventory.createAdjustment.bind(inventory));
router.get("/inventory/adjustments/:id", authMiddleware, inventory.getAdjustment.bind(inventory));
router.delete("/inventory/adjustments/:id", authMiddleware, periodLock.guard("inventoryAdjustment"), inventory.deleteAdjustment.bind(inventory));

// Reorder planning (page "reorderPlanning") and landed cost (page "landedCost").
router.get("/inventory/reorder", authMiddleware, planning.reorderList.bind(planning));
router.patch("/inventory/reorder/:id", authMiddleware, planning.reorderUpdate.bind(planning));
router.get("/inventory/landed-cost/lookups", authMiddleware, planning.landedLookups.bind(planning));
router.get("/inventory/landed-cost", authMiddleware, planning.landedList.bind(planning));
router.post("/inventory/landed-cost", authMiddleware, periodLock.guard(), planning.landedCreate.bind(planning));
router.delete("/inventory/landed-cost/:id", authMiddleware, periodLock.guard("landedCost"), planning.landedRemove.bind(planning));

module.exports = router;
