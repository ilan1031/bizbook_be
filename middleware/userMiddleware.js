const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const usersCollection = mongoose.model("user");
const ClientCollection = mongoose.model("clients");
const OrgCollection = mongoose.model("Organization");

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
