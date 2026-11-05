// Team operations: invite, change, disable, remove, resend, roles, audit and
// the team overview. Called by controllers/teamController.js (the org admin)
// and controllers/teamAdminController.js (the superadmin). Every function takes
// the organisation document, so callers decide who may act; errors are
// TeamError with an HTTP status and a message that can be shown as is.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { PRESETS, presetRole, ownerCeiling, checkRolePermissions, GRID, TEAM_SWITCH } = require("./teamRoles");
const { resolveRole } = require("./teamAccess");
const teamEmails = require("./teamEmails");

const DEFAULT_LIMIT = 5;
const INVITE_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?=.{8,})/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_PURPOSE = "team-invite";

class TeamError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (message) => new TeamError(400, message);
const notFound = (message = "Team member not found.") => new TeamError(404, message);

const Users = () => mongoose.model("user");
const Organization = () => mongoose.model("Organization");
const Members = () => mongoose.model("team_member");
const Roles = () => mongoose.model("team_role");
const Audit = () => mongoose.model("team_audit");

const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const limitOf = (org) => (Number.isInteger(org.team_max_members) ? org.team_max_members : DEFAULT_LIMIT);
const isId = (id) => mongoose.isValidObjectId(String(id || ""));

const ownerOf = (org) => Users().findById(org.admin_id).select("-password -login_otp -allowed_ips").lean();

const writeAudit = (org, actor, action, { userId, email = "", name = "", details = "" } = {}) =>
  Audit().create({
    organization_id: org.organization_id,
    actor_id: isId(actor.id) ? actor.id : undefined,
    actor_email: actor.email || "",
    actor_type: actor.type,
    action,
    target_user_id: userId || undefined,
    target_email: email,
    target_name: name,
    details,
  });

const normalizeName = (raw) => {
  const name = String(raw ?? "").trim();
  if (!name) throw bad("Enter the person's name.");
  if (name.length > 80) throw bad("The name can be at most 80 characters.");
  return name;
};
const normalizeEmail = (raw) => {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) throw bad("Enter the person's email address.");
  if (email.length > 254 || !EMAIL_RE.test(email)) throw bad("Please enter a valid email address.");
  return email;
};

// Creates a new invite link (replacing any earlier one) and emails it.
// Returns the mailer result; a failed send leaves the invite in place, so the
// admin can resend it.
const issueInvite = async (member, org, { user, roleName, isNew }) => {
  const nonce = crypto.randomBytes(24).toString("hex");
  member.invite_hash = sha(nonce);
  member.invite_expires_at = new Date(Date.now() + INVITE_MS);
  member.invited_at = new Date();
  await member.save();
  const token = jwt.sign({ sub: String(member._id), purpose: INVITE_PURPOSE, n: nonce }, process.env.JWT_SECRET, {
    expiresIn: "24h",
  });
  return teamEmails.sendTeamInvite({
    to: user.email,
    name: member.name || user.email,
    orgName: org.org_name || "BizBooks",
    orgEmail: org.email,
    roleName,
    token,
    needsPassword: isNew,
  });
};

const seatsUsed = (org) => Members().countDocuments({ organization_id: org.organization_id, status: { $in: ["invited", "active"] } });

