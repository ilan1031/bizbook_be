const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const usersCollection = mongoose.model("user");
const ClientCollection = mongoose.model("clients");
const OrgCollection = mongoose.model("Organization");
const { checkApiAccess, classifyRequest, getClientIp } = require("../helpers/rbac");
const { deviceIdOf, findDevice } = require("../helpers/devices");
const { checkCreateLimit, recordCreate, checkOrgLimit } = require("../helpers/usageLimits");
const { isInternal } = require("../helpers/internalCall");
const ContactCollection = mongoose.model("Contact");
const teamAccess = require("../helpers/teamAccess");

// What a customer-portal token may call: the portal's quote endpoints, the
// token check, changing their password, and reading their own contact record.
const CLIENT_API = /^\/api\/v1\/(clientestimates(\/|\?|$)|verify-token(\?|$)|client\/change-password$)/;
const CLIENT_CONTACT = /^\/api\/v1\/contact\/([^/?]+)(\?|$)/;
const clientMayCall = (req, client) => {
  if (CLIENT_API.test(req.originalUrl)) return true;
  const own = req.method === "GET" && req.originalUrl.match(CLIENT_CONTACT);
  return Boolean(own && decodeURIComponent(own[1]) === String(client.client_id));
};

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
  // Only a bad/expired token is an ended session (401). Anything else that
  // goes wrong below is a server or input problem, and must not sign the
  // user out.
  let decoded;
  try {
    decoded = jwt.verify(userToken, process.env.JWT_SECRET);
  } catch (error) {
    return res
      .status(401)
      .json({ code: "SESSION_EXPIRED", message: "Invalid or expired token.", success: false });
  }
  try {
    let user;
    if (decoded.role === "client") {
      user = await ClientCollection.findOne({ _id: decoded.userId });
    } else {
      user = await usersCollection.findOne({ _id: decoded.userId });
    }
    // Tokens issued before the password was last changed no longer work.
    if (
      user &&
      decoded.role !== "client" &&
      user.password_changed_at &&
      (decoded.iat || 0) < Math.floor(new Date(user.password_changed_at).getTime() / 1000)
    ) {
      return res.status(401).json({
        code: "PASSWORD_CHANGED",
        message: "Your password was changed. Please sign in again.",
        success: false,
      });
    }
    // Removed from a team: the sessions they had before the removal end. Sign-in
    // tokens carry their issue time in ms (iat_ms); older ones only have iat
    // (whole seconds), so they count as issued at the start of that second and
    // end if that second is the removal's or earlier.
    if (
      user &&
      decoded.role !== "client" &&
      user.team_session_cutoff &&
      (Number.isFinite(decoded.iat_ms) ? decoded.iat_ms : (decoded.iat || 0) * 1000) < new Date(user.team_session_cutoff).getTime()
    ) {
      return res.status(401).json({
        code: "SESSION_EXPIRED",
        message: "You have been removed from your organisation's team.",
        success: false,
      });
    }
    // Set for a team member: their organisation's admin account (acting), and the membership (member).
    let acting = null;
    let member = null;
    if (user) {
      // Customer-portal clients may only use the portal's own endpoints, and
      // only while the business user who owns them is active and has the
      // Customer Portal switched on by the superadmin.
      if (decoded.role === "client") {
        if (!clientMayCall(req, user)) {
          return res.status(403).json({ code: "FORBIDDEN", message: "Not available in the customer portal.", success: false });
        }
        const contact = await ContactCollection.findOne(
          { contact_id: user.client_id, deleted_at: null },
          { admin_id: 1, organization_id: 1, contact_id: 1 }
        ).lean();
        const owner = contact && (await usersCollection.findById(contact.admin_id, { role: 1, status: 1, permissions: 1 }).lean());
        const allowed =
          owner &&
          (owner.role === "superadmin" ||
            (owner.status === "active" && (owner.permissions?.customerPortal || []).includes("view")));
        if (!allowed) {
          return res.status(403).json({ code: "PORTAL_DISABLED", message: "The customer portal isn't available for this business.", success: false });
        }
        // A portal login is scoped to its own customer and that customer's
        // organisation: naming any other organisation or customer is refused,
        // and the portal handlers read both from res.locals.portal (never
        // from the request).
        const portal = { customer_id: String(contact.contact_id), organization_id: String(contact.organization_id) };
        const askedOrg = req.query?.organization_id || req.query?.org_id || req.body?.organization_id || req.body?.org_id;
        const askedCustomer = req.query?.customer_id || req.body?.customer_id;
        if ((askedOrg && String(askedOrg) !== portal.organization_id) || (askedCustomer && String(askedCustomer) !== portal.customer_id)) {
          return res.status(403).json({ code: "FORBIDDEN", message: "You can only see your own documents.", success: false });
        }
        res.locals.portal = portal;
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
        const device = findDevice(user, req);
        if (device && !device.device_id && deviceIdOf(req)) {
          // An entry saved before devices had ids: it now belongs to this browser.
          await usersCollection.updateOne(
            { _id: user._id, "allowed_ips._id": device._id },
            { $set: { "allowed_ips.$.device_id": deviceIdOf(req), "allowed_ips.$.ip": getClientIp(req) } }
          ).catch(() => {});
        }
        // The device check is about the person; the backend's own calls
        // (made on their behalf, with their token) skip it.
        if (!isInternal(req) && !device) {
          return res.status(403).json({
            code: "IP_NOT_ALLOWED",
            message: "This device's IP address isn't approved for your account. Please sign in again.",
            success: false,
          });
        }
        // A team member is checked against their role, within what the org
        // admin has, for the organisation they belong to (helpers/teamAccess.js).
        const membership = await teamAccess.membershipOf(user._id);
        if (membership) {
          const ctx = await teamAccess.memberContext(req, membership);
          if (ctx.error) {
            return res.status(ctx.error.status).json({ code: ctx.error.code, message: ctx.error.message, success: false });
          }
          acting = ctx.acting;
          member = ctx.member;
        } else {
          const denied = checkApiAccess(user, req.method, req.originalUrl);
          if (denied) {
            return res.status(403).json({ code: "FORBIDDEN", message: denied, success: false });
          }
        }

        // Create limits set by the superadmin (a member's records count against
        // the organisation admin's limits). The customer / vendor / item
        // imports count their rows themselves (recordImportController).
        const billed = acting || user;
        // The backend's own follow-up calls are part of a request already counted.
        const kind = req.method !== "GET" && !isInternal(req) && classifyRequest(req.method, req.originalUrl);
        if (kind && kind.action === "create" && !/^\/api\/v1\/import\/(customers|vendors|items|accounts)(\?|$)/.test(req.originalUrl)) {
          const over = await checkCreateLimit(billed);
          if (over) return res.status(429).json({ ...over, success: false });
          res.on("finish", () => {
            if (res.statusCode < 400) recordCreate(billed._id, kind.page).catch(() => {});
          });
        }
        if (req.method === "POST" && /^\/api\/v1\/org\/create-organisation/.test(req.originalUrl)) {
          const over = await checkOrgLimit(user);
          if (over) return res.status(429).json({ ...over, success: false });
        }
      }

      // Tenant isolation: if this request references an organization
      // (query, body, or route param), make sure it actually belongs to
      // the authenticated user before letting the request through.
      // Without this, any logged-in user could read/write any other
      // company's data just by changing organization_id/org_id.
      if (decoded.role !== "client" && !member) {
        const orgId =
          req.query?.organization_id ||
          req.query?.org_id ||
          req.body?.organization_id ||
          req.body?.org_id ||
          req.params?.organization_id ||
          req.params?.org_id;

        // Organisation ids are numbers; anything else (e.g. "undefined"
        // from a screen that lost it) is a bad request, not an expired session.
        if (orgId !== undefined && orgId !== null && orgId !== "" && !/^\d+$/.test(String(orgId))) {
          return res.status(400).json({
            message: "Invalid organization id.",
            success: false,
          });
        }
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

      // A team member's requests run as the organisation admin (the books are
      // the admin's, and every query is scoped to the organisation). actor_id
      // is the person who is actually signed in.
      res.locals.user_id = acting ? String(acting._id) : decoded.userId;
      res.locals.actor_id = String(user._id);
      // Who acted, for a record's audit (created_by_actor_*): the member's
      // name, or the signed-in account's email.
      res.locals.actor_name = (member && member.name) || user.email || "";
      res.locals.member = member;
      res.locals.role = decoded.role;
      res.locals.is_superadmin = user.role === "superadmin";
      res.user = acting || user;
      next();
    } else {
      return res.status(401).json({
        message: "No token provided, cannot find user",
        success: false,
      });
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    if (res.headersSent) return;
    if (error?.name === "CastError") {
      return res.status(400).json({ message: "Invalid request: " + (error.path || "id") + " has the wrong format.", success: false });
    }
    return res
      .status(500)
      .json({ message: "Something went wrong while checking your session. Please try again.", success: false });
  }
};

module.exports = authMiddleware;
