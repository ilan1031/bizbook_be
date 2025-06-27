const mongoose = require("mongoose");
const json2csv = require("json2csv").Parser;
const ExcelJS = require("exceljs");
const moment = require("moment");

// Define the mongoose models
const ContactCollection = mongoose.model("Contact");
const ItemCollection = mongoose.model("Item");
const ST_CODES = require("../helpers/statusCodeHelpers");

class ExportController {
  constructor() {
    // Bind methods to the class instance to preserve `this` context
    this.exportData = this.exportData.bind(this);
    this.generateCSV = this.generateCSV.bind(this);
    this.generateExcel = this.generateExcel.bind(this);
    this.expandArrayFields = this.expandArrayFields.bind(this);
    this.expandObjectFields = this.expandObjectFields.bind(this);
    this.parseJSONField = this.parseJSONField.bind(this);
    this.processData = this.processData.bind(this);
  }

  // Helper function to parse JSON string fields
  parseJSONField(value) {
    if (value === undefined || value === null) return value;
    
    try {
      if (typeof value === 'string' && (
          value.startsWith('[') || 
          value.startsWith('{')
        )) {
        return JSON.parse(value);
      }
      return value;
    } catch (error) {
      return value; // Return as is if parsing fails
    }
  }

  // Helper function to expand nested object fields into individual columns
  expandObjectFields(item) {
    const expandedItem = {};
    
    for (const key in item) {
      if (!item.hasOwnProperty(key)) continue;
      
      let value = item[key];
      
      // Parse JSON strings
      value = this.parseJSONField(value);
      
      // Handle objects (but not arrays or null)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const nestedFields = this.expandObjectFields(value);
        for (const nestedKey in nestedFields) {
          expandedItem[`${key}_${nestedKey}`] = nestedFields[nestedKey];
        }
      } else if (Array.isArray(value)) {
        // Keep arrays for separate processing
        expandedItem[key] = value;
      } else {
        // Keep primitive values as is
        expandedItem[key] = value;
      }
    }
    
