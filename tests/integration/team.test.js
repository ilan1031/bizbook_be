// Team users and roles: the superadmin's switch and member limit, invites
// (email link, single use, resend), roles (presets and custom, never more than
// the org admin has), member access on every call, disable / remove / role
// change taking effect at once, cross-organisation isolation, and the audit log.
//
// Runs against its own throwaway database (TEST_DB_URL + "_team").
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_team$2");
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "1";
process.env.SUPERADMIN_EMAIL = "superadmin@test.local";
process.env.SUPERADMIN_PASSWORD = "Super@1234";
process.env.SUPERADMIN_MOBILE = "9000000001";
process.env.LOGIN_OTP_ENABLED = "false";
process.env.EMAIL_USER = "";
process.env.EMAIL_PASS = "";
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";
process.env.FRONTEND_URL = "http://localhost:3000";

const mongoose = require("mongoose");
const request = require("supertest");

// Mail is captured instead of sent: teamEmails calls mailer.sendMail at send time.
const mailer = require("../../helpers/mailer");
const sentMail = [];
mailer.sendMail = async (message) => {
  sentMail.push(message);
  return { ok: true, channel: "console" };
};

const realLog = console.log;
console.log = () => {};

let app;
const SA_IP = "203.0.113.60";
const call = (method, url, { token, ip = SA_IP, body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};
const login = (email, password, ip) => call("post", "/api/v1/user/user-login", { ip, body: { email, password } });

let saToken;
const people = {}; // key -> { token, id, ip, email, password }
let n = 0;
const ipFor = () => `10.60.0.${++n}`;

// An active account that has signed in once (so its IP is known).
const approvedUser = async (key, permissions = {}) => {
  const ip = ipFor();
  const email = `${key}@team.test`;
  const password = "User@1234";
  const reg = await call("post", "/api/v1/user/user-register", {
    ip,
    body: { companyName: `Co ${key}`, email, password, phoneNumber: `9876600${String(n).padStart(3, "0")}`, country: "India", state: "Tamil Nadu", agreeToTerms: true },
  });
  assert.equal(reg.status, 201, reg.text);
  const id = String((await mongoose.model("user").findOne({ email }).lean())._id);
  const a = await call("patch", `/api/v1/admin/users/${id}`, { token: saToken, body: { status: "active", permissions } });
  assert.equal(a.status, 200, a.text);
  const l = await login(email, password, ip);
  assert.equal(l.status, 200, l.text);
  people[key] = { token: l.body.token, id, ip, email, password };
  return people[key];
};

const createOrg = async (who, name) => {
  const o = await call("post", "/api/v1/org/create-organisation", {
    token: who.token,
    ip: who.ip,
    body: { organizationName: name, country: "India", state: "Tamil Nadu" },
  });
  assert.equal(o.status, 200, o.text);
  const org = String(o.body.data.organization_id);
  await call("put", `/api/v1/organization/${org}`, {
    token: who.token,
    ip: who.ip,
    body: { first_street: "12 Gandhi Road", city: "Chennai", zip: 600001, phone: 9876543210, gst_in: "33AAACB2902M1Z0", email: `accounts+${org}@team.test` },
  });
  return org;
};

// The link in the most recent invite email to `to`.
const inviteToken = (to) => {
  const mail = [...sentMail].reverse().find((m) => m.to === to && /invited you/.test(m.subject));
  assert.ok(mail, `no invite email to ${to}`);
  const match = mail.text.match(/token=([^\s]+)/);
  assert.ok(match, "invite email has no link");
  return decodeURIComponent(match[1]);
};

const bothPages = { invoices: ["view", "create", "edit", "delete"], customers: ["view", "create", "edit", "delete"], items: ["view", "create", "edit", "delete"], home: ["view"] };
const OWNER_PERMS = { ...bothPages, teamUsers: ["view"], bills: ["view", "create", "edit", "delete"] };

// Invite and accept in one go; returns the member's login.
const addMember = async (owner, org, { name, email, role }) => {
  const inv = await call("post", "/api/v1/team/members", { token: owner.token, ip: owner.ip, body: { organization_id: org, name, email, role_id: role } });
  assert.equal(inv.status, 201, inv.text);
  const token = inviteToken(email);
  const info = await call("get", `/api/v1/team/invite?token=${encodeURIComponent(token)}`);
  assert.equal(info.status, 200, info.text);
  const acc = await call("post", "/api/v1/team/accept-invite", { body: { token, password: "Member@1234" } });
  assert.equal(acc.status, 200, acc.text);
  const ip = ipFor();
  const l = await login(email, "Member@1234", ip);
  assert.equal(l.status, 200, l.text);
  const user = await mongoose.model("user").findOne({ email }).lean();
  const membership = await mongoose.model("team_member").findOne({ user_id: user._id }).lean();
  return { token: l.body.token, ip, email, id: String(user._id), memberId: String(membership._id) };
};

test.before(async () => {
  const conn = await mongoose.createConnection(process.env.DB_Coll).asPromise();
  await conn.dropDatabase();
  await conn.close();
  app = require("../../app");
  for (let i = 0; i < 100 && mongoose.connection.readyState !== 1; i++) await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 50; i++) {
    if (await mongoose.model("user").exists({ role: "superadmin" })) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const res = await login("superadmin@test.local", "Super@1234", SA_IP);
  assert.equal(res.status, 200, res.text);
  saToken = res.body.token;
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("team: the org admin needs the superadmin's Team users switch", async () => {
  const owner = await approvedUser("own1", { ...bothPages });
  const org = await createOrg(owner, "Switch Books");
  owner.org = org;
  const off = await call("get", `/api/v1/team?organization_id=${org}`, { token: owner.token, ip: owner.ip });
  assert.equal(off.status, 403, off.text);
  assert.equal(off.body.message, "Team users isn't switched on for your account");
  assert.equal(off.body.code, "FORBIDDEN");

  // Switch on through the Users & Access permissions (the feature matrix).
  const on = await call("patch", `/api/v1/admin/users/${owner.id}`, { token: saToken, body: { permissions: OWNER_PERMS } });
  assert.equal(on.status, 200, on.text);
  const ok = await call("get", `/api/v1/team?organization_id=${org}`, { token: owner.token, ip: owner.ip });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.limit, 5);
  assert.equal(ok.body.data.team_switch, true);
  assert.ok(ok.body.data.roles.some((r) => r.id === "sales" && r.preset));
  // The page's permissions for the role grid never include the switch itself.
  assert.ok(!ok.body.data.grid.some((p) => p.key === "teamUsers"));

  // Switching back off hides the team for the admin again.
  const back = await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_users: false } });
  assert.equal(back.status, 200, back.text);
  const again = await call("get", `/api/v1/team?organization_id=${org}`, { token: owner.token, ip: owner.ip });
  assert.equal(again.status, 403);
  await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_users: true } });
});

