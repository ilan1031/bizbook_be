const mongoose = require("mongoose");
const TaxExemptionCollection = mongoose.model("TaxExemption");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");
const ST_CODES = require("../helpers/statusCodeHelpers");
const imagekit = require("../helpers/imageKit");

class TaxExemptionController {
  async create(req, res) {
    try {
      let bData = req.body;
      // Generate unique ID for contact
      let taxUniqueId = await commonHelper.generateUniqueId(
        TaxExemptionCollection,
        "tax_exemption_id"
      );
      bData["tax_exemption_id"] = taxUniqueId;
      // Insert contact
      let newTax = await queryHelper.insertData(TaxExemptionCollection, bData);
      if (newTax.status) {
        res
          .status(ST_CODES.OK)
          .send({ status: newTax.status, message: newTax.msg });
      } else {
        res
          .status(ST_CODES.BAD_REQUEST)
          .send({ status: newTax.status, message: newTax.msg });
      }
    } catch (error) {
      console.error("createTax Error:", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }

  async getTaxByType(req, res) {
    try {
      const { organization_id, type } = req.query;
      if (!organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }
      const query = {
        type: "customer",
        organization_id: organization_id,
        deleted_at: null, // Exclude soft-deleted contacts
      };
      const sort = { createdAt: -1 };
      const gets = {};

      const results = await queryHelper.findData(
        TaxExemptionCollection,
        query,
        gets,
        sort
      );
      if (results?.status && results?.msg?.length > 0) {
        return res.status(ST_CODES.OK).json({
          status: true,
          message: `tax_exemption retrieved successfully. Total: ${results.msg.length}`,
          total_tax_exemption: results.msg.length,
          data: results.msg,
        });
      } else {
        return res.status(ST_CODES.OK).json({
          status: true,
          message: `No tax_exemption found for organization ID: ${organization_id}.`,
          total_tax_exemption: 0,
          data: [],
        });
      }
    } catch (error) {
      console.error("gettax-exemption Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Unable to fetch tax-exemption. Please try again later.",
      });
    }
  }
}

module.exports = new TaxExemptionController();
