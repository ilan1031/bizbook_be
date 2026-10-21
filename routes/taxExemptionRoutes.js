const express = require("express");
const router = express.Router();
const TaxExemptionController = require("../controllers/taxExemptionController");
const WithholdingTaxController = require("../controllers/withholdingTaxController");
const authMiddleware = require("../middleware/userMiddleware");


// Create a new tax exemption
router.post("/taxes", authMiddleware, TaxExemptionController.create);
// Get tax exemptions by type
router.get("/taxes", authMiddleware, TaxExemptionController.getTaxByType);

// A company's own TDS / TCS rates (type is tds or tcs)
router.get("/tax/:type/details", authMiddleware, WithholdingTaxController.list);
router.post("/tax/:type/create", authMiddleware, WithholdingTaxController.create);
router.delete("/tax/:type/delete/:id", authMiddleware, WithholdingTaxController.remove);

module.exports = router;