    return expandedItem;
  }

  // Helper function to expand array fields into individual columns
  expandArrayFields(data) {
    if (!data || !data.length) return [];
    
    return data.map(item => {
      const expandedItem = { ...item };
      
      // Process each field in the item
      for (const fieldName in expandedItem) {
        if (!expandedItem.hasOwnProperty(fieldName)) continue;
        
        let fieldValue = expandedItem[fieldName];
        
        // Skip if not an array
        if (!Array.isArray(fieldValue)) continue;
        
        // Expand array items into individual properties
        fieldValue.forEach((arrayItem, index) => {
          if (typeof arrayItem === 'object' && arrayItem !== null) {
            // For object items, create a column for each property
            for (const propKey in arrayItem) {
              if (propKey === '_id') continue; // Skip MongoDB IDs
              
              // Create column name like: items_1_amount, items_2_sku, etc.
              const columnName = `${fieldName}_${index + 1}_${propKey}`;
              expandedItem[columnName] = arrayItem[propKey];
            }
          } else {
            // For simple values, just use index
            expandedItem[`${fieldName}_${index + 1}`] = arrayItem;
          }
        });
        
        // Remove the original array field
        delete expandedItem[fieldName];
      }
      
      return expandedItem;
    });
  }

  // Process and transform the data for export
  processData(data) {
    if (!data || !data.length) return [];
    
    // Step 1: Format dates and remove MongoDB fields
    let processedData = data.map(item => {
      const formattedItem = { ...item };
      
      // Format dates
      for (const key in formattedItem) {
        if (formattedItem[key] instanceof Date) {
          formattedItem[key] = moment(formattedItem[key]).format("YYYY-MM-DD");
        }
      }
      
      // Remove MongoDB specific fields
      delete formattedItem._id;
      delete formattedItem.__v;
      
      return formattedItem;
    });
    
    // Step 2: Expand all nested objects (including shipping_address, billing_address, etc.)
    processedData = processedData.map(item => this.expandObjectFields(item));
    
    // Step 3: Expand all array fields into individual columns
    processedData = this.expandArrayFields(processedData);
    
    return processedData;
  }

  async exportData(req, res) {
    try {
      const {
        entity,
        accept,
        status,
        from_date,
        to_date,
        column_name,
        organization_id,
      } = req.body;

      // Validate required fields
      if (!entity || !accept || !organization_id) {
        return res.status(400).json({
          status: ST_CODES.BAD_REQUEST,
          message: "Missing required fields",
        });
      }

      // Determine which collection to use based on entity
      let Collection;
      let contactType;

      switch (entity.toLowerCase()) {
        case "customers":
          Collection = ContactCollection;
          contactType = "Customer";
          break;
        case "vendors":
          Collection = ContactCollection;
          contactType = "Customer";
          break;
        case "items":
          Collection = ItemCollection;
          break;
        default:
          return res.status(400).json({
            status: ST_CODES.BAD_REQUEST,
            message: "Invalid entity specified",
          });
      }

      // Build query based on the entity type
      let query = {};
      
      // Add organization ID with the correct field name
      query.organization_id = organization_id;
      query.deleted_at = null;

      // Add date range if provided
      if (from_date && to_date) {
        const from = new Date(from_date);
        from.setHours(0, 0, 0, 0);
      
        const to = new Date(to_date);
        to.setHours(23, 59, 59, 999);
      
        query["createdAt"] = {
          $gte: from,
          $lte: to,
        };
      }

      if(contactType){
        query.contact_type = contactType;
      }

      if(entity.toLowerCase() === "customers" || entity.toLowerCase() === "Vendors"){
      }  
      // Fetch data from the database
      const data = await Collection.find(query).lean();
      console.log(`Retrieved ${data.length} records from ${entity}`);

      if (!data || data.length === 0) {
        return res.status(404).json({
          status: ST_CODES.NOT_FOUND,
          message: "No data found for the specified criteria",
        });
      }

      // Process data for export - will expand all nested objects and arrays
      const processedData = this.processData(data);

      // Generate file based on the requested format
      let exportFile;
      let fileName;
      let contentType;

      switch (accept.toLowerCase()) {
        case "csv":
          exportFile = await this.generateCSV(processedData);
          fileName = `${entity}_export_${Date.now()}.csv`;
          contentType = "text/csv";
          break;
        case "xls":
        case "xlsx":
          exportFile = await this.generateExcel(processedData, accept.toLowerCase());
          fileName = `${entity}_export_${Date.now()}.${accept.toLowerCase()}`;
          contentType =
            accept.toLowerCase() === "xls"
              ? "application/vnd.ms-excel"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          break;
        default:
          return res.status(400).json({
            status: ST_CODES.BAD_REQUEST,
            message: "Invalid export format specified",
          });
      }

      // Set headers for file download
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

      // Send the file
      return res.status(200).send(exportFile);
    } catch (error) {
      console.error("Export error:", error);
      return res.status(500).json({
        status: ST_CODES.INTERNAL_SERVER_ERROR,
        message: "An error occurred during export",
        error: error.message,
      });
    }
  }

  // Helper method to generate CSV
  async generateCSV(data) {
    try {
      if (!data || data.length === 0) {
        throw new Error("No data provided for CSV generation");
      }
      
      const fields = Object.keys(data[0]);
      const parser = new json2csv({ fields });
      const csv = parser.parse(data);
      return csv;
    } catch (error) {
      console.error("CSV Generation Error:", error);
      throw new Error(`CSV Generation Error: ${error.message}`);
    }
  }

  // Common method for Excel generation
  async generateExcel(data, format) {
    try {
      if (!data || data.length === 0) {
        throw new Error("No data provided for Excel generation");
      }
      
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Export Data");

      // Add headers
      const headers = Object.keys(data[0]);
      worksheet.addRow(headers);

      // Add data rows
      data.forEach((item) => {
        const row = [];
        headers.forEach((header) => {
          let value = item[header];
          
          // Convert any remaining objects to strings
          if (typeof value === 'object' && value !== null) {
            value = JSON.stringify(value);
          }
          
          row.push(value || "");
        });
        worksheet.addRow(row);
      });

      // Apply styling to headers
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFCCCCCC" },
        };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });

      // Auto fit columns
      worksheet.columns.forEach((column) => {
        column.width = 20;
      });

      // Write to buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return buffer;
    } catch (error) {
      console.error("Excel Generation Error:", error);
      throw new Error(`Excel Generation Error: ${error.message}`);
    }
  }
}

module.exports = new ExportController();