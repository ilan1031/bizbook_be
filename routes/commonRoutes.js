const express = require("express");
const router = express.Router();
const CommonController = require("../controllers/commonController");
const authMiddleware = require("../middleware/userMiddleware");

router.get("/columns", authMiddleware,CommonController.getColumns);
router.put("/columns", authMiddleware,CommonController.updateColumn);

module.exports = router;
