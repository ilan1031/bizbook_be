// // routes/email.js
// const express = require('express');
// const router = express.Router();
// const authMiddleware = require("../middleware/userMiddleware");

// const emailController = require('../controllers/emailController');

// router.post('/send',authMiddleware,emailController.sendEmail);

// module.exports = router;


const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/userMiddleware");
const emailController = require("../controllers/emailController");

router.post("/send",authMiddleware, emailController.sendEmail.bind(emailController));
router.get("/logs",authMiddleware, emailController.getEmailLogs);
router.get("/logs/:id", authMiddleware,emailController.getEmailLogById);

module.exports = router;