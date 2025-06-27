const mongoose = require("mongoose");
const Salesperson = require("../model/Salesperson");
const ST_CODES = require("../helpers/statusCodeHelpers");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");

class SalespersonController {
   async createSalesperson(req, res) {
    try {
      const { organization_id } = req.query;
      const admin_id = res.locals.user_id;
      const body = req.body;

      if (!organization_id || !admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "organization_id and admin_id are required.",
        });
      }

      const salesperson_id = await commonHelper.generateUniqueId(Salesperson, "salesperson_id");

      const data = {
        salesperson_id,
        organization_id,
        admin_id,
        ...body,
      };

      const newSalesperson = await queryHelper.insertData(Salesperson, data);
      if (!newSalesperson.status) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: newSalesperson.msg,
        });
      }

      return res.status(ST_CODES.CREATED).json({
        status:true,
        code: 0,
        message: "Sales Person has been added.",
        salespersons: newSalesperson.msg,
      });
    } catch (error) {
      console.error("createSalesperson Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }

  async getSalespersons(req, res) {
    try {
      const { page = 1, limit = 10, organization_id, search = "" } = req.query;
      const admin_id = res.locals.user_id;

      const query = {
        admin_id,
        organization_id,
        $or: [
          { salesperson_name: new RegExp(search, "i") },
          { salesperson_email: new RegExp(search, "i") },
        ]
      };

      const projection = {
        _id: 1,
        salesperson_name: 1,
        salesperson_email: 1,
        status: 1
      };

      const sort = { createdAt: -1 };
      const pageInt = parseInt(page, 10);
      const limitInt = parseInt(limit, 10);

      const result = await queryHelper.findData(
        Salesperson,
        query,
        projection,
        sort,
        limitInt,
        pageInt
      );

      return res.status(ST_CODES.OK).json({
        status: true,
        data: result.msg,
        pagination: {
          total: result.total || 0,
          page: pageInt,
          limit: limitInt,
        },
      });
    } catch (error) {
      console.error("getSalespersons Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }

  async updateSalesperson(req, res) {
    try {
      const { _id } = req.params;
      const updateData = req.body;

      if (!_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "_id is required.",
        });
      }

      const updated = await Salesperson.findOneAndUpdate(
        { _id },
        updateData,
        { new: true }
      );

      if (!updated) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Salesperson not found.",
        });
      }

      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Salesperson updated successfully.",
        data: updated,
      });
    } catch (error) {
      console.error("updateSalesperson Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }

  async deleteSalesperson(req, res) {
    try {
      const { _id } = req.params;

      const deleted = await Salesperson.findOneAndDelete({ _id });

      if (!deleted) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Salesperson not found.",
        });
      }

      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Salesperson deleted successfully.",
      });
    } catch (error) {
      console.error("deleteSalesperson Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }
}

module.exports = new SalespersonController();
