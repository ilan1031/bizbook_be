const mongoose = require("mongoose");
const UsersCollection = mongoose.model("user");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { CATALOG, sanitizePermissions } = require("../helpers/rbac");
const { isMailConfigured, sendMail } = require("../helpers/mailer");
const { sendApprovedEmail } = require("../helpers/accountEmails");

const STATUSES = ["pending", "active", "inactive"];

// Fields the admin screen shows; never the password or OTP hash.
const PUBLIC_FIELDS =
  "email mobile company_name country state role status permissions ip_limit allowed_ips last_login_at approved_at createdAt";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id));

class AdminController {
  async listUsers(req, res) {
    try {
      const query = {};
      if (req.query.status && STATUSES.includes(req.query.status)) {
        query.status = req.query.status;
      }
      const users = await UsersCollection.find(query)
        .select(PUBLIC_FIELDS)
        .sort({ createdAt: -1 })
        .lean();
      const counts = await UsersCollection.aggregate([
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]);
      res.status(ST_CODES.OK).json({
        status: true,
        data: users,
        counts: Object.fromEntries(counts.map((c) => [c._id || "pending", c.n])),
        catalog: CATALOG,
        email: { configured: isMailConfigured(), from: isMailConfigured() ? process.env.EMAIL_USER : "" },
      });
    } catch (error) {
      console.log("admin listUsers error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Failed to load users" });
    }
  }

  // Update status, permissions and/or IP limit for one user.
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      if (!isValidId(id)) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Invalid user id" });
      }
      const user = await UsersCollection.findById(id);
      if (!user) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "User not found" });
      if (user.role === "superadmin") {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "The superadmin account can't be changed here.",
        });
      }

      const { status, permissions, ip_limit } = req.body || {};
      const wasActive = user.status === "active";

      if (status !== undefined) {
        if (!STATUSES.includes(status)) {
          return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Invalid status" });
        }
        user.status = status;
        if (status === "active" && !user.approved_at) user.approved_at = new Date();
      }
      if (permissions !== undefined) {
        user.permissions = sanitizePermissions(permissions);
        user.markModified("permissions");
      }
      if (ip_limit !== undefined) {
        const limit = Number(ip_limit);
        if (!Number.isInteger(limit) || limit < 0 || limit > 50) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            status: false,
            message: "IP limit must be a whole number between 0 and 50",
          });
        }
        user.ip_limit = limit;
      }
      await user.save();

      // Tell the user they're approved and can start.
      let email = null;
      if (!wasActive && user.status === "active") {
        email = await sendApprovedEmail(user);
        if (!email.ok) console.error("[approval email] not sent:", email.error);
      }

      const fresh = await UsersCollection.findById(id).select(PUBLIC_FIELDS).lean();
      res.status(ST_CODES.OK).json({ status: true, data: fresh, email, message: "User updated" });
    } catch (error) {
      console.log("admin updateUser error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Failed to update user" });
    }
  }

  // Remove one remembered IP so the user can sign in from a different one.
  async removeUserIp(req, res) {
    try {
      const { id, ipId } = req.params;
      if (!isValidId(id) || !isValidId(ipId)) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Invalid id" });
      }
      const result = await UsersCollection.findOneAndUpdate(
        { _id: id, role: { $ne: "superadmin" } },
        { $pull: { allowed_ips: { _id: ipId } } },
        { new: true }
      ).select(PUBLIC_FIELDS);
      if (!result) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "User not found" });
      res.status(ST_CODES.OK).json({ status: true, data: result, message: "IP removed" });
    } catch (error) {
      console.log("admin removeUserIp error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Failed to remove IP" });
    }
  }

  // Sends a test email, so the superadmin can check the mailbox settings.
  async testEmail(req, res) {
    const to = String(req.body?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Enter a valid email address" });
    }
    const result = await sendMail({
      to,
      subject: "BizBooks test email",
      text: "This is a test from BizBooks. If you can read it, sign-in codes and account emails will arrive too.",
    });
    res.status(result.ok ? ST_CODES.OK : ST_CODES.BAD_REQUEST).json({
      status: result.ok,
      ...result,
      message: result.ok
        ? result.channel === "console"
          ? "Email isn't set up yet: the test was written to the server log"
          : `Test email sent to ${to}`
        : result.error,
    });
  }
}

module.exports = new AdminController();
