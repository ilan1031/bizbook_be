const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const usersCollection = mongoose.model("user");
const ClientCollection = mongoose.model("clients");
const OrgCollection = mongoose.model("Organization");
const { checkApiAccess, getClientIp } = require("../helpers/rbac");
const ContactCollection = mongoose.model("Contact");

// What a customer-portal token may call: the portal's quote endpoints.
const CLIENT_API = /^\/api\/v1\/clientestimates(\/|\?|$)/;

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization; // Extract token from header 'x-auth-token'
  if (!token) {
    return res
      .status(401)
      .json({ message: "No token provided, access denied.", success: false });
  }
  let userToken = token.split(" ")[1];

  if (!userToken) {
    return res
      .status(401)
      .json({ message: "No token provided, access denied.", success: false });
  }
  try {
    const decoded = jwt.verify(userToken, process.env.JWT_SECRET);
    let user;
    if (decoded.role === "client") {
      user = await ClientCollection.findOne({ _id: decoded.userId });
    } else {
      user = await usersCollection.findOne({ _id: decoded.userId });
    }
    if (user) {
      // Customer-portal clients may only use the portal's own endpoints, and
      // only while the business user who owns them is active and has the
      // Customer Portal switched on by the superadmin.
      if (decoded.role === "client") {
        if (!CLIENT_API.test(req.originalUrl)) {
          return res.status(403).json({ code: "FORBIDDEN", message: "Not available in the customer portal.", success: false });
        }
        const contact = await ContactCollection.findOne({ contact_id: user.client_id }, { admin_id: 1 }).lean();
        const owner = contact && (await usersCollection.findById(contact.admin_id, { role: 1, status: 1, permissions: 1 }).lean());
        const allowed =
          owner &&
          (owner.role === "superadmin" ||
            (owner.status === "active" && (owner.permissions?.customerPortal || []).includes("view")));
        if (!allowed) {
          return res.status(403).json({ code: "PORTAL_DISABLED", message: "The customer portal isn't available for this business.", success: false });
        }
      }

      // Access control for business users. Checked on every request, so
      // deactivating a user or removing one of their IPs takes effect
      // immediately.
      if (decoded.role !== "client" && user.role !== "superadmin") {
        if (user.status !== "active") {
          return res.status(403).json({
            code: user.status === "inactive" ? "ACCOUNT_INACTIVE" : "ACCOUNT_PENDING",
            message:
              user.status === "inactive"
                ? "Your account has been deactivated. Contact your administrator."
                : "Your account is waiting for administrator approval.",
            success: false,
          });
        }
        const ip = getClientIp(req);
        if (!(user.allowed_ips || []).some((entry) => entry.ip === ip)) {
          return res.status(403).json({
            code: "IP_NOT_ALLOWED",
            message: "This device's IP address isn't approved for your account. Please sign in again.",
            success: false,
          });
        }
        const denied = checkApiAccess(user, req.method, req.originalUrl);
        if (denied) {
          return res.status(403).json({ code: "FORBIDDEN", message: denied, success: false });
        }
      }

      // Tenant isolation: if this request references an organization
      // (query, body, or route param), make sure it actually belongs to
      // the authenticated user before letting the request through.
      // Without this, any logged-in user could read/write any other
      // company's data just by changing organization_id/org_id.
      if (decoded.role !== "client") {
        const orgId =
          req.query?.organization_id ||
          req.query?.org_id ||
          req.body?.organization_id ||
          req.body?.org_id ||
          req.params?.organization_id ||
          req.params?.org_id;

        if (orgId) {
          const org = await OrgCollection.findOne({
            organization_id: orgId,
            admin_id: decoded.userId,
          }).lean();
          if (!org) {
            return res.status(403).json({
              message: "You do not have access to this organization.",
              success: false,
            });
          }
        }
      }

      res.locals.user_id = decoded.userId;
      res.locals.role = decoded.role;
      res.locals.is_superadmin = user.role === "superadmin";
      res.user = user;
      next();
    } else {
      return res.status(401).json({
        message: "No token provided, cannot find user",
        success: false,
      });
    }
  } catch (error) {
    console.error("Token verification failed:", error);
    res
      .status(400)
      .json({ message: "Invalid or expired token.", success: false });
  }
};

module.exports = authMiddleware;
