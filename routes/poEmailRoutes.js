// const express = require("express");
// const router = express.Router();
// const emailController = require("../controllers/emailController");
// const authMiddleware = require("../middleware/userMiddleware");

// // Apply authentication middleware to all routes
// router.use(authMiddleware);

// // Send email route
// router.post("/po-email/send",authMiddleware,emailController.sendEmail);

// // Get email logs for an organization
// router.get("/po-email/logs", authMiddleware,emailController.getEmailLogs);

// // Get email log details by ID
// router.get("/po-email/logs/:id", authMiddleware,emailController.getEmailLogById);

// // Resend email route
// router.post("/po-email/resend/:id",authMiddleware,emailController.resendEmail);

// // Portal invitation routes
// router.post('/invite-portal', authMiddleware.verifyToken,emailController.sendPortalInvite);
// router.get('/verify-invite', emailController.verifyPortalInvite); // Public endpoint - no auth required

// module.exports = router;


const express = require("express");
const router = express.Router();
const emailController = require("../controllers/poEmailController");
const authMiddleware = require("../middleware/userMiddleware");

// Apply authentication middleware to all routes

// Send email route
router.post("/po-email/send",authMiddleware, emailController.sendEmail);

// Get email logs for an organization
router.get("/po-email/logs",authMiddleware, emailController.getEmailLogs);

// Get email log details by ID
router.get("/po-email/logs/:id",authMiddleware, emailController.getEmailLogById);

// Resend email route
router.post("/po-email/resend/:id",authMiddleware, emailController.resendEmail);

// Portal invitation routes - using the existing middleware
router.post('/invite-portal',authMiddleware, emailController.sendPortalInvite);

// This route needs no auth as it's a public endpoint for verification
router.get('/verify-invite', authMiddleware,emailController.verifyPortalInvite);

module.exports = router;