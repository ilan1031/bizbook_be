const express = require("express");
const router = express.Router();
const contactController = require("../controllers/contactPersonController");
const authMiddleware = require("../middleware/userMiddleware");

// Routes
router.post("/contact-person",authMiddleware,contactController.createcontactPerson);
router.get("/contact-person", authMiddleware,contactController.getcontactPersons);
router.get("/contact-person/:contact_id", authMiddleware,contactController.getcontactPersonsByContactId);
router.put("/contact-person/:contact_person_id",authMiddleware, contactController.updatecontactPerson);
router.delete("/contact-person/:contact_person_id",authMiddleware, contactController.deletecontactPerson);
router.get("/individual-contact-person/:contact_person_id", authMiddleware, contactController.getContactPersonById);

module.exports = router;
