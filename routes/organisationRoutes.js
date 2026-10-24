const express = require("express");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../middleware/userMiddleware");
const orgController = require("../controllers/organisationController");
const docTemplates = require("../controllers/docTemplateController");
const router = express.Router();

// Create a new organization
router.post("/org/create-organisation", authMiddleware, orgController.createOrg);
// Invoice and quote templates (per organisation)
router.get("/org/templates", authMiddleware, docTemplates.get);
router.put("/org/templates/:type", authMiddleware, docTemplates.save);
// Get organization(s)
router.post("/org/get-organisation", authMiddleware, orgController.getOrganisation);
// Get individual organization by ID
// Without a token (the customer portal's sign-in page) only the name is
// returned, so the page can show who the customer is signing in to.
// Only a business user's valid token gets the full record. No token, an
// expired or invalid one, or a customer-portal one (which a customer still has
// when they open the sign-in page) all get the public name.
router.get("/organization/:organization_id", (req, res, next) => {
  const token = String(req.headers.authorization || "").split(" ")[1];
  if (token) {
    try {
      if (jwt.verify(token, process.env.JWT_SECRET).role !== "client") return next();
    } catch {
      // fall through to the public answer
    }
  }
  return orgController.getPublicOrganization(req, res);
});
router.get("/organization/:organization_id", authMiddleware, orgController.getOrganizationById);
// Update organization by ID
router.put("/organization/:organization_id", authMiddleware, orgController.updateOrganization);
// Update default status of organization
router.post("/organization/update-default-status", authMiddleware, orgController.updateOrgStatus);

module.exports = router;
