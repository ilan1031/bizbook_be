// Organisation ids: unique, 6-digit numbers, never reused.
//
// A single atomic counter hands them out. It starts above the highest id
// already in use, so two organisations created at the same time can't get the
// same number, and deleting an organisation never frees its id for reuse.
// The unique index on organization_id (model/organizationSchema.js) is the
// final guard.
const mongoose = require("mongoose");

const FIRST_ID = 100000;
const counters = () => mongoose.connection.db.collection("doc_counters");

const nextOrganizationId = async (OrgModel) => {
  const top = await OrgModel.findOne({}, { organization_id: 1 })
    .sort({ organization_id: -1 })
    .lean();
  const highestUsed = Math.max(FIRST_ID - 1, Number(top?.organization_id) || 0);

  await counters().updateOne({ _id: "organization_id" }, { $max: { seq: highestUsed } }, { upsert: true });
  const r = await counters().findOneAndUpdate(
    { _id: "organization_id" },
    { $inc: { seq: 1 } },
    { returnDocument: "after", upsert: true }
  );
  const seq = (r && (r.value ? r.value.seq : r.seq)) || highestUsed + 1;
  return Number(seq);
};

module.exports = { nextOrganizationId, FIRST_ID };
