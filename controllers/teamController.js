// Team management for the organisation's admin (Settings > Users & Roles),
// and the public invite links. Routes: routes/teamRoutes.js.
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const svc = require("../helpers/teamService");
const { resolveRole } = require("../helpers/teamAccess");

const { TeamError, PASSWORD_RULE, INVITE_PURPOSE, sha } = svc;
const Organization = () => mongoose.model("Organization");
const Users = () => mongoose.model("user");
const Members = () => mongoose.model("team_member");

const fail = (res, error, fallback = "Something went wrong.") => {
  if (error instanceof TeamError) {
    return res.status(error.status).json({ status: false, success: false, code: error.code, message: error.message });
  }
  console.error("team error:", error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, success: false, message: fallback });
};

// The organisation the request is about, if the signed-in admin owns it.
const ownedOrg = async (req, res) => {
  if (res.locals.member) throw new TeamError(403, "Only the organisation's admin can manage team members.");
  const orgId = req.query?.organization_id || req.query?.org_id || req.body?.organization_id || req.body?.org_id;
  if (!/^\d+$/.test(String(orgId || ""))) throw new TeamError(400, "Choose an organisation first.");
  const org = await Organization().findOne({ organization_id: Number(orgId), admin_id: res.locals.user_id });
  if (!org) throw new TeamError(403, "You do not have access to this organization.");
  return org;
};
const actorOf = (res) => ({ id: res.locals.user_id, email: res.user?.email || "", type: "owner" });

// The invite in a link, checked: signed, for this purpose, not used or replaced,
// not expired, and the organisation and role still exist.
const readInvite = async (token) => {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ""), process.env.JWT_SECRET);
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      throw new TeamError(400, "This invitation has expired. Ask your administrator to send a new one.", "INVITE_EXPIRED");
    }
    throw new TeamError(400, "This invitation link is invalid.", "INVITE_INVALID");
  }
  if (decoded.purpose !== INVITE_PURPOSE) throw new TeamError(400, "This invitation link is invalid.", "INVITE_INVALID");
  const member = mongoose.isValidObjectId(decoded.sub) ? await Members().findById(decoded.sub) : null;
  if (!member || member.status !== "invited" || !member.invite_hash || member.invite_hash !== sha(decoded.n)) {
    throw new TeamError(400, "This invitation has already been used or replaced. Ask your administrator for a new one.", "INVITE_USED");
  }
  if (member.invite_expires_at && new Date(member.invite_expires_at) < new Date()) {
    throw new TeamError(400, "This invitation has expired. Ask your administrator to send a new one.", "INVITE_EXPIRED");
  }
  const user = await Users().findById(member.user_id).select("email team_account team_accepted_at").lean();
  const org = await Organization().findOne({ organization_id: member.organization_id }).lean();
  const role = await resolveRole(member.organization_id, member.role_id);
  if (!user || !org || !role) throw new TeamError(400, "This invitation is no longer valid. Ask your administrator for a new one.", "INVITE_INVALID");
  return { decoded, member, user, org, role, needsPassword: Boolean(user.team_account && !user.team_accepted_at) };
};

class TeamController {
  // GET /team?organization_id=
  async overview(req, res) {
    try {
      const org = await ownedOrg(req, res);
      res.status(ST_CODES.OK).json({ status: true, data: await svc.overview(org) });
    } catch (error) {
      fail(res, error, "Couldn't load the team.");
    }
  }

  // GET /team/audit?organization_id=
  async audit(req, res) {
    try {
      const org = await ownedOrg(req, res);
      res.status(ST_CODES.OK).json({ status: true, data: await svc.auditFor(org.organization_id) });
    } catch (error) {
      fail(res, error, "Couldn't load the team history.");
    }
  }

  // POST /team/members { organization_id, name, email, role_id }
  async invite(req, res) {
    try {
      const org = await ownedOrg(req, res);
      const { member, email } = await svc.invite(org, actorOf(res), {
        name: req.body?.name,
        email: req.body?.email,
        roleId: req.body?.role_id,
      });
      const sent = email?.ok !== false;
      res.status(ST_CODES.CREATED).json({
        status: true,
        data: { _id: String(member._id) },
        email: { ok: sent, error: sent ? undefined : email?.error },
        message: sent
          ? "Invitation sent. The link works once, for 24 hours."
          : "Invitation saved, but the email couldn't be sent. Use Send again once email is working.",
      });
    } catch (error) {
      fail(res, error, "Couldn't send the invitation.");
    }
  }

  // PATCH /team/members/:id { organization_id, role_id?, status? }
  async updateMember(req, res) {
    try {
      const org = await ownedOrg(req, res);
      const member = await svc.updateMember(org, actorOf(res), req.params.id, {
        roleId: req.body?.role_id,
        status: req.body?.status,
      });
      res.status(ST_CODES.OK).json({ status: true, data: { _id: String(member._id), role_id: member.role_id, status: member.status }, message: "Team member updated" });
    } catch (error) {
      fail(res, error, "Couldn't update the team member.");
    }
  }

