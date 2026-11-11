// Staff / Team users fixes from the QA round:
//  - STAFF-1: tax-rate writes need the settings permission (templates: edit);
//    reads stay open to everyone with a page. Column layouts can't be changed
//    by a Viewer.
//  - STAFF-2: a record a member creates or changes carries the member's id
//    (created_by_actor_id / last_modified_by_actor_id) while the organisation
//    stays the admin's.
//  - STAFF-3: the member limit refuses an empty, null or non-numeric value
//    instead of saving 0.
//
// Runs against its own throwaway database (TEST_DB_URL + "_staff").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_staff$2");
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

// Mail is captured instead of sent (team invites).
const mailer = require("../../helpers/mailer");
const sentMail = [];
mailer.sendMail = async (message) => {
  sentMail.push(message);
  return { ok: true, channel: "console" };
};

const realLog = console.log;
console.log = () => {};

let app;
let n = 0;
const SA_IP = "203.0.113.90";
const ipFor = () => `10.90.0.${++n}`;
const call = (method, url, { token, ip = SA_IP, body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};
const login = (email, password, ip) => call("post", "/api/v1/user/user-login", { ip, body: { email, password } });

let saToken;
const people = {};

// An active account that has signed in once (its IP is known).
const approvedUser = async (key, permissions = {}) => {
  const ip = ipFor();
  const email = `${key}@staff.test`;
  const password = "User@1234";
  const reg = await call("post", "/api/v1/user/user-register", {
    ip,
    body: { companyName: `Co ${key}`, email, password, phoneNumber: `9876700${String(n).padStart(3, "0")}`, country: "India", state: "Tamil Nadu", agreeToTerms: true },
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
    body: { organizationName: name, country: "India", state: "Tamil Nadu", industry_name: "Retail" },
  });
  assert.equal(o.status, 200, o.text);
  const org = String(o.body.data.organization_id);
  await call("put", `/api/v1/organization/${org}`, {
    token: who.token,
    ip: who.ip,
    body: { first_street: "12 Gandhi Road", city: "Chennai", zip: 600001, phone: 9876543210, gst_in: "33AAACB2902M1Z0", email: `accounts+${org}@staff.test` },
  });
  return org;
};

const inviteToken = (to) => {
  const mail = [...sentMail].reverse().find((m) => m.to === to && /invited you/.test(m.subject));
  assert.ok(mail, `no invite email to ${to}`);
  const match = mail.text.match(/token=([^\s]+)/);
  assert.ok(match, "invite email has no link");
  return decodeURIComponent(match[1]);
};

// Invite and accept in one go; returns the member's login.
const addMember = async (owner, org, { name, email, role }) => {
  const inv = await call("post", "/api/v1/team/members", { token: owner.token, ip: owner.ip, body: { organization_id: org, name, email, role_id: role } });
  assert.equal(inv.status, 201, inv.text);
  const token = inviteToken(email);
  const acc = await call("post", "/api/v1/team/accept-invite", { body: { token, password: "Member@1234" } });
  assert.equal(acc.status, 200, acc.text);
  const ip = ipFor();
  const l = await login(email, "Member@1234", ip);
  assert.equal(l.status, 200, l.text);
  const user = await mongoose.model("user").findOne({ email }).lean();
  const membership = await mongoose.model("team_member").findOne({ user_id: user._id }).lean();
  return { token: l.body.token, ip, email, id: String(user._id), memberId: String(membership._id) };
};

const ALL = ["view", "create", "edit", "delete"];
// The org admin: the pages the members below use, the tax settings (templates)
// and the team switch.
const OWNER_PERMS = {
  home: ["view"],
  invoices: ALL,
  customers: ALL,
  items: ALL,
  templates: ["view", "edit"],
  teamUsers: ["view"],
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

// ---- STAFF-1 ----------------------------------------------------------------

test("STAFF-1: a viewer can read tax rates but not change them, and not column layouts", async () => {
  const owner = await approvedUser("st1own", OWNER_PERMS);
  const org = await createOrg(owner, "Staff Tax Books");
  owner.org = org;
  await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_users: true, team_max_members: 20 } });

  const viewer = await addMember(owner, org, { name: "Vee", email: "vee@staff.test", role: "viewer" });
  const sales = await addMember(owner, org, { name: "Sana", email: "sana@staff.test", role: "sales" });

  // The org admin (templates: edit) can set a rate.
  const made = await call("post", `/api/v1/tax/tds/create?organization_id=${org}`, {
    token: owner.token,
    ip: owner.ip,
    body: { name: "194C", rate: 2, section: "194C" },
  });
  assert.equal(made.status, 201, made.text);
  const rateId = String(made.body.data._id);

  // A viewer may not add, delete or change one.
  const viewerAdd = await call("post", `/api/v1/tax/tds/create?organization_id=${org}`, {
    token: viewer.token,
    ip: viewer.ip,
    body: { name: "194J", rate: 10, section: "194J" },
  });
  assert.equal(viewerAdd.status, 403, viewerAdd.text);
  assert.match(viewerAdd.body.message, /permission/);

  const viewerDel = await call("delete", `/api/v1/tax/tds/delete/${rateId}?organization_id=${org}`, { token: viewer.token, ip: viewer.ip });
  assert.equal(viewerDel.status, 403, viewerDel.text);

  // A sales member (documents, no settings) is refused the same way.
  const salesAdd = await call("post", `/api/v1/tax/tcs/create?organization_id=${org}`, {
    token: sales.token,
    ip: sales.ip,
    body: { name: "Goods", rate: 0.1, nature: "Goods" },
  });
  assert.equal(salesAdd.status, 403, salesAdd.text);

  // The shared routes that could change org data are closed to a viewer too.
  const viewerTaxes = await call("post", `/api/v1/taxes?organization_id=${org}`, {
    token: viewer.token,
    ip: viewer.ip,
    body: { organization_id: org, type: "customer", name: "x" },
  });
  assert.equal(viewerTaxes.status, 403, viewerTaxes.text);
  const viewerColumns = await call("put", `/api/v1/columns?organization_id=${org}&type=invoice`, {
    token: viewer.token,
    ip: viewer.ip,
    body: { colList: [] },
  });
  assert.equal(viewerColumns.status, 403, viewerColumns.text);

  // Reads stay open to every member with a page.
  const read = await call("get", `/api/v1/tax/tds/details?organization_id=${org}`, { token: viewer.token, ip: viewer.ip });
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.data.length, 1);
  assert.equal(read.body.data[0].name, "194C");
  const columnsRead = await call("get", `/api/v1/columns?organization_id=${org}&type=invoice`, { token: viewer.token, ip: viewer.ip });
  assert.notEqual(columnsRead.status, 403, columnsRead.text);

  // Nothing the viewer tried changed the organisation's rates.
  const left = await mongoose.model("Withholding_tax").countDocuments({ organization_id: org });
  assert.equal(left, 1);
});

