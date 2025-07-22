const express = require("express");
const UniqueIdController = require("../controllers/uniqueIdController");
const authMiddleware = require("../middleware/userMiddleware");
// const { upload } = require("../helpers/multer");
const router = express.Router();

// Get a unique ID
router.post("/get-unique-id", authMiddleware, UniqueIdController.getUniqueID);

module.exports = router;
