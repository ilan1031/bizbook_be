const mongoose = require("mongoose");
const ColumnsCollection = require("../model/columnsModel");
const ST_CODES = require("../helpers/statusCodeHelpers");
const MESSAGES = require("../helpers/messageHelpers");

class CommonController {
  async getColumns(req, res) {
    try {
      const { organization_id } = req.query;
      const query = {
        organization_id: organization_id,
      };
      const results = await ColumnsCollection.findOne(query);
      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Column has been fetched",
        data: results,
      });
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to fetch column. Please try again later.",
      });
    }
  }

  async updateColumn(req, res) {
    try {
      const { organization_id, type } = req.query;
      const colList = req.body.colList; // Make sure to parse if sent as a JSON string

      // Find the document
      const columnData = await ColumnsCollection.findOne({ organization_id });

      if (!columnData) {
        return res.status(ST_CODES.ORG_NOT_FOUND).json({
          success: true,
          message: MESSAGES.ORG_NOT_FOUND,
        });
      }

      const targetColumns = columnData.column_headers?.[type];
      if (!Array.isArray(targetColumns)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Invalid type or column data missing.",
          });
      }

      // Update columns based on provided colList
      for (let i = 0; i < targetColumns.length; i++) {
        const incoming = colList.find(
          (c) => c.value === targetColumns[i].value
        );
        if (incoming) {
          targetColumns[i].is_default_select_column =
            incoming.is_default_select_column;
        }
      }

      await columnData.save();

      return res.status(200).json({
        status: true,
        message: "Columns have been updated",
        data: targetColumns,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message:
          "Internal Server Error: Unable to update columns. Please try again later.",
      });
    }
  }
}

module.exports = new CommonController();
