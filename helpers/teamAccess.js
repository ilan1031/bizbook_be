// Team members: which organisation a signed-in person belongs to, the role
// they have there, and what they may do. Used by middleware/userMiddleware.js
// (every API call), the login and /user/me.
//
// A member acts inside the organisation's books as the org admin (the data
// is the admin's, and every query is already scoped by organization_id). What
// they may do is their role's permissions, never more than the admin has.
const mongoose = require("mongoose");
const { checkApiAccess, actionFor } = require("./rbac");
const { presetRole, intersect, ownerCeiling } = require("./teamRoles");

const TeamMember = () => mongoose.model("team_member");
const TeamRole = () => mongoose.model("team_role");
const Organization = () => mongoose.model("Organization");
const Users = () => mongoose.model("user");

// The membership row for this user, or null (owners and everyone else).
const membershipOf = (userId) => TeamMember().findOne({ user_id: userId }).lean();

// A role by id: a preset key, or the _id of a custom role in this organisation.
const resolveRole = async (organizationId, roleId) => {
  const preset = presetRole(roleId);
  if (preset) return { id: preset.key, name: preset.name, preset: true, permissions: preset.permissions };
  if (!mongoose.isValidObjectId(roleId)) return null;
  const role = await TeamRole().findOne({ _id: roleId, organization_id: Number(organizationId) }).lean();
  return role ? { id: String(role._id), name: role.name, preset: false, permissions: role.permissions || {} } : null;
};

// Why this membership can't be used at all (sign-in or any call), or null.
const membershipBlock = (membership) => {
  if (!membership) return null;
  if (membership.status === "invited") {
    return { status: 403, code: "INVITE_PENDING", message: "Accept your team invitation first. Check your email for the link." };
  }
  if (membership.status === "disabled") {
    return { status: 403, code: "MEMBER_DISABLED", message: "Your access to this organisation has been turned off. Contact your organisation's admin." };
  }
  return null;
};

const fail = (status, code, message) => ({ error: { status, code, message } });

// For a member's request: { acting, member } when it may go ahead, or
// { error: { status, code, message } }. `acting` is the org admin's account
// with the member's effective permissions, used in place of the user.
const memberContext = async (req, membership) => {
  const blocked = membershipBlock(membership);
  if (blocked) return { error: blocked };
  const path = req.originalUrl;
  if (/^\/api\/v1\/team(\/|\?|$)/.test(path)) {
    return fail(403, "FORBIDDEN", "Only the organisation's admin can manage team members.");
  }
  // Many reads here are POSTs (e.g. /org/get-organisation): actionFor tells them apart.
  const writesOrg = /^\/api\/v1\/(org|organization)(\/|\?|$)/.test(path) && actionFor(req.method, path.split("?")[0]) !== "view";
  if (writesOrg && !/^\/api\/v1\/org\/templates(\/|\?|$)/.test(path)) {
    return fail(403, "FORBIDDEN", "Only the organisation's admin can change the organisation's settings.");
  }

  const orgId = req.query?.organization_id || req.query?.org_id || req.body?.organization_id || req.body?.org_id || req.params?.organization_id || req.params?.org_id;
  if (orgId !== undefined && orgId !== null && orgId !== "" && !/^\d+$/.test(String(orgId))) {
    return fail(400, "BAD_REQUEST", "Invalid organization id.");
  }
  if (orgId && String(orgId) !== String(membership.organization_id)) {
    return fail(403, "FORBIDDEN", "You do not have access to this organization.");
  }

  const org = await Organization().findOne({ organization_id: membership.organization_id }).lean();
  const owner = org && (await Users().findById(org.admin_id).select("-password -login_otp -allowed_ips").lean());
  if (!owner || (owner.role !== "superadmin" && owner.status !== "active")) {
    return fail(403, "ORG_UNAVAILABLE", "This organisation's account isn't active. Contact the platform administrator.");
  }

  const role = await resolveRole(membership.organization_id, membership.role_id);
  if (!role) {
    return fail(403, "ROLE_REMOVED", "Your role has been removed. Ask your organisation's admin to give you a role.");
  }
  const permissions = intersect(role.permissions, ownerCeiling(owner));
  const denied = checkApiAccess({ role: "user", permissions }, req.method, path);
  if (denied) return fail(403, "FORBIDDEN", denied);

  const acting = {
    ...owner,
    role: "user",
    permissions,
    limits: owner.role === "superadmin" ? {} : owner.limits || {},
  };
  return {
    acting,
    member: {
      id: String(membership._id),
      user_id: String(membership.user_id),
      organization_id: String(membership.organization_id),
      org_name: org.org_name,
      role_id: role.id,
      role_name: role.name,
      name: membership.name || "",
      status: membership.status,
    },
  };
};

// Sign-in refusal for a team member, or null.
const loginBlockFor = async (userId) => membershipBlock(await membershipOf(userId));

module.exports = { membershipOf, membershipBlock, memberContext, resolveRole, loginBlockFor };