// Adds a person to the team. A new email creates the account (no password
// yet; the invite sets it). An existing account is linked if it is free to join.
const invite = async (org, actor, { name, email, roleId }) => {
  const cleanName = normalizeName(name);
  const cleanEmail = normalizeEmail(email);
  const role = await resolveRole(org.organization_id, roleId);
  if (!role) throw bad("Choose a role for this person.");

  const owner = await ownerOf(org);
  if (owner && owner.email === cleanEmail) throw bad("That's your own email address. You're already the admin of this organisation.");
  const limit = limitOf(org);
  const used = await seatsUsed(org);
  if (used >= limit) {
    throw bad(`Your team is full (${limit} member${limit === 1 ? "" : "s"}). Remove someone, or ask the superadmin to raise the limit.`);
  }

  let user = await Users().findOne({ email: cleanEmail });
  let isNew = false;
  if (user) {
    if (user.role === "superadmin") throw bad("This email belongs to the superadmin account and can't join a team.");
    if (await Organization().exists({ admin_id: user._id })) {
      throw bad("This person already runs an organisation of their own on BizBooks, so they can't join another team.");
    }
    const existing = await Members().findOne({ user_id: user._id }).lean();
    if (existing) {
      throw bad(
        existing.organization_id === org.organization_id
          ? "This person is already on your team."
          : "This person already belongs to another organisation's team. A person can belong to one organisation only."
      );
    }
    if (user.status !== "active") {
      throw bad("This account isn't approved yet. The superadmin needs to approve it before it can join a team.");
    }
  } else {
    try {
      user = await new (Users())({
        email: cleanEmail,
        company_name: cleanName,
        password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
        role: "user",
        status: "active",
        approved_at: new Date(),
        permissions: {},
        team_account: true,
        agreement_status: false,
      }).save();
      isNew = true;
    } catch (error) {
      if (error?.code === 11000) throw bad("An account with this email already exists.");
      if (error?.name === "ValidationError") throw bad(Object.values(error.errors || {})[0]?.message || "Please check the details.");
      throw error;
    }
  }

  let member;
  try {
    member = await new (Members())({
      organization_id: org.organization_id,
      owner_id: org.admin_id,
      user_id: user._id,
      name: cleanName,
      role_id: role.id,
      status: "invited",
      invited_by: isId(actor.id) ? actor.id : undefined,
      invited_at: new Date(),
    }).save();
  } catch (error) {
    if (isNew) await Users().deleteOne({ _id: user._id, team_account: true, team_accepted_at: null }).catch(() => {});
    if (error?.code === 11000) throw bad("This person already belongs to a team.");
    throw error;
  }

  const email_result = await issueInvite(member, org, { user, roleName: role.name, isNew });
  await writeAudit(org, actor, "member_invited", { userId: user._id, email: cleanEmail, name: cleanName, details: `Role: ${role.name}` });
  return { member, email: email_result };
};

const findMember = async (org, memberId) => {
  if (!isId(memberId)) throw notFound();
  const member = await Members().findOne({ _id: memberId, organization_id: org.organization_id });
  if (!member) throw notFound();
  return member;
};

// Changes a member's role and/or status (active or disabled).
const updateMember = async (org, actor, memberId, { roleId, status } = {}) => {
  const member = await findMember(org, memberId);
  const user = await Users().findById(member.user_id).select("email").lean();
  const who = { userId: member.user_id, email: user?.email || "", name: member.name };

  if (roleId !== undefined) {
    const role = await resolveRole(org.organization_id, roleId);
    if (!role) throw bad("Choose a role for this person.");
    if (member.role_id !== role.id) {
      const before = (await resolveRole(org.organization_id, member.role_id))?.name || "a removed role";
      member.role_id = role.id;
      await writeAudit(org, actor, "role_changed", { ...who, details: `${before} → ${role.name}` });
    }
  }
  if (status !== undefined && status !== member.status) {
    if (status === "invited") throw bad("An invitation can't be turned back into a pending invite. Resend it instead.");
    if (member.status === "invited") throw bad("This invitation hasn't been accepted yet. Resend it or cancel it.");
    if (status === "disabled") {
      member.status = "disabled";
      member.disabled_at = new Date();
      await writeAudit(org, actor, "member_disabled", who);
    } else if (status === "active") {
      member.status = "active";
      member.disabled_at = undefined;
      await writeAudit(org, actor, "member_enabled", who);
    } else {
      throw bad("Invalid status.");
    }
  }
  await member.save();
  return member;
};

