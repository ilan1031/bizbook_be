const express = require("express");
const Lock = require("../controllers/periodLockController");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// Page permission "periodLock" (helpers/rbac.js): view reads, edit changes the lock.
router.get("/period-lock", authMiddleware, Lock.get);
router.put("/period-lock", authMiddleware, Lock.set);

module.exports = router;
