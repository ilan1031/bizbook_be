const express = require("express");
const authMiddleware = require("../middleware/userMiddleware");
const reminders = require("../controllers/paymentReminderController");
const router = express.Router();

// Page permission "paymentReminders" (helpers/rbac.js): view lists and reads the
// history, create sends reminders.
router.get("/reminders", authMiddleware, reminders.list.bind(reminders));
router.get("/reminders/log", authMiddleware, reminders.log.bind(reminders));
router.post("/reminders/send", authMiddleware, reminders.send.bind(reminders));

module.exports = router;
