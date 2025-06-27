const express = require("express");
const dashboardController = require("../controllers/dashBoardController");
const authMiddleware = require("../middleware/userMiddleware");
// const { upload } = require("../helpers/multer");
const router = express.Router();

router.get(
  "/get-receivables",
  authMiddleware,
  dashboardController.getReceivables
);
router.get(
  "/get-payable",
  authMiddleware,
  dashboardController.getPayables
);

module.exports = router;
