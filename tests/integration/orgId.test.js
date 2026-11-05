// Organisation ids are unique: the counter never hands out the same id twice,
// even when many organisations are requested at the same moment, and the
// database refuses a second organisation with an id that is already in use.
//
// Runs against its own throwaway database (TEST_DB_URL + "_orgid").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_orgid$2");
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.LOGIN_OTP_ENABLED = "false";
process.env.EMAIL_USER = "";
process.env.EMAIL_PASS = "";
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";

const mongoose = require("mongoose");

let Org;
let nextOrganizationId;

test.before(async () => {
  const conn = await mongoose.createConnection(process.env.DB_Coll).asPromise();
  await conn.dropDatabase();
  await conn.close();
  await mongoose.connect(process.env.DB_Coll);
  Org = require("../../model/organizationSchema");
  ({ nextOrganizationId } = require("../../helpers/orgId"));
  await Org.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
});

test("org ids: 20 requests at the same moment all get different ids", async () => {
  const ids = await Promise.all(Array.from({ length: 20 }, () => nextOrganizationId(Org)));
  assert.equal(new Set(ids).size, 20, `duplicates in ${ids.join(",")}`);
});

test("org ids: each new id is above every id already in use", async () => {
  await Org.create({ organization_id: 100500, admin_id: new mongoose.Types.ObjectId(), org_name: "Existing", zip: 600001, phone: 9876543210 });
  const next = await nextOrganizationId(Org);
  assert.ok(next > 100500, `expected above 100500, got ${next}`);
});

test("org ids: the database refuses a second organisation with the same id", async () => {
  await Org.create({ organization_id: 100900, admin_id: new mongoose.Types.ObjectId(), org_name: "First", zip: 600001, phone: 9876543210 });
  await assert.rejects(
    Org.create({ organization_id: 100900, admin_id: new mongoose.Types.ObjectId(), org_name: "Second", zip: 600001, phone: 9876543210 }),
    (err) => err && (err.code === 11000 || /duplicate key/i.test(err.message))
  );
});