test("team: only the superadmin changes the switch and the limit", async () => {
  const owner = people.own1;
  const org = owner.org;
  const r1 = await call("patch", `/api/v1/admin/teams/${org}`, { token: owner.token, ip: owner.ip, body: { team_max_members: 50 } });
  assert.equal(r1.status, 403, r1.text);
  const r2 = await call("patch", `/api/v1/admin/teams/${org}`, { token: owner.token, ip: owner.ip, body: { team_users: false } });
  assert.equal(r2.status, 403, r2.text);
  const r3 = await call("patch", `/api/v1/team/members/${org}`, { token: owner.token, ip: owner.ip, body: { organization_id: org, status: "active" } });
  assert.equal(r3.status, 404, r3.text);
});

test("team: superadmin sets the limit and it is enforced", async () => {
  const owner = people.own1;
  const org = owner.org;
  const bad = await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_max_members: -1 } });
  assert.equal(bad.status, 400, bad.text);
  const set = await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_max_members: 2 } });
  assert.equal(set.status, 200, set.text);

  owner.m1 = await addMember(owner, org, { name: "Asha", email: "asha@team.test", role: "sales" });
  owner.m2 = await addMember(owner, org, { name: "Ravi", email: "ravi@team.test", role: "viewer" });
  const full = await call("post", "/api/v1/team/members", { token: owner.token, ip: owner.ip, body: { organization_id: org, name: "Third", email: "third@team.test", role_id: "viewer" } });
  assert.equal(full.status, 400, full.text);
  assert.match(full.body.message, /Your team is full \(2 members\)/);
  assert.equal(await mongoose.model("user").exists({ email: "third@team.test" }), null);

  // Disabling a member frees their seat.
  const dis = await call("patch", `/api/v1/team/members/${owner.m2.memberId}`, { token: owner.token, ip: owner.ip, body: { organization_id: org, status: "disabled" } });
  assert.equal(dis.status, 200, dis.text);
  const room = await call("post", "/api/v1/team/members", { token: owner.token, ip: owner.ip, body: { organization_id: org, name: "Third", email: "third@team.test", role_id: "viewer" } });
  assert.equal(room.status, 201, room.text);
  await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_max_members: 5 } });
});

