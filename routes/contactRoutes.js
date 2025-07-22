
const express = require("express");
const router = express.Router();
const ContactController = require("../controllers/contactController");
const { uploadCustomer, upload } = require("../helpers/multer");
const authMiddleware = require("../middleware/userMiddleware");


// -------------------- Contact CRUD Routes --------------------
// Create a new contact (with optional document upload)
router.post("/contact", authMiddleware, uploadCustomer.single("documents"), ContactController.createContact);
// Get all contacts
router.get("/contact", authMiddleware, ContactController.getContacts);
// Get a contact by ID
router.get("/contact/:contact_id", authMiddleware, ContactController.getContactById);
// Update a contact (with optional document upload)
router.put("/contact", upload.single("documents"), authMiddleware, ContactController.updateContact);
// Delete a contact
router.delete("/contact", authMiddleware, ContactController.deleteContact);

// -------------------- Vendor & Customer Overview --------------------
// Get vendor contacts overview based on org_id & admin_id
router.get("/contact/vendorContact/overview", authMiddleware, ContactController.getVendors);
// Get customer contacts overview based on org_id & admin_id
router.get("/contact/customerContact/overview", authMiddleware, ContactController.getCustomers);

// -------------------- Contact Status --------------------
// Change contact status (Active/Inactive)
router.patch("/contact/status", authMiddleware, ContactController.contactStatus);

// -------------------- Additional Address Routes --------------------
// Update an address for a contact
router.put("/contacts/address", authMiddleware, ContactController.updateAddress);
// Delete an additional address for a contact
router.delete("/contacts/additional-address", authMiddleware, ContactController.deleteAdditionalAddress);
// Create additional addresses for a contact
router.post("/contacts/address", authMiddleware, ContactController.createAddresses);
// Add an address for a contact
router.post("/contacts/address", authMiddleware, ContactController.addAddress);

// -------------------- Customer & Vendor Filtered Lists --------------------
// Get filtered customers
router.get("/customers", authMiddleware, ContactController.getFilteredCustomers);
// Get filtered vendors
router.get("/vendors", authMiddleware, ContactController.getFilteredVendors);

// -------------------- Vendor Comments --------------------
// Get comments for vendors
router.get("/vendors/comments", authMiddleware, ContactController.getContactComments);

// -------------------- Contact Person Primary --------------------
// Make a contact person primary
router.put('/contact-person/:id/make-primary', authMiddleware, ContactController.makePrimary);


module.exports = router;
