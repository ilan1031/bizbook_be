const express = require("express");
const router = express.Router();
const contactController = require("../controllers/contactPersonController");
const authMiddleware = require("../middleware/userMiddleware");

// Routes
// Create a new contact person
router.post("/contact-person",authMiddleware,contactController.createcontactPerson);
// Get all contact persons
router.get("/contact-person", authMiddleware,contactController.getcontactPersons);
// Get contact persons by contact ID
router.get("/contact-person/:contact_id", authMiddleware,contactController.getcontactPersonsByContactId);
// Update a contact person by ID
router.put("/contact-person/:contact_person_id",authMiddleware, contactController.updatecontactPerson);
// Delete a contact person by ID
router.delete("/contact-person/:contact_person_id",authMiddleware, contactController.deletecontactPerson);
// Get an individual contact person by ID
router.get("/individual-contact-person/:contact_person_id", authMiddleware, contactController.getContactPersonById);

module.exports = router;