test("members: sign-in as a team member sees only what their role allows", async () => {
  const owner = people.own1;
  const org = owner.org;
  const asha = owner.m1;
  const me = await call("get", "/api/v1/user/me", { token: asha.token, ip: asha.ip });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.data.team.organisation_id, org);
  assert.equal(me.body.data.team.role_name, "Sales");
  const perms = me.body.data.permissions;
  assert.ok(perms.invoices.includes("create"), "sales can create invoices");
  assert.equal(perms.bills, undefined, "sales has no bills");
  assert.equal(perms.teamUsers, undefined, "members never get the team switch");
  // Sales is capped at what the org admin has: the admin has no quotes.
  assert.equal(perms.quotes, undefined);

  const inv = await call("get", `/api/v1/invoices?organization_id=${org}`, { token: asha.token, ip: asha.ip });
  assert.equal(inv.status, 200, inv.text);
  const cust = await call("get", `/api/v1/contact?organization_id=${org}`, { token: asha.token, ip: asha.ip });
  assert.equal(cust.status, 200, cust.text);

  // The organisation's own reads still work for a member (some are POSTs).
  const orgRead = await call("post", "/api/v1/org/get-organisation", { token: asha.token, ip: asha.ip, body: { organization_id: org } });
  assert.equal(orgRead.status, 200, orgRead.text);
  // The admin's sign-in devices and limits aren't shown to a member.
  const adminAccount = await call("post", "/api/v1/user/get-admin", { token: asha.token, ip: asha.ip, body: {} });
  assert.equal(adminAccount.status, 200, adminAccount.text);
  assert.equal(adminAccount.body.data.email, owner.email);
  assert.equal(adminAccount.body.data.allowed_ips, undefined);
  assert.equal(adminAccount.body.data.permissions, undefined);

  const bills = await call("get", `/api/v1/bills/get-bills?org_id=${org}`, { token: asha.token, ip: asha.ip });
  assert.equal(bills.status, 403, bills.text);
  assert.equal(bills.body.code, "FORBIDDEN");
  assert.equal(bills.body.message, "You don't have permission to view this");
});

