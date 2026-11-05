const mongoose = require("mongoose");
const JournalCollection = mongoose.model("Journal");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { POSTED_JOURNALS } = require("../helpers/accountingHelper");
const dayjs = require("dayjs");

// "DD-MM-YYYY" (what the report screen sends) or "YYYY-MM-DD"; null when
// it isn't a real date.
const parseReportDate = (v) => {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  let y, mo, d;
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = dayjs(new Date(y, mo - 1, d));
  return date.year() === y && date.month() === mo - 1 && date.date() === d ? date : null;
};

class journalController {
  async getAllJournal(req, res) {
    try {
      let admin_id = res.locals.user_id;
      let organization_id = req.query.org_id;
      const today = dayjs();
      let from = req.query.from;
      let to = req.query.to;

      // Pagination parameters
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      if (!from || !to) {
        let fromDate = today.startOf("month");
        let toDate = today.endOf("month");
        from = fromDate.format("DD-MM-YYYY");
        to = toDate.format("DD-MM-YYYY");
      }

      if (!organization_id) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({ 
            status: false,
            message: "Organization ID is required" 
          });
      }

      if (!admin_id) {
        return res
          .status(ST_CODES.UNAUTHORIZED)
          .json({ 
            status: false,
            message: "Admin ID is required" 
          });
      }

      const fromDay = parseReportDate(from);
      const toDay = parseReportDate(to);
      if (!fromDay || !toDay) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Dates must be valid and in DD-MM-YYYY (or YYYY-MM-DD) format",
        });
      }
      if (fromDay.isAfter(toDay)) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "The start date must be on or before the end date" });
      }
      const fromDate = fromDay.startOf("day").toDate();
      const toDate = toDay.endOf("day").toDate();

      const query = {
        organization_id: organization_id,
        admin_id: admin_id,
        journal_date: {
          $gte: fromDate,
          $lte: toDate,
        },
        ...POSTED_JOURNALS,
      };

      const [journal, totalCount] = await Promise.all([
        JournalCollection.find(query)
          .sort({ journal_date: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit),
        JournalCollection.countDocuments(query),
      ]);

      res.status(ST_CODES.OK).send({
        status: true,
        data: journal,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalRecords: totalCount,
          recordsPerPage: limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
          startRecord: skip + 1,
          endRecord: Math.min(skip + limit, totalCount)
        }
      });
    } catch (error) {
      console.log("The error is getting all journal", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Failed to retrieve journal data",
      });
    }
  }

  async getIndividualJournal(req, res) {
    try {
      const organization_id = req.query.org_id;
      const journal_id = req.query.journal_id;
      
      if (!organization_id) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({ 
            status: false,
            message: "Organization ID is required" 
          });
      }
      
      if (!journal_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ 
            status: false,
            message: "Journal ID is required" 
          });
      }
      
      const journal = await JournalCollection.findOne({
        organization_id,
        journal_id: journal_id,
      });
      
      if (!journal) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .json({ 
            status: false,
            message: "Journal entry not found" 
          });
      }
      
      res.status(ST_CODES.OK).json({ 
        status: true,
        data: journal 
      });
    } catch (error) {
      console.log("Error in getIndividualJournal", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ 
          status: false,
          message: "Internal Server Error" 
        });
    }
  }
}

module.exports = new journalController();