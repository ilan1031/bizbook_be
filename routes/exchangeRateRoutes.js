const express = require("express");
const authMiddleware = require("../middleware/userMiddleware");
const rates = require("../controllers/exchangeRateController");
const router = express.Router();

// Page permission "exchangeRates" (helpers/rbac.js): view reads and converts,
// create saves a rate, delete removes one.
router.get("/currencies/summary", authMiddleware, rates.summary.bind(rates));
router.get("/currencies/convert", authMiddleware, rates.convert.bind(rates));
router.get("/currencies/rates", authMiddleware, rates.list.bind(rates));
router.post("/currencies/rates", authMiddleware, rates.save.bind(rates));
router.delete("/currencies/rates/:id", authMiddleware, rates.remove.bind(rates));

module.exports = router;
