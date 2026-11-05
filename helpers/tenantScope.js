// Ownership checks for routes that only carry a record id in the path (no
// organization_id for the auth middleware to check). A record belongs to the
// caller when its organisation is one of the caller's organisations.
const mongoose = require("mongoose");

const isObjectId = (v) => /^[0-9a-fA-F]{24}$/.test(String(v || ""));

const ownsOrg = async (organizationId, userId) => {
  if (organizationId === undefined || organizationId === null || organizationId === "" || !userId) return false;
  const n = Number(organizationId);
  if (!Number.isFinite(n)) return false;
  const org = await mongoose.model("Organization").findOne({ organization_id: n, admin_id: userId }, { _id: 1 }).lean();
  return Boolean(org);
};

// The customer / vendor `id` (contact_id or Mongo _id) if the caller owns its
// organisation, else null.
const ownedContact = async (id, userId, projection = undefined) => {
  if (!id || !userId) return null;
  const Contact = mongoose.model("Contact");
  const query = isObjectId(id) ? { $or: [{ contact_id: String(id) }, { _id: new mongoose.Types.ObjectId(String(id)) }] } : { contact_id: String(id) };
  const contact = await Contact.findOne(query, projection ? { ...projection, organization_id: 1, admin_id: 1, contact_id: 1 } : undefined).lean();
  if (!contact) return null;
  if (contact.organization_id !== undefined && contact.organization_id !== null && contact.organization_id !== "") {
    return (await ownsOrg(contact.organization_id, userId)) ? contact : null;
  }
  return String(contact.admin_id || "") === String(userId) ? contact : null;
};

// A contact person, if it belongs to one of the caller's customers / vendors.
const ownedContactPerson = async (contactPersonId, userId) => {
  if (!contactPersonId || !userId) return null;
  const person = await mongoose.model("contactDetails").findOne({ contact_person_id: String(contactPersonId) }).lean();
  if (!person) return null;
  if (person.contact_id) return (await ownedContact(person.contact_id, userId, { _id: 1 })) ? person : null;
  if (person.organization_id) return (await ownsOrg(person.organization_id, userId)) ? person : null;
  return String(person.admin_id || "") === String(userId) ? person : null;
};

module.exports = { ownsOrg, ownedContact, ownedContactPerson };
