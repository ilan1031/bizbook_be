const express = require("express");
const router = express.Router();
const ContactController = require("../controllers/contactController");
const {uploadCustomer, upload } = require("../helpers/multer");
const authMiddleware = require("../middleware/userMiddleware");

router.post("/contact", authMiddleware, uploadCustomer.single("documents"), ContactController.createContact);
router.get("/contact", authMiddleware,ContactController.getContacts);
router.get("/contact/:contact_id",authMiddleware, ContactController.getContactById);
router.put("/contact", upload.single("documents"),authMiddleware , ContactController.updateContact);
router.delete("/contact", authMiddleware ,ContactController.deleteContact);

 // 📌 Vendor contact based on the org_id & admin_id
 router.get("/contact/vendorContact/overview", authMiddleware, ContactController.getVendors);
 router.get("/contact/customerContact/overview", authMiddleware, ContactController.getCustomers);

// 📌Contact status change Active and Inactive 
 router.patch("/contact/status",authMiddleware,ContactController.contactStatus);


// 📌Additional Address routes 
 router.put("/contacts/address",authMiddleware,ContactController.updateAddress);
 router.delete("/contacts/additional-address",authMiddleware,ContactController.deleteAdditionalAddress);
 router.post("/contacts/address", authMiddleware,ContactController.createAddresses);
  router.post("/contacts/address", authMiddleware,ContactController.addAddress);

// 📌Customer routes 
router.get("/customers", authMiddleware, ContactController.getFilteredCustomers);
// Vendors routes
router.get("/vendors", authMiddleware, ContactController.getFilteredVendors);

router.get("/vendors/comments", authMiddleware, ContactController.getContactComments);

// Add this to your contactPersonRoutes.js file
router.put('/contact-person/:id/make-primary', authMiddleware, ContactController.makePrimary);


module.exports = router;
