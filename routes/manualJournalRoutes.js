const express = require("express");
const ManualJournalController = require("../controllers/manualJournalController");
const authMiddleware = require("../middleware/userMiddleware");
const periodLock = require("../helpers/periodLock");
const router = express.Router();

// List manual journal entries
router.get("/manual-journals", authMiddleware, ManualJournalController.getManualJournals);
// Create a manual journal entry (debits must equal credits)
router.post("/manual-journals", authMiddleware, periodLock.guard("manualJournal"), ManualJournalController.createManualJournal);
// Delete a manual journal entry
router.delete("/manual-journals/:journal_id", authMiddleware, periodLock.guard("manualJournal"), ManualJournalController.deleteManualJournal);

module.exports = router;