  // POST /team/members/:id/resend { organization_id }
  async resendInvite(req, res) {
    try {
      const org = await ownedOrg(req, res);
      const { email } = await svc.resendInvite(org, actorOf(res), req.params.id);
      const sent = email?.ok !== false;
      res.status(ST_CODES.OK).json({
        status: true,
        email: { ok: sent, error: sent ? undefined : email?.error },
        message: sent ? "A new invitation was sent. The old link no longer works." : "The invitation was saved, but the email couldn't be sent.",
      });
    } catch (error) {
      fail(res, error, "Couldn't send the invitation again.");
    }
  }

  // DELETE /team/members/:id?organization_id=
  async removeMember(req, res) {
    try {
      const org = await ownedOrg(req, res);
      await svc.removeMember(org, actorOf(res), req.params.id);
      res.status(ST_CODES.OK).json({ status: true, message: "Removed from the team" });
    } catch (error) {
      fail(res, error, "Couldn't remove the team member.");
    }
  }

  // POST /team/roles { organization_id, name, description, permissions }
  async createRole(req, res) {
    try {
      const org = await ownedOrg(req, res);
      const role = await svc.createRole(org, actorOf(res), req.body || {});
      res.status(ST_CODES.CREATED).json({ status: true, data: { id: String(role._id) }, message: "Role created" });
    } catch (error) {
      fail(res, error, "Couldn't create the role.");
    }
  }

  // PATCH /team/roles/:id { organization_id, name?, description?, permissions? }
  async updateRole(req, res) {
    try {
      const org = await ownedOrg(req, res);
      await svc.updateRole(org, actorOf(res), req.params.id, req.body || {});
      res.status(ST_CODES.OK).json({ status: true, message: "Role updated" });
    } catch (error) {
      fail(res, error, "Couldn't update the role.");
    }
  }

  // DELETE /team/roles/:id?organization_id=
  async deleteRole(req, res) {
    try {
      const org = await ownedOrg(req, res);
      await svc.deleteRole(org, actorOf(res), req.params.id);
      res.status(ST_CODES.OK).json({ status: true, message: "Role deleted" });
    } catch (error) {
      fail(res, error, "Couldn't delete the role.");
    }
  }

  // Public: GET /team/invite?token=  what the accept page shows.
  async getInvite(req, res) {
    try {
      const { member, user, org, role, needsPassword, decoded } = await readInvite(req.query?.token);
      res.status(ST_CODES.OK).json({
        status: true,
        data: {
          organization_name: org.org_name,
          email: user.email,
          name: member.name || "",
          role_name: role.name,
          needs_password: needsPassword,
          expires_at: new Date(decoded.exp * 1000),
        },
      });
    } catch (error) {
      fail(res, error, "Couldn't open the invitation.");
    }
  }

  // Public: POST /team/accept-invite { token, password? }  single use.
  async acceptInvite(req, res) {
    try {
      const token = req.body?.token;
      const invite = await readInvite(token);
      const { member, user, org, needsPassword, decoded } = invite;
      const password = String(req.body?.password || "");
      if (needsPassword && !PASSWORD_RULE.test(password)) {
        throw new TeamError(400, "Password must be at least 8 characters with an uppercase letter, a lowercase letter, a number and a special character.");
      }

      // Claim the invite first: only one request can win, so the link works once.
      const claimed = await Members().findOneAndUpdate(
        { _id: member._id, status: "invited", invite_hash: sha(decoded.n) },
        { $set: { status: "active", accepted_at: new Date() }, $unset: { invite_hash: 1, invite_expires_at: 1 } },
        { new: true }
      );
      if (!claimed) {
        throw new TeamError(400, "This invitation has already been used or replaced. Ask your administrator for a new one.", "INVITE_USED");
      }
      try {
        const update = { status: "active", team_accepted_at: new Date(), approved_at: new Date() };
        if (needsPassword) update.password = await bcrypt.hash(password, 10);
        await Users().updateOne({ _id: user._id }, { $set: update });
      } catch (error) {
        await Members().updateOne({ _id: member._id }, { $set: { status: "invited", invite_hash: sha(decoded.n), invite_expires_at: new Date(decoded.exp * 1000) }, $unset: { accepted_at: 1 } });
        throw error;
      }
      await svc.writeAudit(org, { id: user._id, email: user.email, type: "member" }, "invite_accepted", {
        userId: user._id,
        email: user.email,
        name: member.name,
        details: `Role: ${invite.role.name}`,
      });
      res.status(ST_CODES.OK).json({
        status: true,
        message: `You've joined ${org.org_name}. Sign in with ${user.email} to get started.`,
      });
    } catch (error) {
      fail(res, error, "Couldn't accept the invitation.");
    }
  }
}

module.exports = new TeamController();