// ---- STAFF-2 ----------------------------------------------------------------

test("STAFF-2: records a member creates or changes carry the member's id; the organisation stays the admin's", async () => {
  const owner = await approvedUser("st2own", OWNER_PERMS);
  const org = await createOrg(owner, "Staff Record Books");
  owner.org = org;
  await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_users: true, team_max_members: 20 } });
  const member = await addMember(owner, org, { name: "Asha Member", email: "asha@staff.test", role: "sales" });

  const contact = await call("post", "/api/v1/contact", {
    token: owner.token,
    ip: owner.ip,
    body: {
      organization_id: org,
      contact_type: "customer",
      contact_name: "Staff Customer",
      company_name: "Staff Customer",
      place_of_contact: "Tamil Nadu",
      contact_persons: [{ first_name: "Staff Customer", email: "staffcustomer@staff.test", is_primary_contact: true }],
    },
  });
  assert.ok(contact.status < 300, contact.text);
  const customerId = contact.body.data.contact_id;

  const created = await call("post", `/api/v1/invoices?org_id=${org}`, {
    token: member.token,
    ip: member.ip,
    body: {
      organization_id: org,
      customer_id: customerId,
      customer_name: "Staff Customer",
      date: "2026-11-03",
      due_date: "2026-12-03",
      status: "draft",
      status_formatted: "Draft",
      place_of_supply: "Tamil Nadu",
      line_items: [{ name: "Pen", quantity: 1, rate: 100, gst_rate: 0 }],
    },
  });
  assert.ok(created.status < 300, created.text);
  const invoiceId = created.body.data.invoice_id;

  const inv = await mongoose.model("Invoice").findOne({ invoice_id: invoiceId }).lean();
  assert.equal(String(inv.organization_id), org, "the invoice belongs to the organisation");
  assert.equal(String(inv.created_by_id), owner.id, "the admin stays the record's owner (created_by_id)");
  assert.equal(String(inv.created_by_actor_id), member.id, "the member who created it is recorded");
  assert.equal(inv.created_by_actor_name, "Asha Member");
  assert.equal(String(inv.last_modified_by_actor_id), member.id);

  // A change by the member is recorded as theirs.
  const updated = await call("patch", `/api/v1/invoices?organization_id=${org}&invoice_id=${invoiceId}`, {
    token: member.token,
    ip: member.ip,
    body: { line_items: [{ name: "Pen", quantity: 2, rate: 100, gst_rate: 0 }] },
  });
  assert.ok(updated.status < 300, updated.text);
  const after = await mongoose.model("Invoice").findOne({ invoice_id: invoiceId }).lean();
  assert.equal(String(after.created_by_actor_id), member.id, "the creator stays the same");
  assert.equal(String(after.last_modified_by_actor_id), member.id, "the last change is the member's");
  assert.equal(String(after.created_by_id), owner.id);

  // The admin's own invoices are stamped with the admin.
  const own = await call("post", `/api/v1/invoices?org_id=${org}`, {
    token: owner.token,
    ip: owner.ip,
    body: {
      organization_id: org,
      customer_id: customerId,
      customer_name: "Staff Customer",
      date: "2026-11-03",
      due_date: "2026-12-03",
      status: "draft",
      status_formatted: "Draft",
      place_of_supply: "Tamil Nadu",
      line_items: [{ name: "Pen", quantity: 1, rate: 50, gst_rate: 0 }],
    },
  });
  assert.ok(own.status < 300, own.text);
  const ownInv = await mongoose.model("Invoice").findOne({ invoice_id: own.body.data.invoice_id }).lean();
  assert.equal(String(ownInv.created_by_actor_id), owner.id);
});

