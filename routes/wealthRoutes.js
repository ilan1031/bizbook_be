const express = require("express");
const authMiddleware = require("../middleware/userMiddleware");
const wealth = require("../controllers/wealthController");
const router = express.Router();

// :scope is "company" (page permission "investments", posts to the books) or
// "personal" (page permission "personalWealth", never touches the books).
// helpers/rbac.js maps each scope to its own page, so they are granted apart.
// Cash forecast (page "cashForecast"): company only, declared before the :scope routes.
const forecast = require("../controllers/forecastController");
router.get("/wealth/company/forecast", authMiddleware, forecast.forecast.bind(forecast));
router.get("/wealth/company/forecast-items", authMiddleware, forecast.items.bind(forecast));
router.post("/wealth/company/forecast-items", authMiddleware, forecast.itemCreate.bind(forecast));
router.delete("/wealth/company/forecast-items/:id", authMiddleware, forecast.itemRemove.bind(forecast));

const base = "/wealth/:scope";
router.get(`${base}/lookups`, authMiddleware, wealth.lookups.bind(wealth));
router.get(`${base}/investments`, authMiddleware, wealth.list.bind(wealth));
router.post(`${base}/investments`, authMiddleware, wealth.create.bind(wealth));
router.patch(`${base}/investments/:id`, authMiddleware, wealth.update.bind(wealth));
router.post(`${base}/investments/:id/valuations`, authMiddleware, wealth.value.bind(wealth));
router.post(`${base}/investments/:id/close`, authMiddleware, wealth.close.bind(wealth));
router.delete(`${base}/investments/:id`, authMiddleware, wealth.remove.bind(wealth));
// Goals (same page permission as the area: "investments" or "personalWealth").
const goals = require("../controllers/goalController");
router.get(`${base}/goals`, authMiddleware, goals.list.bind(goals));
router.post(`${base}/goals`, authMiddleware, goals.create.bind(goals));
router.patch(`${base}/goals/:id`, authMiddleware, goals.update.bind(goals));
router.delete(`${base}/goals/:id`, authMiddleware, goals.remove.bind(goals));
router.post(`${base}/goals/:id/contributions`, authMiddleware, goals.contribute.bind(goals));
router.delete(`${base}/goals/:id/contributions/:cid`, authMiddleware, goals.uncontribute.bind(goals));
router.get(`${base}/net-worth`, authMiddleware, wealth.netWorth.bind(wealth));
// Personal assets and loans that are not investments (personal scope only).
router.get(`${base}/entries`, authMiddleware, wealth.entries.bind(wealth));
router.post(`${base}/entries`, authMiddleware, wealth.entryCreate.bind(wealth));
router.patch(`${base}/entries/:id`, authMiddleware, wealth.entryUpdate.bind(wealth));
router.delete(`${base}/entries/:id`, authMiddleware, wealth.entryRemove.bind(wealth));

module.exports = router;
