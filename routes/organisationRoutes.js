const express = require("express");
const authMiddleware = require("../middleware/userMiddleware");
const orgController = require("../controllers/organisationController");
const router = express.Router();

router.post(
  "/org/create-organisation",
  authMiddleware,
  orgController.createOrg
);
router.post(
  "/org/get-organisation",
  authMiddleware,
  orgController.getOrganisation
);

// Get individual organization
router.get(
  "/organization/:organization_id",
  orgController.getOrganizationById
);

// Update organization
router.put(
  
  "/organization/:organization_id",
  authMiddleware,
  orgController.updateOrganization
);
router.post(
  "/organization/update-default-status",
  authMiddleware,
  orgController.updateOrgStatus
);

module.exports = router;
