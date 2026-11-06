// GET /period-lock?org_id=      the date the books are locked up to, and its history
// PUT /period-lock              { org_id, locked_until: "YYYY-MM-DD" | null, note? }
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { forget, toDay } = require("../helpers/periodLock");

const Lock = () => mongoose.model("PeriodLock");
const bad = (res, message) => res.status(ST_CODES.BAD_REQUEST).json({ status: false, message });

const present = (doc) => ({
  locked_until: doc?.locked_until ? dayjs(doc.locked_until).format("YYYY-MM-DD") : null,
  history: (doc?.history || []).slice(-20).reverse().map((h) => ({ locked_until: h.locked_until ? dayjs(h.locked_until).format("YYYY-MM-DD") : null, set_by: h.set_by, set_at: h.set_at, note: h.note })),
});

class PeriodLockController {
  async get(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const organization_id = req.query.org_id;
      if (!organization_id) return bad(res, "Organization ID is required");
      const doc = await Lock().findOne({ organization_id: String(organization_id), admin_id }).lean();
      res.status(ST_CODES.OK).json({ status: true, data: present(doc) });
    } catch (error) {
      console.log("period lock get error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Couldn't load the period lock" });
    }
  }

  async set(req, res) {
    try {
      const admin_id = res.locals.user_id;
      const { org_id, locked_until, note } = req.body || {};
      if (!org_id) return bad(res, "Organization ID is required");
      let until = null;
      if (locked_until !== null && locked_until !== undefined && locked_until !== "") {
        until = toDay(locked_until);
        if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(String(locked_until).slice(0, 10))) return bad(res, "Choose a valid date (YYYY-MM-DD), or clear it to unlock");
        if (until.isAfter(dayjs().endOf("day"))) return bad(res, "The books can only be locked up to today or an earlier date");
        until = until.startOf("day");
      }
      const entry = { locked_until: until ? until.toDate() : null, set_by: String(res.locals.actor_email || res.locals.actor_id || admin_id), set_at: new Date(), note: String(note || "").slice(0, 200) };
      const doc = await Lock().findOneAndUpdate(
        { organization_id: String(org_id), admin_id },
        { $set: { locked_until: entry.locked_until }, $push: { history: entry }, $setOnInsert: { organization_id: String(org_id), admin_id } },
        { upsert: true, new: true }
      ).lean();
      forget(admin_id, org_id);
      res.status(ST_CODES.OK).json({ status: true, data: present(doc), message: until ? `Books locked up to ${until.format("DD-MM-YYYY")}` : "Books unlocked" });
    } catch (error) {
      console.log("period lock set error", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Couldn't change the period lock" });
    }
  }
}

module.exports = new PeriodLockController();
