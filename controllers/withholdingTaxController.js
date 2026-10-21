const mongoose = require("mongoose");
const WithholdingTax = require("../model/withholdingTaxSchema");
const ST_CODES = require("../helpers/statusCodeHelpers");

const typeOf = (req) => String(req.params.type || "").toUpperCase();
const orgOf = (req) => String(req.query.organization_id || req.body?.organization_id || "");

// TDS / TCS rates a company adds for itself (the TaxModal on invoices and bills).
class WithholdingTaxController {
  async list(req, res) {
    try {
      const type = typeOf(req);
      const organization_id = orgOf(req);
      if (!["TDS", "TCS"].includes(type) || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Unknown tax type or organisation" });
      }
      const rates = await WithholdingTax.find({ organization_id, type }).sort({ name: 1 }).lean();
      // The modal reads the list from `message`.
      return res.status(ST_CODES.OK).json({ status: true, message: rates, data: rates });
    } catch (error) {
      console.error("withholding tax list error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Something went wrong" });
    }
  }

  async create(req, res) {
    try {
      const type = typeOf(req);
      const organization_id = orgOf(req);
      const { name, rate, section = "", nature = "" } = req.body || {};
      const value = Number(rate);
      if (!["TDS", "TCS"].includes(type) || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Unknown tax type or organisation" });
      }
      if (!String(name || "").trim() || !Number.isFinite(value) || value < 0 || value > 100) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Enter a name and a rate between 0 and 100" });
      }
      const tax = await WithholdingTax.create({
        organization_id,
        admin_id: res.locals.user_id,
        type,
        name: String(name).trim(),
        rate: value,
        section: type === "TDS" ? String(section) : "",
        nature: type === "TCS" ? String(nature) : "",
      });
      return res.status(ST_CODES.CREATED).json({ status: true, message: "Tax added", data: tax });
    } catch (error) {
      console.error("withholding tax create error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Something went wrong" });
    }
  }

  async remove(req, res) {
    try {
      const type = typeOf(req);
      const organization_id = orgOf(req);
      if (!mongoose.isValidObjectId(req.params.id) || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Invalid tax" });
      }
      const result = await WithholdingTax.deleteOne({ _id: req.params.id, organization_id, type });
      if (!result.deletedCount) {
        return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Tax not found" });
      }
      return res.status(ST_CODES.OK).json({ status: true, message: "Tax deleted" });
    } catch (error) {
      console.error("withholding tax delete error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: "Something went wrong" });
    }
  }
}

module.exports = new WithholdingTaxController();