// Sends a fresh invite to a pending member; the previous link stops working.
const resendInvite = async (org, actor, memberId) => {
  const member = await findMember(org, memberId);
  if (member.status !== "invited") throw bad("Only pending invitations can be sent again.");
  const user = await Users().findById(member.user_id).lean();
  const role = await resolveRole(org.organization_id, member.role_id);
  if (!user) throw notFound();
  const email = await issueInvite(member, org, { user, roleName: role?.name || "Team member", isNew: Boolean(user.team_account && !user.team_accepted_at) });
  await writeAudit(org, actor, "invite_resent", { userId: user._id, email: user.email, name: member.name });
  return { member, email };
};

// Removes a person from the team. A pending invite is cancelled (and an
// account made only for it is deleted); an active member's sessions end.
const removeMember = async (org, actor, memberId) => {
  const member = await findMember(org, memberId);
  const user = await Users().findById(member.user_id).select("email team_account team_accepted_at").lean();
  await Members().deleteOne({ _id: member._id });
  const who = { userId: member.user_id, email: user?.email || "", name: member.name };
  if (member.status === "invited") {
    if (user?.team_account && !user.team_accepted_at) await Users().deleteOne({ _id: user._id, team_account: true, team_accepted_at: null });
    await writeAudit(org, actor, "invite_cancelled", who);
  } else {
    await Users().updateOne({ _id: member.user_id }, { $set: { team_session_cutoff: new Date() } });
    await writeAudit(org, actor, "member_removed", who);
  }
};

// Roles -------------------------------------------------------------------

const presetNames = () => PRESETS.map((p) => p.name.toLowerCase());

const createRole = async (org, actor, { name, description, permissions }) => {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) throw bad("Enter a name for the role.");
  if (cleanName.length > 60) throw bad("The role name can be at most 60 characters.");
  if (presetNames().includes(cleanName.toLowerCase())) throw bad(`"${cleanName}" is the name of a built-in role. Choose another name.`);
  const cleanDescription = String(description ?? "").trim().slice(0, 200);
  const checked = checkRolePermissions(permissions, ownerCeiling(await ownerOf(org)));
  if (checked.error) throw bad(checked.error);
  try {
    const role = await Roles().create({
      organization_id: org.organization_id,
      name: cleanName,
      name_key: cleanName.toLowerCase(),
      description: cleanDescription,
      permissions: checked.permissions,
      created_by: isId(actor.id) ? actor.id : undefined,
    });
    await writeAudit(org, actor, "role_created", { details: cleanName });
    return role;
  } catch (error) {
    if (error?.code === 11000) throw bad("A role with this name already exists.");
    throw error;
  }
};

const findRole = async (org, roleId) => {
  if (!isId(roleId)) throw notFound("Role not found.");
  const role = await Roles().findOne({ _id: roleId, organization_id: org.organization_id });
  if (!role) throw notFound("Role not found.");
  return role;
};

const updateRole = async (org, actor, roleId, { name, description, permissions }) => {
  const role = await findRole(org, roleId);
  if (name !== undefined) {
    const cleanName = String(name ?? "").trim();
    if (!cleanName) throw bad("Enter a name for the role.");
    if (cleanName.length > 60) throw bad("The role name can be at most 60 characters.");
    if (presetNames().includes(cleanName.toLowerCase())) throw bad(`"${cleanName}" is the name of a built-in role. Choose another name.`);
    role.name = cleanName;
    role.name_key = cleanName.toLowerCase();
  }
  if (description !== undefined) role.description = String(description ?? "").trim().slice(0, 200);
  if (permissions !== undefined) {
    const checked = checkRolePermissions(permissions, ownerCeiling(await ownerOf(org)));
    if (checked.error) throw bad(checked.error);
    role.permissions = checked.permissions;
    role.markModified("permissions");
  }
  try {
    await role.save();
  } catch (error) {
    if (error?.code === 11000) throw bad("A role with this name already exists.");
    throw error;
  }
  await writeAudit(org, actor, "role_updated", { details: role.name });
  return role;
};

