const mongoose = require("mongoose");
const UsersCollection = mongoose.model("user");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { CATALOG, sanitizePermissions } = require("../helpers/rbac");
const { isMailConfigured, fromAddress, sendMail, getMailHealth, mailTarget } = require("../helpers/mailer");
const { sendApprovedEmail } = require("../helpers/accountEmails");
const { sanitizeLimits, usageFor } = require("../helpers/usageLimits");
const { OTP_TTL_MS, OTP_MAX_ATTEMPTS, ISSUE_WINDOW_MS, ISSUE_MAX, AUDIT_KEEP, newCode, hashOtp, unsealCode } = require("../helpers/signInCodes");

const STATUSES = ["pending", "active", "inactive"];

// Fields the admin screen shows; never the password or OTP hash (sign_in_code_log
// has who issued or used a sign-in code, and when, but no code).
const PUBLIC_FIELDS =
  "email mobile company_name country state role status permissions limits ip_limit allowed_ips last_login_at approved_at createdAt sign_in_code_log";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id));

class AdminController {
  async listUsers(req, res) {
    // The list can include a pending sign-in code: never cache it.
    res.set("Cache-Control", "no-store");
    try {
      const query = {};
      if (req.query.status && STATUSES.includes(req.query.status)) {
        query.status = req.query.status;
      }
      const users = await UsersCollection.find(query)
        .select(`${PUBLIC_FIELDS} login_otp`)
        .sort({ createdAt: -1 })
        .lean();
      // A sign-in code that couldn't be emailed waits here for the superadmin
      // to pass it on (5 minutes, works once). Nothing else of login_otp leaves.
      for (const u of users) {
        const otp = u.login_otp;
        delete u.login_otp;
        if (otp?.sealed && new Date(otp.expires_at) > new Date() && (otp.attempts || 0) < OTP_MAX_ATTEMPTS) {
          const code = unsealCode(otp.sealed);
          if (code) u.pending_sign_in_code = { code, expires_at: otp.expires_at, reason: otp.reason || "email_failed" };
        }
      }
      // Everyone with a code waiting, whichever tab is open (the banner).
      const waiting = await UsersCollection.find({
        "login_otp.sealed": { $exists: true },
        "login_otp.expires_at": { $gt: new Date() },
      })
        .select("email login_otp")
        .lean();
      const pendingCodes = waiting
        .filter((u) => (u.login_otp.attempts || 0) < OTP_MAX_ATTEMPTS)
        .map((u) => ({ user_id: u._id, email: u.email, code: unsealCode(u.login_otp.sealed), expires_at: u.login_otp.expires_at, reason: u.login_otp.reason || "email_failed" }))
        .filter((c) => c.code);
      // Records created today / this month / this year, against the limits.
      const usage = await usageFor(users.map((u) => u._id));
      const orgCounts = await mongoose.model("Organization").aggregate([
        { $match: { admin_id: { $in: users.map((u) => u._id) } } },
        { $group: { _id: "$admin_id", n: { $sum: 1 } } },
      ]);
      const orgsBy = Object.fromEntries(orgCounts.map((o) => [String(o._id), o.n]));
      for (const u of users) {
        u.usage = { ...usage[String(u._id)], organizations: orgsBy[String(u._id)] || 0 };
      }
      const counts = await UsersCollection.aggregate([
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]);
      res.status(ST_CODES.OK).json({
        status: true,
        data: users,
        pending_codes: pendingCodes,
        counts: Object.fromEntries(counts.map((c) => [c._id || "pending", c.n])),
        catalog: CATALOG,
        email: {
          configured: isMailConfigured(),
          from: isMailConfigured() ? fromAddress() : "",
          target: mailTarget(),
          // The last real send: { ok, error, checked_at }. null until mail is tried.
          health: await getMailHealth(),
        },
      });
    } catch (error) {
      console.log("admin listUsers error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Failed to load users" });
    }
  }

  // Update status, permissions, create limits and/or IP limit for one user.
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

      const { status, permissions, ip_limit, limits } = req.body || {};
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
      if (limits !== undefined) {
        const checked = sanitizeLimits(limits);
        if (checked.error) return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: checked.error });
        user.limits = checked.limits;
        user.markModified("limits");
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

  // POST /admin/users/:id/sign-in-code: a one-time code for that user's next
  // sign-in, shown once here. It is stored hashed, expires like an emailed code,
  // works once, and is recorded (who issued it, and when). No email is sent.
  async issueSignInCode(req, res) {
    res.set("Cache-Control", "no-store");
    try {
      const { id } = req.params;
      if (!isValidId(id)) return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Invalid user id" });
      const user = await UsersCollection.findById(id).select("email status role login_otp sign_in_code_log").lean();
      if (!user) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "User not found" });
      if (user.status !== "active" && user.role !== "superadmin") {
        return res.status(409).json({
          status: false,
          code: "NOT_ACTIVE",
          message: "Approve this account before giving it a sign-in code.",
        });
      }

      const now = new Date();
      const issuedRecently = (user.sign_in_code_log || []).filter(
        (e) => e.action === "issued" && now - new Date(e.at) < ISSUE_WINDOW_MS
      ).length;
      if (issuedRecently >= ISSUE_MAX) {
        return res.status(429).json({
          status: false,
          code: "RATE_LIMITED",
          message: "Too many sign-in codes for this account. Try again in a few minutes.",
        });
      }

      const actorId = res.locals.actor_id;
      const actorEmail = res.user?.email || "";
      const code = newCode();
      const expires_at = new Date(now.getTime() + OTP_TTL_MS);
      // Replaces any code already pending (emailed or issued before).
      await UsersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            login_otp: {
              code_hash: hashOtp(code),
              expires_at,
              attempts: 0,
              source: "admin",
              issued_by: actorId,
              issued_at: now,
            },
          },
          $push: { sign_in_code_log: { $each: [{ action: "issued", at: now, by: actorId, by_email: actorEmail }], $slice: -AUDIT_KEEP } },
        }
      );
      // The audit line names the account and the issuer, never the code.
      console.log(`[audit] sign-in code issued for ${user.email} by ${actorEmail} at ${now.toISOString()}`);

      res.status(ST_CODES.CREATED).json({
        status: true,
        data: { code, expires_at, email: user.email },
        message: "Sign-in code created. Share it with the user now: it won't be shown again.",
      });
    } catch (error) {
      console.log("admin issueSignInCode error", error.message);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Couldn't create a sign-in code" });
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
        : `Couldn't send the test email through ${result.target || mailTarget()}: ${result.error}. Check EMAIL_HOST, EMAIL_PORT, EMAIL_USER and EMAIL_PASS.`,
    });
  }
}

module.exports = new AdminController();
