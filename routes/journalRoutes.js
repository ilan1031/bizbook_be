const express = require("express");
const JournalController = require("../controllers/journalReportController");
const router = express.Router();
const authMiddleware = require("../middleware/userMiddleware");

router.get("/get-journal", authMiddleware, JournalController.getAllJournal);
router.get(
  "/get-individual-journal",
  authMiddleware,
  JournalController.getIndividualJournal
);
module.exports = router;    
