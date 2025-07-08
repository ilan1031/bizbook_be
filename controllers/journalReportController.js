const mongoose = require("mongoose");
const JournalCollection = mongoose.model("Journal");
const ST_CODES = require("../helpers/statusCodeHelpers");
const dayjs = require("dayjs");

class journalController {
  async getAllJournal(req, res) {
    try {
      let admin_id = res.locals.user_id;
      let organization_id = req.query.org_id;
      const today = dayjs();
      let from = req.query.from;
      let to = req.query.to;
      if (!from || !to) {
        let fromDate = today.startOf("month");
        let toDate = today.endOf("month");

        from = fromDate.format("DD-MM-YYYY");
        to = toDate.format("DD-MM-YYYY");
      }
      if (!organization_id) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({ message: "Organization ID is required" });
      }
      if (!admin_id) {
        return res
          .status(ST_CODES.UNAUTHORIZED)
          .json({ message: "Admin ID is required" });
      }
      // Convert DD-MM-YYYY format to Date objects for MongoDB query
      const fromDate = dayjs.utc(from, "DD-MM-YYYY").startOf("day").toDate();
      const toDate = dayjs.utc(to, "DD-MM-YYYY").endOf("day").toDate();
      let journal = await JournalCollection.find({
        organization_id: organization_id,
        admin_id: admin_id,
        createdAt: {
          $gte: fromDate,
          $lte: toDate,
        },
      }).sort({ createdAt: -1 });
      res.status(ST_CODES.OK).send({ data: journal });
    } catch (error) {
      console.log("The error is getting all journal", error);
    }
  } 

  async getIndividualJournal(req, res) {
    try {
      const organization_id = req.query.org_id;
      const journal_id = req.query.journal_id; // From route param
      if (!organization_id) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({ message: "Organization ID is required" });
      }
      if (!journal_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ message: "Journal ID is required" });
      }
      const journal = await JournalCollection.findOne({
        organization_id,
        journal_id: journal_id, // or use `_id: journal_id` if using Mongo _id
      });
      if (!journal) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({ message: "Journal entry not found" });
      }
      res.status(ST_CODES.OK).json({ data: journal });
    } catch (error) {
      console.log("Error in getIndividualJournal", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Internal Server Error" });
    }
  }
}

module.exports = new journalController();