const deleteRole = async (org, actor, roleId) => {
  const role = await findRole(org, roleId);
  const using = await Members().countDocuments({ organization_id: org.organization_id, role_id: String(role._id) });
  if (using) throw bad(`${using} team member${using === 1 ? " still has" : "s still have"} this role. Give ${using === 1 ? "that person" : "them"} another role first.`);
  await Roles().deleteOne({ _id: role._id });
  await writeAudit(org, actor, "role_deleted", { details: role.name });
};

// The switch and the limit (superadmin only; the callers check that).
const setTeamSwitch = async (org, actor, on) => {
  const owner = await Users().findById(org.admin_id).select("permissions").lean();
  if (!owner) throw notFound("The organisation's admin account wasn't found.");
  const permissions = { ...(owner.permissions || {}) };
  if (on) permissions[TEAM_SWITCH] = ["view"];
  else delete permissions[TEAM_SWITCH];
  await Users().updateOne({ _id: owner._id }, { $set: { permissions } });
  await writeAudit(org, actor, "switch_changed", { details: on ? "Team users switched on" : "Team users switched off" });
};

const setLimit = async (org, actor, max) => {
  // Only a real number or a numeric string counts: null, "" and true would
  // otherwise turn into 0 (which blocks every invite) without a warning.
  const given = typeof max === "number" || (typeof max === "string" && max.trim() !== "");
  const n = given ? Number(max) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 500) {
    throw bad("The member limit must be a whole number from 0 to 500. It can't be empty.");
  }
  const before = limitOf(org);
  await Organization().updateOne({ _id: org._id }, { $set: { team_max_members: n } });
  org.team_max_members = n;
  await writeAudit(org, actor, "limit_changed", { details: `${before} → ${n}` });
};

// Reads ------------------------------------------------------------------------

const memberView = (m, emails, roles) => {
  const role = roles.get(m.role_id);
  const expired = m.status === "invited" && m.invite_expires_at && new Date(m.invite_expires_at) < new Date();
  return {
    _id: String(m._id),
    user_id: String(m.user_id),
    name: m.name || "",
    email: emails.get(String(m.user_id)) || "",
    role_id: m.role_id,
    role_name: role?.name || "Role removed",
    status: m.status,
    invited_at: m.invited_at,
    invite_expires_at: m.invite_expires_at,
    invite_expired: Boolean(expired),
    accepted_at: m.accepted_at,
    disabled_at: m.disabled_at,
  };
};

// Every role an organisation can give: the presets, then its custom roles.
const rolesFor = async (organizationId) => {
  const custom = await Roles().find({ organization_id: organizationId }).sort({ name: 1 }).lean();
  return [
    ...PRESETS.map((p) => ({ id: p.key, name: p.name, description: p.description, preset: true, permissions: presetRole(p.key).permissions })),
    ...custom.map((r) => ({ id: String(r._id), name: r.name, description: r.description || "", preset: false, permissions: r.permissions || {} })),
  ];
};

// The team of one organisation, as the admin's screen shows it.
const overview = async (org) => {
  const owner = await ownerOf(org);
  const members = await Members().find({ organization_id: org.organization_id }).sort({ createdAt: 1 }).lean();
  const emailRows = await Users().find({ _id: { $in: members.map((m) => m.user_id) } }).select("email").lean();
  const emails = new Map(emailRows.map((u) => [String(u._id), u.email]));
  const roles = await rolesFor(org.organization_id);
  const roleMap = new Map(roles.map((r) => [r.id, r]));
  const used = members.filter((m) => m.status !== "disabled").length;
  return {
    organization: { organization_id: org.organization_id, name: org.org_name },
    limit: limitOf(org),
    seats_used: used,
    members: members.map((m) => memberView(m, emails, roleMap)),
    roles: roles.map((r) => ({ ...r, members: members.filter((m) => m.role_id === r.id).length })),
    grid: GRID.map((p) => ({ key: p.key, label: p.label, group: p.group, actions: [...p.actions] })),
    ceiling: ownerCeiling(owner),
    team_switch: Boolean(owner && (owner.role === "superadmin" || (owner.permissions || {})[TEAM_SWITCH])),
  };
};

