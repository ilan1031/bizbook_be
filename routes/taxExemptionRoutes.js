const express = require("express");
const router = express.Router();
const TaxExemptionController = require("../controllers/taxExemptionController");
const authMiddleware = require("../middleware/userMiddleware");


router.post("/taxes", authMiddleware,TaxExemptionController.create);
router.get("/taxes",TaxExemptionController.getTaxByType);

module.exports = router;