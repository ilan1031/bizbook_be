// Customer-portal password reset: emails a link to /portal/reset-password.
// The link is signed, lasts 30 minutes and works once (it is tied to the
// current password hash, which the reset replaces).
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ST_CODES = require("../helpers/statusCodeHelpers");
const mailer = require("../helpers/mailer");

const ClientCollection = mongoose.model("clients");
const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?=.{8,})/;
const PURPOSE = "portal-reset";
const stamp = (hash) => String(hash || "").slice(-12);

const portalBase = () =>
  String(process.env.PORTAL_URL || process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");

class PortalPasswordController {
  // POST /client/forgot-password { email, organization_id }
  // Always answers the same way, so it can't be used to find accounts.
  async forgotPassword(req, res) {
    const generic = { message: "If that email has portal access, a reset link is on its way." };
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email) return res.status(ST_CODES.BAD_REQUEST).json({ message: "Email is required" });
      const client = await ClientCollection.findOne({ email, role: "client" });
      if (!client) return res.status(ST_CODES.OK).json(generic);

      const token = jwt.sign({ sub: String(client._id), purpose: PURPOSE, s: stamp(client.password) }, process.env.JWT_SECRET, {
        expiresIn: "30m",
      });
      const link = `${portalBase()}/portal/reset-password?token=${encodeURIComponent(token)}`;
      await module.exports.sendMail({
        to: client.email,
        subject: "Reset your customer portal password",
        text: `Use this link within 30 minutes to choose a new password:\n${link}\n\nIf you didn't ask for this, ignore this email.`,
        html: mailer.layout(
          "Reset your password",
          `<p>Use the button below within 30 minutes to choose a new password for the customer portal.</p>
<p><a href="${mailer.escapeHtml(link)}" style="display:inline-block;background:#1b7a2f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Choose a new password</a></p>
<p style="color:#666;font-size:13px">If you didn't ask for this, ignore this email.</p>`
        ),
      });
      return res.status(ST_CODES.OK).json(generic);
    } catch (error) {
      console.error("portal forgotPassword error:", error);
      return res.status(ST_CODES.OK).json(generic);
    }
  }

  // POST /client/reset-password { token, password }
  async resetPassword(req, res) {
    try {
      const { token, password } = req.body || {};
      let decoded;
      try {
        decoded = jwt.verify(String(token || ""), process.env.JWT_SECRET);
      } catch {
        return res.status(ST_CODES.BAD_REQUEST).json({ message: "This reset link is invalid or has expired." });
      }
      if (decoded.purpose !== PURPOSE) {
        return res.status(ST_CODES.BAD_REQUEST).json({ message: "This reset link is invalid or has expired." });
      }
      if (!PASSWORD_RULE.test(String(password || ""))) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          message: "Password must be at least 8 characters with an uppercase letter, a number and a special character.",
        });
      }
      const client = await ClientCollection.findById(decoded.sub);
      if (!client || stamp(client.password) !== decoded.s) {
        return res.status(ST_CODES.BAD_REQUEST).json({ message: "This reset link has already been used." });
      }
      client.password = await bcrypt.hash(String(password), 10);
      await client.save();
      return res.status(ST_CODES.OK).json({ message: "Password updated. You can sign in now." });
    } catch (error) {
      console.error("portal resetPassword error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Couldn't reset the password" });
    }
  }
}

module.exports = new PortalPasswordController();
// Indirection so tests can capture the email.
module.exports.sendMail = (...args) => mailer.sendMail(...args);