// The superadmin's list: the same fields as overview() (the list leaves out
// the grid and ceiling), for many organisations at once. Each collection is
// read with one batched query (`$in`), not one query per organisation.
const summariesFor = async (orgs) => {
  if (orgs.length === 0) return [];
  const orgIds = orgs.map((o) => o.organization_id);
  const ownerIds = orgs.map((o) => o.admin_id).filter(Boolean);
  const [owners, members, customRoles] = await Promise.all([
    Users().find({ _id: { $in: ownerIds } }).select("-password -login_otp -allowed_ips").lean(),
    Members().find({ organization_id: { $in: orgIds } }).sort({ createdAt: 1 }).lean(),
    Roles().find({ organization_id: { $in: orgIds } }).sort({ name: 1 }).lean(),
  ]);
  const emailRows = await Users().find({ _id: { $in: members.map((m) => m.user_id) } }).select("email").lean();
  const emails = new Map(emailRows.map((u) => [String(u._id), u.email]));
  const ownerById = new Map(owners.map((u) => [String(u._id), u]));
  const membersByOrg = new Map();
  for (const m of members) {
    if (!membersByOrg.has(m.organization_id)) membersByOrg.set(m.organization_id, []);
    membersByOrg.get(m.organization_id).push(m);
  }
  const rolesByOrg = new Map();
  for (const r of customRoles) {
    if (!rolesByOrg.has(r.organization_id)) rolesByOrg.set(r.organization_id, []);
    rolesByOrg.get(r.organization_id).push(r);
  }
  const presets = PRESETS.map((p) => ({ id: p.key, name: p.name, description: p.description, preset: true, permissions: presetRole(p.key).permissions }));

  return orgs.map((org) => {
    const owner = ownerById.get(String(org.admin_id)) || null;
    const orgMembers = membersByOrg.get(org.organization_id) || [];
    const roles = [
      ...presets,
      ...(rolesByOrg.get(org.organization_id) || []).map((r) => ({ id: String(r._id), name: r.name, description: r.description || "", preset: false, permissions: r.permissions || {} })),
    ];
    const roleMap = new Map(roles.map((r) => [r.id, r]));
    return {
      _id: String(org._id),
      organization_id: org.organization_id,
      org_name: org.org_name,
      owner: owner ? { _id: String(owner._id), email: owner.email, status: owner.status, role: owner.role } : null,
      team_switch: Boolean(owner && (owner.role === "superadmin" || (owner.permissions || {})[TEAM_SWITCH])),
      limit: limitOf(org),
      seats_used: orgMembers.filter((m) => m.status !== "disabled").length,
      members: orgMembers.map((m) => memberView(m, emails, roleMap)),
      roles: roles.map((r) => ({ ...r, members: orgMembers.filter((m) => m.role_id === r.id).length })),
    };
  });
};

const auditFor = async (organizationId, limit = 100) => {
  const rows = await Audit().find({ organization_id: organizationId }).sort({ created_at: -1 }).limit(limit).lean();
  return rows.map((r) => ({
    _id: String(r._id),
    action: r.action,
    actor: r.actor_email,
    actor_type: r.actor_type,
    target: r.target_email || "",
    target_name: r.target_name || "",
    details: r.details || "",
    at: r.created_at,
  }));
};

module.exports = {
  TeamError,
  DEFAULT_LIMIT,
  invite,
  updateMember,
  resendInvite,
  removeMember,
  createRole,
  updateRole,
  deleteRole,
  setTeamSwitch,
  setLimit,
  overview,
  summariesFor,
  auditFor,
  ownerOf,
  limitOf,
  rolesFor,
  memberView,
  sha,
  PASSWORD_RULE,
  INVITE_PURPOSE,
  Members,
  Users,
  writeAudit,
};
