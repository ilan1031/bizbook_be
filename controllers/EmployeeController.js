const mongoose = require("mongoose");
const Employee = require("../model/EmployeeModel");
const ST_CODES = require("../helpers/statusCodeHelpers");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");
const validator = require("validator");

class EmployeeController {
  async createEmployee(req, res) {
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

      const { employee_email } = body;

      // Check if email is provided and valid
      if (!employee_email || !validator.isEmail(employee_email)) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Enter a valid email address.",
        });
      }

      // Check if email already exists
      const existingEmployee = await Employee.findOne({
        employee_email: employee_email.toLowerCase(),
        organization_id,
      });

      if (existingEmployee) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: `Employee has already been enrolled with ${employee_email}.`,
        });
      }

      // Generate unique employee ID
      const employee_id = await commonHelper.generateUniqueId(
        Employee,
        "employee_id"
      );

      const data = {
        employee_id,
        organization_id,
        admin_id,
        ...body,
      };

      const newEmployee = await queryHelper.insertData(Employee, data);
      if (!newEmployee.status) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: newEmployee.msg,
        });
      }

      return res.status(ST_CODES.CREATED).json({
        status: true,
        code: 0,
        message: "Employee has been added.",
        employee: newEmployee.msg,
      });
    } catch (error) {
      console.error("createEmployee Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }

  async getEmployee(req, res) {
    try {
      const { page = 1, limit = 50, organization_id, search = "" } = req.query;
      const admin_id = res.locals.user_id;

      const query = {
        admin_id,
        organization_id,
        $or: [
          { employee_name: new RegExp(search, "i") },
          { employee_email: new RegExp(search, "i") },
        ],
      };

      const projection = {
        _id: 1,
        employee_name: 1,
        employee_email: 1,
        status: 1,
      };

      const sort = { createdAt: -1 };
      const pageInt = parseInt(page, 10);
      const limitInt = parseInt(limit, 10);

      const result = await queryHelper.findData(
        Employee,
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
      console.error("getEmployee Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }

  async updateEmployee(req, res) {
    try {
      const { _id } = req.params;
      const updateData = req.body;

      if (!_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "_id is required.",
        });
      }

      const updated = await Employee.findOneAndUpdate({ _id }, updateData, {
        new: true,
      });

      if (!updated) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Employee not found.",
        });
      }

      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Employee has been updated.",
        data: updated,
      });
    } catch (error) {
      console.error("updateEmployee Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }

  async deleteEmployee(req, res) {
    try {
      const { id } = req.params;

      const deleted = await Employee.findOneAndDelete({ _id: id });

      if (!deleted) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Employee not found.",
        });
      }

      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Employee has been deleted.",
      });
    } catch (error) {
      console.error("deleteEmployee Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }

  async getEmployeeById(req, res) {
    try {
      const { id } = req.params;

      const employee = await Employee.findOne({ _id: id });

      if (!employee) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Employee not found.",
        });
      }

      return res.status(ST_CODES.OK).json({
        status: true,
        data: employee,
        message: "Employee has been fetched.",
      });
    } catch (error) {
      console.error("getEmployee Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }
}

module.exports = new EmployeeController();
