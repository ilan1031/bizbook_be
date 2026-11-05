const express = require("express");
const teamController = require("../controllers/teamController");
const authMiddleware = require("../middleware/userMiddleware");

const router = express.Router();

// Public: the invite link (no sign-in; the signed link is the credential).
router.get("/team/invite", teamController.getInvite);
router.post("/team/accept-invite", teamController.acceptInvite);

// The org admin's team (the teamUsers switch is checked in helpers/rbac.js).
router.get("/team", authMiddleware, teamController.overview);
router.get("/team/audit", authMiddleware, teamController.audit);
router.post("/team/members", authMiddleware, teamController.invite);
router.patch("/team/members/:id", authMiddleware, teamController.updateMember);
router.post("/team/members/:id/resend", authMiddleware, teamController.resendInvite);
router.delete("/team/members/:id", authMiddleware, teamController.removeMember);
router.post("/team/roles", authMiddleware, teamController.createRole);
router.patch("/team/roles/:id", authMiddleware, teamController.updateRole);
router.delete("/team/roles/:id", authMiddleware, teamController.deleteRole);

module.exports = router;
