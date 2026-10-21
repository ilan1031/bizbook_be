const express = require("express");
const router = express.Router();
const TaxExemptionController = require("../controllers/taxExemptionController");
const authMiddleware = require("../middleware/userMiddleware");


// Create a new tax exemption
router.post("/taxes", authMiddleware, TaxExemptionController.create);
// Get tax exemptions by type
router.get("/taxes", authMiddleware, TaxExemptionController.getTaxByType);

module.exports = router;