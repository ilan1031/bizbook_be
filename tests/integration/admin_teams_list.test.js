// Superadmin teams list (GET /admin/teams): paging with no cap (520 orgs, the
// old limit was 500), newest first, a total count, the summary fields, and a
// query count that does not grow with the number of organisations.
//
// Runs against its own throwaway database (TEST_DB_URL + "_admin_teams").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_admin_teams$2");
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

const realLog = console.log;
console.log = () => {};

let app;
const SA_IP = "203.0.113.70";
const ORG_COUNT = 520; // above the old 500 cap
const call = (method, url, { token, body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", SA_IP);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};

let saToken;
let saId;

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
  const res = await call("post", "/api/v1/user/user-login", { body: { email: "superadmin@test.local", password: "Super@1234" } });
  assert.equal(res.status, 200, res.text);
  saToken = res.body.token;
  saId = (await mongoose.model("user").findOne({ role: "superadmin" }).lean())._id;

  // Organisations inserted directly (creating 520 through the API would be slow).
  const Organization = mongoose.model("Organization");
  const orgs = [];
  for (let i = 1; i <= ORG_COUNT; i++) {
    orgs.push({ organization_id: i, org_name: `Org ${i}`, admin_id: saId, phone: 9876543210, zip: 600001, team_max_members: 5 });
  }
  await Organization.collection.insertMany(orgs);

  // Team data on two organisations: members (one disabled, one invited), a custom role.
  const users = [];
  for (let i = 1; i <= 3; i++) {
    users.push({ email: `member${i}@team.test`, name: `Member ${i}`, role: "user", status: "active", permissions: {}, password: "x", createdAt: new Date(), updatedAt: new Date() });
  }
  const ins = await mongoose.model("user").collection.insertMany(users);
  const ids = Object.values(ins.insertedIds);
  const Member = mongoose.model("team_member");
  await Member.collection.insertMany([
    { organization_id: 1, owner_id: saId, user_id: ids[0], name: "Member 1", role_id: "sales", status: "active", invited_at: new Date(), createdAt: new Date(1), updatedAt: new Date(1) },
    { organization_id: 1, owner_id: saId, user_id: ids[1], name: "Member 2", role_id: "sales", status: "disabled", invited_at: new Date(), createdAt: new Date(2), updatedAt: new Date(2) },
    { organization_id: 2, owner_id: saId, user_id: ids[2], name: "Member 3", role_id: "custom-role-id", status: "invited", invited_at: new Date(), createdAt: new Date(3), updatedAt: new Date(3) },
  ]);
  await mongoose.model("team_role").collection.insertOne({
    organization_id: 2,
    name: "Dispatch",
    name_key: "dispatch",
    description: "Ships orders",
    permissions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // Make the custom role's id match the member row for org 2.
  const dispatch = await mongoose.model("team_role").findOne({ organization_id: 2 }).lean();
  await Member.collection.updateOne({ organization_id: 2 }, { $set: { role_id: String(dispatch._id) } });
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

// Every page, newest first: the list must show all 520 with no gaps or repeats.
test("superadmin teams list: no cap, every organisation is reachable, newest first", async () => {
  const first = await call("get", "/api/v1/admin/teams?limit=100", { token: saToken });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.total, ORG_COUNT);
  assert.equal(first.body.pages, 6);
  assert.equal(first.body.page, 1);
  assert.equal(first.body.limit, 100);
  assert.equal(first.body.data[0].organization_id, ORG_COUNT, "newest organisation first");

  const seen = [];
  for (let page = 1; page <= first.body.pages; page++) {
    const r = await call("get", `/api/v1/admin/teams?limit=100&page=${page}`, { token: saToken });
    assert.equal(r.status, 200, r.text);
    seen.push(...r.body.data.map((o) => o.organization_id));
  }
  assert.equal(seen.length, ORG_COUNT, "every page together has every organisation");
  assert.equal(new Set(seen).size, ORG_COUNT, "no organisation appears twice");
  assert.deepEqual(seen, Array.from({ length: ORG_COUNT }, (_, i) => ORG_COUNT - i), "strictly newest first");
});

test("superadmin teams list: default page size, clamped limit, and page past the end", async () => {
  const def = await call("get", "/api/v1/admin/teams", { token: saToken });
  assert.equal(def.status, 200, def.text);
  assert.equal(def.body.limit, 25);
  assert.equal(def.body.data.length, 25);
  assert.equal(def.body.total, ORG_COUNT);

  const huge = await call("get", "/api/v1/admin/teams?limit=1000", { token: saToken });
  assert.equal(huge.body.limit, 100, "limit is capped at 100");
  assert.equal(huge.body.data.length, 100);

  for (const bad of ["0", "-3", "abc", "1.5"]) {
    const r = await call("get", `/api/v1/admin/teams?limit=${bad}`, { token: saToken });
    assert.equal(r.status, 200, `limit=${bad}: ${r.text}`);
    assert.equal(r.body.limit, 25, `limit=${bad} falls back to the default`);
  }

  const past = await call("get", "/api/v1/admin/teams?page=999999999999&limit=100", { token: saToken });
  assert.equal(past.status, 200, past.text);
  assert.deepEqual(past.body.data, []);
  assert.equal(past.body.total, ORG_COUNT);
});

test("superadmin teams list: summary fields match the team's own data", async () => {
  const r = await call("get", "/api/v1/admin/teams?limit=100&page=6", { token: saToken });
  assert.equal(r.status, 200, r.text);
  const org1 = r.body.data.find((o) => o.organization_id === 1);
  assert.ok(org1, "organisation 1 is on the last page");
  assert.equal(org1.org_name, "Org 1");
  assert.equal(org1.owner.role, "superadmin");
  assert.equal(org1.team_switch, true, "superadmin owner: team users is on");
  assert.equal(org1.limit, 5);
  assert.equal(org1.members.length, 2, "disabled members are listed");
  assert.equal(org1.seats_used, 1, "disabled members do not use a seat");
  assert.ok(org1.members.some((m) => m.email === "member1@team.test" && m.status === "active"));
  const sales = org1.roles.find((x) => x.id === "sales");
  assert.equal(sales.preset, true);
  assert.equal(sales.members, 2, "preset role counts both members");
  assert.equal(org1.roles.length >= 5, true, "presets are included");

  const org2 = r.body.data.find((o) => o.organization_id === 2);
  const dispatch = org2.roles.find((x) => x.name === "Dispatch");
  assert.ok(dispatch, "custom role is included");
  assert.equal(dispatch.preset, false);
  assert.equal(dispatch.members, 1);
  assert.equal(org2.seats_used, 1, "invited members use a seat");
});

test("superadmin teams list: queries do not grow with the number of organisations", async () => {
  const count = async (url) => {
    let n = 0;
    mongoose.set("debug", () => {
      n++;
    });
    try {
      const r = await call("get", url, { token: saToken });
      assert.equal(r.status, 200, r.text);
    } finally {
      mongoose.set("debug", false);
    }
    return n;
  };
  const few = await count("/api/v1/admin/teams?limit=5&page=1");
  const many = await count("/api/v1/admin/teams?limit=100&page=1");
  assert.equal(many, few, `5 orgs took ${few} queries, 100 orgs took ${many}`);
  assert.ok(many <= 10, `expected a fixed handful of queries, got ${many}`);
});