test("members: a forbidden call is 403 and team management is refused", async () => {
  const owner = people.own1;
  const org = owner.org;
  const asha = owner.m1;
  const team = await call("get", `/api/v1/team?organization_id=${org}`, { token: asha.token, ip: asha.ip });
  assert.equal(team.status, 403);
  assert.equal(team.body.message, "Only the organisation's admin can manage team members.");

  const invite = await call("post", "/api/v1/team/members", { token: asha.token, ip: asha.ip, body: { organization_id: org, name: "X", email: "x@team.test", role_id: "viewer" } });
  assert.equal(invite.status, 403, invite.text);

  const settings = await call("put", `/api/v1/organization/${org}`, { token: asha.token, ip: asha.ip, body: { city: "Madurai" } });
  assert.equal(settings.status, 403, settings.text);
  assert.match(settings.body.message, /Only the organisation's admin can change/);

  // Another organisation's data is refused, even for a member of this one.
  const other = await call("get", `/api/v1/invoices?organization_id=${org + 999}`, { token: asha.token, ip: asha.ip });
  assert.equal(other.status, 403, other.text);
  assert.equal(other.body.message, "You do not have access to this organization.");
});

test("members: a role change takes effect on the next call", async () => {
  const owner = people.own1;
  const org = owner.org;
  const asha = owner.m1;
  const bills = await call("get", `/api/v1/bills/get-bills?org_id=${org}`, { token: asha.token, ip: asha.ip });
  assert.equal(bills.status, 403);

  // Owner gives Asha a custom role: invoices view, bills view (owner has both).
  const role = await call("post", "/api/v1/team/roles", {
    token: owner.token,
    ip: owner.ip,
    body: { organization_id: org, name: "Bill checker", description: "Looks at bills", permissions: { bills: ["view"], invoices: ["view"] } },
  });
  assert.equal(role.status, 201, role.text);
  const roleId = role.body.data.id;
  const change = await call("patch", `/api/v1/team/members/${asha.memberId}`, { token: owner.token, ip: owner.ip, body: { organization_id: org, role_id: roleId } });
  assert.equal(change.status, 200, change.text);

  const after = await call("get", `/api/v1/bills/get-bills?org_id=${org}`, { token: asha.token, ip: asha.ip });
  assert.equal(after.status, 200, after.text);
  const creates = await call("post", `/api/v1/invoices?organization_id=${org}`, { token: asha.token, ip: asha.ip, body: { organization_id: org } });
  assert.equal(creates.status, 403, creates.text);
  assert.equal(creates.body.message, "You don't have permission to create this");

  // Back to Sales for the rest of the tests.
  await call("patch", `/api/v1/team/members/${asha.memberId}`, { token: owner.token, ip: owner.ip, body: { organization_id: org, role_id: "sales" } });
});

test("roles: custom roles never give more than the org admin has", async () => {
  const owner = people.own1;
  const org = owner.org;
  const escalate = await call("post", "/api/v1/team/roles", {
    token: owner.token,
    ip: owner.ip,
    body: { organization_id: org, name: "Quotes boss", permissions: { quotes: ["view", "create"] } },
  });
  assert.equal(escalate.status, 400, escalate.text);
  assert.match(escalate.body.message, /doesn't have view access to Quotes|doesn't have create access to Quotes/);

  const unknownPage = await call("post", "/api/v1/team/roles", {
    token: owner.token,
    ip: owner.ip,
    body: { organization_id: org, name: "Sneaky", permissions: { teamUsers: ["view"] } },
  });
  assert.equal(unknownPage.status, 400, unknownPage.text);

  const preset = await call("post", "/api/v1/team/roles", {
    token: owner.token,
    ip: owner.ip,
    body: { organization_id: org, name: "accountant", permissions: { invoices: ["view"] } },
  });
  assert.equal(preset.status, 400);
  assert.match(preset.body.message, /built-in role/);

  const empty = await call("post", "/api/v1/team/roles", { token: owner.token, ip: owner.ip, body: { organization_id: org, name: "Empty", permissions: {} } });
  assert.equal(empty.status, 400);

  // The escalation is refused even when the member asks for it directly.
  const asha = owner.m1;
  const self = await call("patch", `/api/v1/team/members/${asha.memberId}`, { token: asha.token, ip: asha.ip, body: { organization_id: org, role_id: "admin" } });
  assert.equal(self.status, 403, self.text);
  const check = await call("get", "/api/v1/user/me", { token: asha.token, ip: asha.ip });
  assert.equal(check.body.data.team.role_name, "Sales");
});

test("roles: a role in use can't be deleted; a custom role can be", async () => {
  const owner = people.own1;
  const org = owner.org;
  const made = await call("post", "/api/v1/team/roles", {
    token: owner.token,
    ip: owner.ip,
    body: { organization_id: org, name: "Customers only", permissions: { customers: ["view", "create", "edit"] } },
  });
  assert.equal(made.status, 201, made.text);
  const roleId = made.body.data.id;
  const ravi = owner.m2;
  const giveIt = await call("patch", `/api/v1/team/members/${ravi.memberId}`, { token: owner.token, ip: owner.ip, body: { organization_id: org, role_id: roleId } });
  assert.equal(giveIt.status, 200, giveIt.text);
  const inUse = await call("delete", `/api/v1/team/roles/${roleId}?organization_id=${org}`, { token: owner.token, ip: owner.ip });
  assert.equal(inUse.status, 400, inUse.text);
  assert.match(inUse.body.message, /still has this role/);
  await call("patch", `/api/v1/team/members/${ravi.memberId}`, { token: owner.token, ip: owner.ip, body: { organization_id: org, role_id: "viewer" } });
  const gone = await call("delete", `/api/v1/team/roles/${roleId}?organization_id=${org}`, { token: owner.token, ip: owner.ip });
  assert.equal(gone.status, 200, gone.text);
});

test("members: the owner's own permissions are the ceiling, live", async () => {
  const owner = people.own1;
  const org = owner.org;
  const asha = owner.m1;
  const cut = await call("patch", `/api/v1/admin/users/${owner.id}`, { token: saToken, body: { permissions: { ...OWNER_PERMS, invoices: ["view"] } } });
  assert.equal(cut.status, 200, cut.text);
  const me = await call("get", "/api/v1/user/me", { token: asha.token, ip: asha.ip });
  assert.deepEqual(me.body.data.permissions.invoices, ["view"]);
  const create = await call("post", `/api/v1/invoices?organization_id=${org}`, { token: asha.token, ip: asha.ip, body: { organization_id: org } });
  assert.equal(create.status, 403, create.text);
  await call("patch", `/api/v1/admin/users/${owner.id}`, { token: saToken, body: { permissions: OWNER_PERMS } });
});

test("members: disabling refuses the next call and sign-in; enabling restores it", async () => {
  const owner = people.own1;
  const org = owner.org;
  const asha = owner.m1;
  const dis = await call("patch", `/api/v1/team/members/${asha.memberId}`, { token: owner.token, ip: owner.ip, body: { organization_id: org, status: "disabled" } });
  assert.equal(dis.status, 200, dis.text);

  const next = await call("get", `/api/v1/invoices?organization_id=${org}`, { token: asha.token, ip: asha.ip });
  assert.equal(next.status, 403, next.text);
  assert.equal(next.body.code, "MEMBER_DISABLED");

  const again = await login(asha.email, "Member@1234", asha.ip);
  assert.equal(again.status, 403, again.text);
  assert.equal(again.body.code, "MEMBER_DISABLED");

  const en = await call("patch", `/api/v1/team/members/${asha.memberId}`, { token: owner.token, ip: owner.ip, body: { organization_id: org, status: "active" } });
  assert.equal(en.status, 200, en.text);
  const back = await call("get", `/api/v1/invoices?organization_id=${org}`, { token: asha.token, ip: asha.ip });
  assert.equal(back.status, 200, back.text);
});

test("members: removing a member ends their session", async () => {
  const owner = people.own1;
  const org = owner.org;
  const asha = owner.m1;
  const rm = await call("delete", `/api/v1/team/members/${asha.memberId}?organization_id=${org}`, { token: owner.token, ip: owner.ip });
  assert.equal(rm.status, 200, rm.text);
  const ended = await call("get", "/api/v1/user/me", { token: asha.token, ip: asha.ip });
  assert.equal(ended.status, 401, ended.text);
  assert.equal(ended.body.code, "SESSION_EXPIRED");
  // Signing in again gives an account with no team and no pages.
  const l = await login(asha.email, "Member@1234", asha.ip);
  assert.equal(l.status, 200, l.text);
  const plain = await call("get", "/api/v1/user/me", { token: l.body.token, ip: asha.ip });
  assert.equal(plain.body.data.team, null);
  assert.deepEqual(plain.body.data.permissions, {});
});

test("invites: one link works once, a resend replaces it, an expired one is refused", async () => {
  const owner = people.own1;
  const org = owner.org;
  const inv = await call("post", "/api/v1/team/members", { token: owner.token, ip: owner.ip, body: { organization_id: org, name: "Meera", email: "meera@team.test", role_id: "purchase" } });
  assert.equal(inv.status, 201, inv.text);
  const first = inviteToken("meera@team.test");

  const resent = await call("post", `/api/v1/team/members/${inv.body.data._id}/resend`, { token: owner.token, ip: owner.ip, body: { organization_id: org } });
  assert.equal(resent.status, 200, resent.text);
  const second = inviteToken("meera@team.test");
  assert.notEqual(first, second);

  const old = await call("post", "/api/v1/team/accept-invite", { body: { token: first, password: "Member@1234" } });
  assert.equal(old.status, 400, old.text);
  assert.equal(old.body.code, "INVITE_USED");

  // An invite link is not a sign-in: it doesn't open the app as anyone.
  const asSession = await call("get", "/api/v1/user/me", { token: second });
  assert.equal(asSession.status, 401, asSession.text);
  const weak = await call("post", "/api/v1/team/accept-invite", { body: { token: second, password: "weak" } });
  assert.equal(weak.status, 400);
  assert.match(weak.body.message, /at least 8 characters/);

  const ok = await call("post", "/api/v1/team/accept-invite", { body: { token: second, password: "Member@1234" } });
  assert.equal(ok.status, 200, ok.text);
  const reuse = await call("post", "/api/v1/team/accept-invite", { body: { token: second, password: "Member@1234" } });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.code, "INVITE_USED");

  const expired = jwt.sign({ sub: inv.body.data._id, purpose: "team-invite", n: "x" }, process.env.JWT_SECRET, { expiresIn: "-1h" });
  const gone = await call("get", `/api/v1/team/invite?token=${encodeURIComponent(expired)}`);
  assert.equal(gone.status, 400);
  assert.equal(gone.body.code, "INVITE_EXPIRED");
  const wrongPurpose = jwt.sign({ sub: "x", purpose: "portal-reset" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const wrong = await call("post", "/api/v1/team/accept-invite", { body: { token: wrongPurpose, password: "Member@1234" } });
  assert.equal(wrong.body.code, "INVITE_INVALID");

  // The new member is on the team and can sign in with the password they chose.
  const meeraIp = ipFor();
  const meera = await login("meera@team.test", "Member@1234", meeraIp);
  assert.equal(meera.status, 200, meera.text);
  people.meera = { token: meera.body.token, email: "meera@team.test", ip: meeraIp };
  const team = await call("get", "/api/v1/team?organization_id=" + org, { token: owner.token, ip: owner.ip });
  assert.ok(team.body.data.members.some((m) => m.email === "meera@team.test" && m.status === "active"));
});

test("invites: an invited person who hasn't accepted can't sign in", async () => {
  const owner = people.own1;
  const org = owner.org;
  const existing = await approvedUser("existing1", {});
  const inv = await call("post", "/api/v1/team/members", { token: owner.token, ip: owner.ip, body: { organization_id: org, name: "Existing", email: existing.email, role_id: "viewer" } });
  assert.equal(inv.status, 201, inv.text);
  const pending = await login(existing.email, existing.password, existing.ip);
  assert.equal(pending.status, 403);
  assert.equal(pending.body.code, "INVITE_PENDING");
  const link = inviteToken(existing.email);
  // An existing account is linked without a new password.
  const info = await call("get", `/api/v1/team/invite?token=${encodeURIComponent(link)}`);
  assert.equal(info.body.data.needs_password, false);
  const acc = await call("post", "/api/v1/team/accept-invite", { body: { token: link } });
  assert.equal(acc.status, 200, acc.text);
  const joined = await login(existing.email, existing.password, existing.ip);
  assert.equal(joined.status, 200, joined.text);
  assert.equal(joined.body.ORG_ID, Number(org));
  assert.equal(joined.body.needs_org_setup, false);
});

test("invites: who can't be invited, and why", async () => {
  const owner = people.own1;
  const org = owner.org;
  const invite = (email, role = "viewer") => call("post", "/api/v1/team/members", { token: owner.token, ip: owner.ip, body: { organization_id: org, name: "P", email, role_id: role } });

  const self = await invite(owner.email);
  assert.equal(self.status, 400);
  assert.match(self.body.message, /your own email address/);

  const bad = await invite("not-an-email");
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /valid email/);

  const noRole = await invite("nobody@team.test", "ghost");
  assert.equal(noRole.status, 400);
  assert.match(noRole.body.message, /Choose a role/);

  await call("patch", "/api/v1/admin/users/" + people.own1.id, { token: saToken, body: { permissions: OWNER_PERMS } });
  const sa = await invite("superadmin@test.local");
  assert.equal(sa.status, 400);
  assert.match(sa.body.message, /superadmin account/);

  // Someone who runs an organisation of their own.
  const runner = await approvedUser("runner1", {});
  await createOrg(runner, "Runner Books");
  const own = await invite(runner.email);
  assert.equal(own.status, 400);
  assert.match(own.body.message, /runs an organisation of their own/);

  // Someone already on another team.
  const other = await invite(people.meera.email);
  assert.equal(other.status, 400);
  assert.match(other.body.message, /already belongs to another organisation's team|already on your team/);

  // An account the superadmin hasn't approved yet.
  const pendingIp = ipFor();
  await call("post", "/api/v1/user/user-register", {
    ip: pendingIp,
    body: { companyName: "Waiting", email: "waiting@team.test", password: "User@1234", phoneNumber: "9000011122", country: "India", state: "Tamil Nadu", agreeToTerms: true },
  });
  const waiting = await invite("waiting@team.test");
  assert.equal(waiting.status, 400);
  assert.match(waiting.body.message, /isn't approved yet/);
});

test("isolation: another organisation's admin can't see or change this team", async () => {
  const owner = people.own1;
  const org = owner.org;
  const b = await approvedUser("ownerb", {});
  await call("patch", `/api/v1/admin/users/${b.id}`, { token: saToken, body: { permissions: { teamUsers: ["view"], ...bothPages } } });
  const orgB = await createOrg(b, "Other Books");

  const peek = await call("get", `/api/v1/team?organization_id=${org}`, { token: b.token, ip: b.ip });
  assert.equal(peek.status, 403, peek.text);
  const memberId = owner.m2.memberId;
  const beforeStatus = (await mongoose.model("team_member").findById(memberId).lean()).status;
  const meddle = await call("patch", `/api/v1/team/members/${memberId}`, { token: b.token, ip: b.ip, body: { organization_id: orgB, status: "disabled" } });
  assert.equal(meddle.status, 404, meddle.text);
  const stillActive = await mongoose.model("team_member").findById(memberId).lean();
  assert.equal(stillActive.status, beforeStatus, "another organisation's admin changed a member");
  const roleMeddle = await call("post", "/api/v1/team/roles", { token: b.token, ip: b.ip, body: { organization_id: org, name: "Mine", permissions: { invoices: ["view"] } } });
  assert.equal(roleMeddle.status, 403, roleMeddle.text);

  // A member of org A can't open org B.
  const cross = await call("get", `/api/v1/invoices?organization_id=${orgB}`, { token: people.meera.token, ip: people.meera.ip });
  assert.ok([401, 403].includes(cross.status), cross.text);
  people.orgB = { org: orgB, owner: b };
});

test("audit: each change is recorded with who did it", async () => {
  const owner = people.own1;
  const org = owner.org;
  const log = await call("get", `/api/v1/team/audit?organization_id=${org}`, { token: owner.token, ip: owner.ip });
  assert.equal(log.status, 200, log.text);
  const actions = log.body.data.map((r) => r.action);
  for (const a of ["member_invited", "role_changed", "role_created", "member_disabled", "member_enabled", "member_removed", "invite_resent", "invite_accepted", "limit_changed"]) {
    assert.ok(actions.includes(a), `missing audit action ${a}`);
  }
  const removed = log.body.data.find((r) => r.action === "member_removed");
  assert.equal(removed.actor, owner.email);
  assert.equal(removed.actor_type, "owner");
  assert.match(removed.target, /@team\.test$/);
});

test("superadmin: sees every team, disables and resets invites", async () => {
  const owner = people.own1;
  const org = owner.org;
  const all = await call("get", "/api/v1/admin/teams", { token: saToken });
  assert.equal(all.status, 200, all.text);
  const mine = all.body.data.find((o) => o.organization_id === Number(org));
  assert.ok(mine, "org missing from superadmin view");
  assert.equal(mine.owner.email, owner.email);
  assert.equal(mine.team_switch, true);

  const meeraUser = await mongoose.model("user").findOne({ email: "meera@team.test" }).lean();
  const meera = await mongoose.model("team_member").findOne({ user_id: meeraUser._id }).lean();
  const dis = await call("patch", `/api/v1/admin/team-members/${meera._id}`, { token: saToken, body: { status: "disabled" } });
  assert.equal(dis.status, 200, dis.text);
  const blocked = await call("get", "/api/v1/user/me", { token: people.meera.token, ip: people.meera.ip });
  assert.equal(blocked.status, 403);

  const reenable = await call("patch", `/api/v1/admin/team-members/${meera._id}`, { token: saToken, body: { status: "active" } });
  assert.equal(reenable.status, 200, reenable.text);

  // Reset a pending invite: a fresh link, the old one dead.
  const inv = await call("post", "/api/v1/team/members", { token: owner.token, ip: owner.ip, body: { organization_id: org, name: "Pending", email: "pending@team.test", role_id: "viewer" } });
  assert.equal(inv.status, 201, inv.text);
  const oldLink = inviteToken("pending@team.test");
  const reset = await call("post", `/api/v1/admin/team-members/${inv.body.data._id}/resend`, { token: saToken });
  assert.equal(reset.status, 200, reset.text);
  const stale = await call("post", "/api/v1/team/accept-invite", { body: { token: oldLink, password: "Member@1234" } });
  assert.equal(stale.body.code, "INVITE_USED");

  // Cancel a pending invite: the person can't accept any longer.
  const cancel = await call("delete", `/api/v1/admin/team-members/${inv.body.data._id}`, { token: saToken });
  assert.equal(cancel.status, 200, cancel.text);
  assert.equal(await mongoose.model("user").exists({ email: "pending@team.test", team_account: true }), null);

  const notAdmin = await call("get", "/api/v1/admin/teams", { token: owner.token, ip: owner.ip });
  assert.equal(notAdmin.status, 403);
});

test("invites: the email comes from the organisation, with the link", async () => {
  const mail = [...sentMail].reverse().find((m) => m.to === "meera@team.test");
  assert.ok(mail);
  assert.equal(mail.fromName, "Switch Books");
  assert.match(mail.text, /token=/);
});

test("removed team: an organisation admin can keep their own books", async () => {
  const owner = people.own1;
  const me = await call("get", "/api/v1/user/me", { token: owner.token, ip: owner.ip });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.data.team, null);
  const own = await call("get", `/api/v1/invoices?organization_id=${owner.org}`, { token: owner.token, ip: owner.ip });
  assert.equal(own.status, 200, own.text);
});