// ---- STAFF-3 ----------------------------------------------------------------

test("STAFF-3: the member limit refuses an empty or null value and keeps the stored limit", async () => {
  const owner = await approvedUser("st3own", OWNER_PERMS);
  const org = await createOrg(owner, "Staff Limit Books");
  owner.org = org;
  await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_users: true, team_max_members: 7 } });
  const stored = async () => (await mongoose.model("Organization").findOne({ organization_id: org }).lean()).team_max_members;
  assert.equal(await stored(), 7);

  for (const bad of [null, "", "   ", true, "abc", -1, 501, 2.5]) {
    const r = await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_max_members: bad } });
    assert.equal(r.status, 400, `limit ${JSON.stringify(bad)} should be refused: ${r.text}`);
    assert.match(r.body.message, /whole number from 0 to 500/);
    assert.equal(await stored(), 7, `limit ${JSON.stringify(bad)} must not change the stored limit`);
  }

  // Numbers, numeric text and zero are real limits.
  const zero = await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_max_members: 0 } });
  assert.equal(zero.status, 200, zero.text);
  assert.equal(await stored(), 0);
  const text = await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_max_members: "12" } });
  assert.equal(text.status, 200, text.text);
  assert.equal(await stored(), 12);
});

// ---- STAFF-9 ----------------------------------------------------------------

test("STAFF-9: a session from just before a removal ends at once; signing in again afterwards works", async () => {
  const owner = await approvedUser("st9own", OWNER_PERMS);
  const org = await createOrg(owner, "Staff Removal Books");
  owner.org = org;
  await call("patch", `/api/v1/admin/teams/${org}`, { token: saToken, body: { team_users: true, team_max_members: 20 } });
  const member = await addMember(owner, org, { name: "Ravi", email: "ravi@staff.test", role: "viewer" });

  // Removed straight away, in the same second the member signed in.
  const rm = await call("delete", `/api/v1/team/members/${member.memberId}?organization_id=${org}`, { token: owner.token, ip: owner.ip });
  assert.equal(rm.status, 200, rm.text);
  const ended = await call("get", "/api/v1/user/me", { token: member.token, ip: member.ip });
  assert.equal(ended.status, 401, ended.text);
  assert.equal(ended.body.code, "SESSION_EXPIRED");

  // A new sign-in right after is a new session, not the removed one.
  const again = await login(member.email, "Member@1234", member.ip);
  assert.equal(again.status, 200, again.text);
  const me = await call("get", "/api/v1/user/me", { token: again.body.token, ip: member.ip });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.data.team, null);
});
