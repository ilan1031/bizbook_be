const express = require("express");
const authMiddleware = require("../middleware/userMiddleware");
const orgController = require("../controllers/organisationController");
const router = express.Router();

// Create a new organization
router.post("/org/create-organisation", authMiddleware, orgController.createOrg);
// Get organization(s)
router.post("/org/get-organisation", authMiddleware, orgController.getOrganisation);
// Get individual organization by ID
router.get("/organization/:organization_id", orgController.getOrganizationById);
// Update organization by ID
router.put("/organization/:organization_id", authMiddleware, orgController.updateOrganization);
// Update default status of organization
router.post("/organization/update-default-status", authMiddleware, orgController.updateOrgStatus);

module.exports = router;
