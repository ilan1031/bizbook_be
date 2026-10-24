// The portal invitation link carries a signed token (made when the invite
// email is sent). This reads it and says what the link can still be used for:
//   pending     - the customer hasn't set a password yet
//   registered  - they already did: send them to sign in
//   revoked     - the business withdrew the invitation
//   expired / invalid
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const secret = () => process.env.JWT_SECRET || "portal-invite-secret-key";

const readInvite = async (token) => {
  let claims;
  try {
    claims = jwt.verify(String(token || ""), secret());
  } catch (err) {
    return { state: err.name === "TokenExpiredError" ? "expired" : "invalid" };
  }
  if (!claims?.email || !claims.clientId || !claims.clientPersonId) return { state: "invalid" };

  const base = { claims, organization_id: String(claims.organization_id || ""), org_name: claims.org_name || "", email: claims.email };
  const Client = mongoose.model("clients");
  const existing = await Client.findOne({ email: claims.email, role: "client" }, { _id: 1, client_person_id: 1 }).lean();
  if (existing) return { ...base, state: "registered" };

  const person = await mongoose
    .model("contactDetails")
    .findOne({ contact_person_id: claims.clientPersonId, contact_id: claims.clientId }, { is_added_in_portal: 1, is_portal_invitation_accepted: 1, email: 1 })
    .lean();
  if (!person || !person.is_added_in_portal) return { ...base, state: "revoked" };
  if (person.is_portal_invitation_accepted) return { ...base, state: "registered" };
  return { ...base, state: "pending", person };
};

module.exports = { readInvite };
