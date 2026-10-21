const express = require("express");
const AdminController = require("../controllers/adminController");
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
// Send a test SMS with the configured provider
router.post("/admin/sms/test", AdminController.testSms);

module.exports = router;
