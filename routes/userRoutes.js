const express = require("express");
const usersController = require("../controllers/usersControllers");
const authMiddleware = require("../middleware/userMiddleware");

const router = express.Router();

// Register a new user
router.post("/user/user-register", usersController.userRegister);
// User login
router.post("/user/user-login", usersController.userLogin);
// Second login step when signing in from a new IP (SMS code)
router.post("/user/verify-login-otp", usersController.verifyLoginOtp);
// Current user's role, status and page permissions
router.get("/user/me", authMiddleware, usersController.getMe);
// Fetch user by token
router.get("/user/fetch/:token", usersController.fetchUser);
// Get admin user data (requires auth)
router.post("/user/get-admin", authMiddleware, usersController.getUserData);
// Register a new client
router.post("/client/register", usersController.clientRegister);
// Client login
router.post("/client/login", usersController.clientLogin);
// Fetch client by token
router.get("/client/fetch/:token", usersController.fetchClient);
// router.post("/add-assets-records", usersController.addAssetsRecords);

module.exports = router;
