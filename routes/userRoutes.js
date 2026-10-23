const express = require("express");
const usersController = require("../controllers/usersControllers");
const workspaceController = require("../controllers/workspaceController");
const portalPassword = require("../controllers/portalPasswordController");
const authMiddleware = require("../middleware/userMiddleware");

const router = express.Router();

// Register a new user
router.post("/user/user-register", usersController.userRegister);
// User login
router.post("/user/user-login", usersController.userLogin);
// Second login step: the emailed sign-in code
router.post("/user/verify-login-otp", usersController.verifyLoginOtp);
// Current user's role, status and page permissions
router.get("/user/me", authMiddleware, usersController.getMe);
// Top bar: global search, notifications and the user's own account
router.get("/user/search", authMiddleware, workspaceController.search);
router.get("/user/notifications", authMiddleware, workspaceController.notifications);
router.get("/user/profile", authMiddleware, workspaceController.profile);
router.patch("/user/profile", authMiddleware, workspaceController.updateProfile);
router.post("/user/change-password", authMiddleware, workspaceController.changePassword);
router.post("/client/change-password", authMiddleware, workspaceController.changePassword);
// Fetch user by token
router.get("/user/fetch/:token", usersController.fetchUser);
// Get admin user data (requires auth)
router.post("/user/get-admin", authMiddleware, usersController.getUserData);
// Register a new client
router.post("/client/register", usersController.clientRegister);
// Client login
router.post("/client/login", usersController.clientLogin);
// Customer-portal password reset (emailed link)
router.post("/client/forgot-password", portalPassword.forgotPassword);
router.post("/client/reset-password", portalPassword.resetPassword);
// Fetch client by token
router.get("/client/fetch/:token", usersController.fetchClient);
// router.post("/add-assets-records", usersController.addAssetsRecords);

module.exports = router;
