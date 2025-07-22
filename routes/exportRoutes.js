const express = require("express");
const router = express.Router();
const exportController = require("../controllers/exportController");
const UniqueIdController = require("../controllers/uniqueIdController");
const authMiddleware = require("../middleware/userMiddleware");


// Export data
router.post("/export", authMiddleware, exportController.exportData);
// Get a unique ID for export
router.post("/get-unique-id", authMiddleware, UniqueIdController.getUniqueID);

module.exports = router;
