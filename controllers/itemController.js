// controllers/itemController.js
const mongoose = require("mongoose");
const Item = mongoose.model("Item");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
// const queryHelper = require("../helpers/query");

class itemController {
  async createItem(req, res) {
    try {
      // console.log("Processing Item Creation...");

      let bData = req.body;
      const admin_id = res.locals.user_id; // Fetch admin_id from session
      const { organization_id } = req.body; // Extract organization_id from request body

      // Validate required parameters
      if (!admin_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }

      if (!bData || Object.keys(bData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Request body is empty.",
        });
      }

      // Generate unique Item ID
      let itemUniqueId = await commonHelper.generateUniqueId(Item, "item_id");
      let itemskuId = await commonHelper.generateUniqueId(Item, "sku");
      console.log(itemUniqueId, "*-**************", itemskuId);

      // Assign additional fields
      bData["item_id"] = itemUniqueId;
      bData["admin_id"] = admin_id;
      // console.log(itemUniqueId, "itemUniqueId");
      // console.log("Creating Item:", {
      //   admin_id,
      //   organization_id,
      //   itemUniqueId,
      // });
      // return;
      // Insert new Item into the database
      let addItem = await queryHelper.insertData(Item, bData);

      // Handle response
      if (addItem.status) {
        return res.status(ST_CODES.CREATED).json({
          success: true,
          message: addItem.msg,
          data: {
            item_id: itemUniqueId,
          },
        });
      } else {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: addItem.msg,
        });
      }
    } catch (error) {
      console.error("createItem Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to create item. Please try again later.",
      });
    }
  }
  async getItemById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, msg: "ID is required" });
      }

      const result = await queryHelper.findData(
        Item,
        { item_id: id },
        {},
        {},
        0,
        1
      );

      if (!result.status) {
        return res.status(ST_CODES.NOT_FOUND).json(result);
      }
      return res.json(result);
    } catch (error) {
      console.error("Error in GET /items/:id:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ status: false, msg: "Internal server error" });
    }
  }
  async getAllItems(req, res) {
    try {
      console.log("Fetching Items...");
  
      let { limit = 10, page = 1 } = req.query;
  
      const { organization_id } = req.query;
      const admin_id = res.locals.user_id;
  
      if (!admin_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }
  
      // Convert to numbers
      limit = parseInt(limit, 10);
      page = parseInt(page, 10);
      const skip = (page - 1) * limit;
  
      const query = {
        admin_id: admin_id,
        organization_id: organization_id,
        deleted_at: null,
      };
  
      const sort = { createdAt: -1 };
  
      // Fetch total count
      const totalCount = await Item.countDocuments(query);
  
      // Fetch paginated data
      const paginatedItems = await Item.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit);
  
      // Format data
      const formattedData = paginatedItems.map((item) => ({
        ...item._doc,
        rate_formatted:
          item.rate_formatted !== undefined && item.rate_formatted !== null
            ? `₹${parseFloat(item.rate_formatted).toFixed(2)}`
            : "₹0.00",
      }));
  
      // Calculate hasMorePage
      const totalPages = Math.ceil(totalCount / limit);
      const hasMorePage = page < totalPages;
  
      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Items retrieved successfully.",
        data: formattedData,
        total_items: totalCount,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage
        }
      });
  
    } catch (error) {
      console.error("getAllItems Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Unable to fetch items. Please try again later.",
      });
    }
  }

  async itemList(req, res) {
    try {
      const { organization_id, admin_id } = req.query;
      if (!organization_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ success: false, message: "Organization ID is required" });
      }

      console.log("Organization ID:", organization_id);

      // Build query object
      const query = {
        organization_id: organization_id,
        admin_id: admin_id,
      };

      // Add admin_id to query if available
      if (res.locals.user_id) {
        query.admin_id = res.locals.user_id;
      }

      // Direct MongoDB query
      const itemsData = await Item.find(
        query, // First argument: query filter
        {
          // Second argument: projection
          _id: 1,
          name: 1,
          description:1,
          sku: 1,
          rate: 1,
          purchase_rate:1,
        }
      ).lean();

      console.log("Items found:", itemsData ? itemsData.length : 0);

      if (itemsData && itemsData.length > 0) {
        return res.status(ST_CODES.OK).send({
          success: true,
          message: itemsData,
        });
      }

      return res.status(ST_CODES.NOT_FOUND).send({
        success: false,
        message: "No items found",
      });
    } catch (error) {
      console.log("itemList error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        success: false,
        message: "Something went wrong",
      });
    }
  }
}

module.exports = new itemController();
