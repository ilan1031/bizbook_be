// The superadmin's view of every organisation's team: the switch, the member
// limit, members, roles, and invites (resend or cancel). Routes sit under
// /api/v1/admin in routes/adminRoutes.js (superadmin only).
const mongoose = require("mongoose");
const ST_CODES = require("../helpers/statusCodeHelpers");
const svc = require("../helpers/teamService");

const Organization = () => mongoose.model("Organization");
const isId = (id) => mongoose.isValidObjectId(String(id || ""));

const LIST_DEFAULT = 25;
const LIST_MAX = 100;
// A positive whole number from a query string, or the fallback.
const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : fallback;
};

const fail = (res, error, fallback) => {
  if (error instanceof svc.TeamError) {
    return res.status(error.status).json({ status: false, success: false, code: error.code, message: error.message });
  }
  console.error("admin team error:", error);
  return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, success: false, message: fallback });
};
const actorOf = (res) => ({ id: res.locals.user_id, email: res.user?.email || "", type: "superadmin" });

const orgById = async (organizationId) => {
  if (!/^\d+$/.test(String(organizationId || ""))) throw new svc.TeamError(400, "Invalid organisation id.");
  const org = await Organization().findOne({ organization_id: Number(organizationId) });
  if (!org) throw new svc.TeamError(404, "Organisation not found.");
  return org;
};

class TeamAdminController {
  // GET /admin/teams?page=1&limit=25: organisations with their owner and team,
  // newest first (organization_id is unique, so pages never overlap or skip).
  // Returns { data, total, page, limit, pages }.
  async listTeams(req, res) {
    try {
      const page = positiveInt(req.query.page, 1);
      const limit = Math.min(positiveInt(req.query.limit, LIST_DEFAULT), LIST_MAX);
      const total = await Organization().countDocuments({});
      const skip = (page - 1) * limit;
      const orgs = skip >= total ? [] : await Organization().find({}).sort({ organization_id: -1 }).skip(skip).limit(limit).lean();
      const data = await svc.summariesFor(orgs);
      res.status(ST_CODES.OK).json({ status: true, data, total, page, limit, pages: Math.ceil(total / limit) });
    } catch (error) {
      fail(res, error, "Couldn't load the teams.");
    }
  }

  // PATCH /admin/teams/:organizationId { team_users?: boolean, team_max_members?: number }
  async updateTeam(req, res) {
    try {
      const org = await orgById(req.params.organizationId);
      const body = req.body || {};
      if (body.team_users !== undefined) {
        if (typeof body.team_users !== "boolean") throw new svc.TeamError(400, "Team users must be on or off.");
        await svc.setTeamSwitch(org, actorOf(res), body.team_users);
      }
      if (body.team_max_members !== undefined) {
        await svc.setLimit(org, actorOf(res), body.team_max_members);
      }
      res.status(ST_CODES.OK).json({ status: true, message: "Team settings saved" });
    } catch (error) {
      fail(res, error, "Couldn't save the team settings.");
    }
  }

  // PATCH /admin/team-members/:id { role_id?, status? }
  async updateMember(req, res) {
    try {
      const member = isId(req.params.id) ? await mongoose.model("team_member").findById(req.params.id).lean() : null;
      if (!member) throw new svc.TeamError(404, "Team member not found.");
      const org = await orgById(member.organization_id);
      const saved = await svc.updateMember(org, actorOf(res), req.params.id, { roleId: req.body?.role_id, status: req.body?.status });
      res.status(ST_CODES.OK).json({ status: true, data: { _id: String(saved._id), role_id: saved.role_id, status: saved.status }, message: "Team member updated" });
    } catch (error) {
      fail(res, error, "Couldn't update the team member.");
    }
  }

  // POST /admin/team-members/:id/resend: resets a pending invite (new link, old one dead).
  async resendInvite(req, res) {
    try {
      const member = isId(req.params.id) ? await mongoose.model("team_member").findById(req.params.id).lean() : null;
      if (!member) throw new svc.TeamError(404, "Team member not found.");
      const org = await orgById(member.organization_id);
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

  // DELETE /admin/team-members/:id: removes a member, or cancels a pending invite.
  async removeMember(req, res) {
    try {
      const member = isId(req.params.id) ? await mongoose.model("team_member").findById(req.params.id).lean() : null;
      if (!member) throw new svc.TeamError(404, "Team member not found.");
      const org = await orgById(member.organization_id);
      await svc.removeMember(org, actorOf(res), req.params.id);
      res.status(ST_CODES.OK).json({ status: true, message: "Removed from the team" });
    } catch (error) {
      fail(res, error, "Couldn't remove the team member.");
    }
  }

  // GET /admin/teams/:organizationId/audit
  async audit(req, res) {
    try {
      const org = await orgById(req.params.organizationId);
      res.status(ST_CODES.OK).json({ status: true, data: await svc.auditFor(org.organization_id, 200) });
    } catch (error) {
      fail(res, error, "Couldn't load the team history.");
    }
  }
}

module.exports = new TeamAdminController();
