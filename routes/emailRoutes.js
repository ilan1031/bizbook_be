const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/userMiddleware");
const emailController = require("../controllers/emailController");


// Send an email
router.post("/send", authMiddleware, emailController.sendEmail.bind(emailController));

// Get all email logs
router.get("/logs", authMiddleware, emailController.getEmailLogs);

// Get a specific email log by ID
router.get("/logs/:id", authMiddleware, emailController.getEmailLogById);

module.exports = router;