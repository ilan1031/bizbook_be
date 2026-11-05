const express = require("express");
const AdminController = require("../controllers/adminController");
const TeamAdminController = require("../controllers/teamAdminController");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// Superadmin-only. authMiddleware already rejects other users for unknown
// paths; this makes the requirement explicit.
const requireSuperadmin = (req, res, next) => {
  if (!res.locals.is_superadmin) {
    return res
      .status(403)
      .json({ code: "FORBIDDEN", message: "Superadmin access required", success: false });
  }
  next();
};

router.use("/admin", authMiddleware, requireSuperadmin);

// List users (optional ?status=pending|active|inactive)
router.get("/admin/users", AdminController.listUsers);
// Update a user's status, permissions and/or IP limit
router.patch("/admin/users/:id", AdminController.updateUser);
// Remove one of a user's remembered IP addresses
router.delete("/admin/users/:id/ips/:ipId", AdminController.removeUserIp);
// One-time sign-in code for a user (shown once; for when mail is down)
router.post("/admin/users/:id/sign-in-code", AdminController.issueSignInCode);
// Send a test email with the configured mailbox
router.post("/admin/email/test", AdminController.testEmail);
// Teams of every organisation: the team switch, member limit, members, roles, invites
router.get("/admin/teams", TeamAdminController.listTeams);
router.patch("/admin/teams/:organizationId", TeamAdminController.updateTeam);
router.get("/admin/teams/:organizationId/audit", TeamAdminController.audit);
router.patch("/admin/team-members/:id", TeamAdminController.updateMember);
router.post("/admin/team-members/:id/resend", TeamAdminController.resendInvite);
router.delete("/admin/team-members/:id", TeamAdminController.removeMember);

module.exports = router;
