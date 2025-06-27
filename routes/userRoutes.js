const express = require("express");
const usersController = require("../controllers/usersControllers");
const authMiddleware = require("../middleware/userMiddleware");

const router = express.Router();

router.post("/user/user-register", usersController.userRegister);
router.post("/user/user-login", usersController.userLogin);
router.get("/user/fetch/:token", usersController.fetchUser);
router.post("/user/get-admin", authMiddleware, usersController.getUserData);
router.post("/client/register", usersController.clientRegister);
router.post("/client/login", usersController.clientLogin);
router.get("/client/fetch/:token", usersController.fetchClient);
// router.post("/add-assets-records", usersController.addAssetsRecords);

module.exports = router;
