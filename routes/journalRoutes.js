const express = require("express");
const JournalController = require("../controllers/journalReportController");
const router = express.Router();
const authMiddleware = require("../middleware/userMiddleware");

// Get all journal entries
router.get("/get-journal", authMiddleware, JournalController.getAllJournal);
// Get an individual journal entry
router.get("/get-individual-journal", authMiddleware, JournalController.getIndividualJournal);
module.exports = router;    
