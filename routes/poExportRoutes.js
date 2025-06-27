const express = require("express");
const router = express.Router();
const exportController = require("../controllers/poExportController");
const authMiddleware = require("../middleware/userMiddleware");

// Export data route
router.post("/export", authMiddleware, exportController.exportData);

module.exports = router;