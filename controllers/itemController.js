// controllers/itemController.js
const mongoose = require("mongoose");
const Item = mongoose.model("Item");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const itemHelper = require("../helpers/itemHelper");

// Helper function to create comment (outside class)
const createComment = async (
  itemId,
  description,
  operationType,
  commentedById,
  commentedBy
) => {
  const currentDate = new Date();
  const formattedDate = currentDate.toLocaleDateString("en-GB");
  const formattedTime = currentDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const dateWithTime = currentDate.toLocaleString("en-GB");

  // Generate unique comment ID using commonHelper
  const commentId = await commonHelper.generateUniqueId(
    Item,
    "comment_id",
    5,
    "CMT"
  );

  return {
    comment_id: commentId,
    description: description,
    commented_by_id: commentedById,
    commented_by: commentedBy,
    comment_type: "system",
    date: formattedDate,
    date_formatted: formattedDate,
    date_with_time: dateWithTime,
    date_description: formattedDate,
    time: formattedTime,
    operation_type: operationType,
    transaction_id: itemId,
    transaction_type: "item",
    sentiment: "none",
  };
};
class itemController {
  async createItem(req, res) {
    try {
      let bData = req.body;
      const admin_id = res.locals.user_id;
      const { organization_id } = req.body;

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

      // Assign additional fields
      bData["item_id"] = itemUniqueId;
      bData["admin_id"] = admin_id;

      // Create initial comment for item creation
      const creationComment = await createComment(
        itemUniqueId,
        `Item created with name: ${bData.name || bData.item_name}`,
        "Added",
        admin_id,
        "System"
      );

      // Add comments array to item data
      bData["comments"] = [creationComment];

      // Insert new Item into the database
      let addItem = await queryHelper.insertData(Item, bData);

      // Handle response
      if (addItem.status) {
        return res.status(ST_CODES.CREATED).json({
          success: true,
          message: "Item created successfully",
          data: {
            item_id: itemUniqueId,
            comment_added: creationComment.description,
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

  async getAllItems(req, res) {
    try {
      console.log("Fetching Items...");

      const {
        organization_id,
        sort_column = "createdAt",
        sort_order = "D",
        filter = "",
      } = req.query;

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const admin_id = res.locals.user_id;

      if (!admin_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }

      // Build base query
      const query = {
        admin_id: admin_id,
        organization_id: organization_id,
        deleted_at: null,
      };

      // Apply filters
      switch (filter) {
        case "Status.Active":
          query.status = "active";
          break;
        case "Status.Inactive":
          query.status = "inactive";
          break;
        case "Type.Goods":
          query.item_type = "goods";
          break;
        case "Type.Service":
          query.item_type = "service";
          break;
        case "Taxable.Yes":
          query.is_taxable = true;
          break;
        case "Taxable.No":
          query.is_taxable = false;
          break;
        case "Inventory.Tracked":
          query.track_inventory = true;
          break;
        case "Inventory.NotTracked":
          query.track_inventory = false;
          break;
        case "Sellable.Yes":
          query.can_be_sold = true;
          break;
        case "Sellable.No":
          query.can_be_sold = false;
          break;
        case "Purchasable.Yes":
          query.can_be_purchased = true;
          break;
        case "Purchasable.No":
          query.can_be_purchased = false;
          break;
        case "Status.All":
        default:
          // No additional filter
          break;
      }

      // Define allowed sort columns
      const allowedSortColumns = [
        "name",
        "item_name",
        "sku",
        "rate",
        "purchase_rate",
        "status",
        "item_type",
        "createdAt",
        "updatedAt",
        "unit",
      ];

      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      // Define projection for better performance
      const projection = {
        _id: 1,
        item_id: 1,
        name: 1,
        item_name: 1,
        unit: 1,
        status: 1,
        description: 1,
        rate: 1,
        rate_formatted: 1,
        purchase_rate: 1,
        purchase_rate_formatted: 1,
        can_be_sold: 1,
        can_be_purchased: 1,
        track_inventory: 1,
        item_type: 1,
        is_taxable: 1,
        sku: 1,
        hsn_or_sac: 1,
        tags: 1,
        createdAt: 1,
        updatedAt: 1,
        organization_id: 1,
        admin_id: 1,
        comments: 1,
      };

      // Fetch total count
      const totalCount = await Item.countDocuments(query);

      // Fetch paginated data using queryHelper
      const results = await queryHelper.findData(
        Item,
        query,
        projection,
        sort,
        limit,
        page
      );

      // Format data
      const formattedData = (results?.msg || []).map((item) => ({
        _id: item._id,
        item_id: item.item_id,
        name: item.name || item.item_name,
        item_name: item.item_name || item.name,
        unit: item.unit || "",
        status: item.status,
        status_formatted:
          item.status && typeof item.status === "string"
            ? item.status.charAt(0).toUpperCase() +
              item.status.slice(1).toLowerCase()
            : "Active",
        description: item.description || "",
        rate: item.rate || 0,
        rate_formatted:
          item.rate !== undefined && item.rate !== null
            ? `₹${parseFloat(item.rate).toFixed(2)}`
            : "₹0.00",
        purchase_rate: item.purchase_rate || 0,
        purchase_rate_formatted:
          item.purchase_rate !== undefined && item.purchase_rate !== null
            ? `₹${parseFloat(item.purchase_rate).toFixed(2)}`
            : "₹0.00",
        can_be_sold: item.can_be_sold || false,
        can_be_purchased: item.can_be_purchased || false,
        track_inventory: item.track_inventory || false,
        item_type: item.item_type || "goods",
        item_type_formatted:
          item.item_type && typeof item.item_type === "string"
            ? item.item_type.charAt(0).toUpperCase() +
              item.item_type.slice(1).toLowerCase()
            : "Goods",
        is_taxable: item.is_taxable || false,
        sku: item.sku || "",
        hsn_or_sac: item.hsn_or_sac || "",
        tags: item.tags || [],
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        organization_id: item.organization_id,
        comments_count: item.comments ? item.comments.length : 0,
        last_comment:
          item.comments && item.comments.length > 0
            ? item.comments[item.comments.length - 1].description
            : null,
      }));

      // Calculate pagination info
      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Items retrieved successfully.",
        data: formattedData,
        pagination: {
          totalCount,
          totalPages,
          currentPage: page,
          applied_filter: filter,
          hasNextPage,
          hasPrevPage,
          per_page: limit,
        },
        type: "Items",
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
          item_id: 1,
          name: 1,
          description: 1,
          sku: 1,
          rate: 1,
          purchase_rate: 1,
          gst_rate: 1,
          is_taxable: 1,
          hsn_or_sac: 1,
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

  async getItemById(req, res) {
    try {
      const { id } = req.params;
      const { collections, status, limit } = req.query;

      if (!id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, msg: "ID is required" });
      }

      // Parse collections filter (comma-separated string to array)
      let collectionsArray = [];
      if (collections) {
        collectionsArray = collections.split(",").map((c) => c.trim());

        // Validate collection types
        const validation = itemHelper.validateCollectionTypes(collectionsArray);
        if (!validation.valid) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            status: false,
            msg: `Invalid collection types: ${validation.invalidTypes.join(
              ", "
            )}`,
            available_types: validation.availableTypes,
          });
        }
      }

      // Prepare options for helper
      const options = {
        collections: collectionsArray,
        status: status || null,
        limit: limit ? parseInt(limit) : 100,
      };

      // Get complete item data using helper with filters
      const result = await itemHelper.getCompleteItemData(id, options);

      if (!result.success) {
        return res.status(result.statusCode).json({
          status: false,
          msg: result.message,
        });
      }

      return res.json({
        status: true,
        data: result.data,
        filters_applied: {
          collections: collectionsArray.length > 0 ? collectionsArray : "all",
          status: status || "all",
          limit: options.limit,
        },
      });
    } catch (error) {
      console.error("Error in GET /items/:id:", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ status: false, msg: "Internal server error" });
    }
  }

  async updateItem(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Item ID is required",
        });
      }

      if (!admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Admin ID is required",
        });
      }

      if (!updateData || Object.keys(updateData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Update data is required",
        });
      }

      // Check if item exists
      const existingItem = await queryHelper.findData(
        Item,
        { item_id: id, admin_id: admin_id },
        {},
        {},
        0,
        1
      );

      if (
        !existingItem.status ||
        !existingItem.msg ||
        existingItem.msg.length === 0
      ) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message:
            "Item not found or you don't have permission to update this item",
        });
      }

      const currentItem = existingItem.msg[0];

      // Create update comment with details of what changed
      let changedFields = [];
      const fieldsToTrack = [
        "name",
        "item_name",
        "rate",
        "purchase_rate",
        "status",
        "description",
        "unit",
      ];

      fieldsToTrack.forEach((field) => {
        if (
          updateData[field] !== undefined &&
          updateData[field] !== currentItem[field]
        ) {
          changedFields.push(
            `${field}: ${currentItem[field]} → ${updateData[field]}`
          );
        }
      });

      const updateComment = createComment(
        id,
        `Item updated. Changes: ${
          changedFields.length > 0 ? changedFields.join(", ") : "Minor updates"
        }`,
        "Modified",
        admin_id,
        "System"
      );

      // Remove fields that shouldn't be updated
      delete updateData.item_id;
      delete updateData.admin_id;
      delete updateData._id;
      delete updateData.createdAt;

      // Add updatedAt timestamp
      updateData.updatedAt = new Date();

      // First update the item data
      const updateResult = await queryHelper.updateData(
        Item,
        { item_id: id, admin_id: admin_id },
        updateData
      );

      if (updateResult.status) {
        // Then add the comment using $push
        await Item.updateOne(
          { item_id: id, admin_id: admin_id },
          { $push: { comments: updateComment } }
        );

        // Get the updated item to return in response
        const updatedItem = await queryHelper.findData(
          Item,
          { item_id: id },
          {},
          {},
          0,
          1
        );

        return res.status(ST_CODES.OK).json({
          status: true,
          message: "Item updated successfully",
          data: {
            item: updatedItem.msg[0],
            comment_added: updateComment.description,
            changes_made: changedFields.length,
          },
        });
      } else {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: updateResult.msg || "Failed to update item",
        });
      }
    } catch (error) {
      console.error("Error in updateItem:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Internal server error",
      });
    }
  }

  async deleteItem(req, res) {
    try {
      const { id } = req.params;
      const admin_id = res.locals.user_id;
      console.log("Deleting item with ID:", id, "by admin:", admin_id);

      // Validate required parameters
      if (!id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Item ID is required",
        });
      }

      if (!admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Admin ID is required",
        });
      }

      // Delete the item directly using item_id
      const deleteResult = await Item.findOneAndDelete({
        item_id: id,
        admin_id: admin_id,
      });

      console.log("Delete result:", deleteResult ? "Success" : "Failed");

      if (deleteResult) {
        return res.status(ST_CODES.OK).json({
          status: true,
          message: "Item deleted successfully",
          data: {
            item_id: id,
            deleted_item_name:
              deleteResult.name || deleteResult.item_name || "Unknown",
          },
        });
      }

      // If no item found or delete fails
      return res.status(ST_CODES.NOT_FOUND).json({
        status: false,
        message:
          "Item not found or you don't have permission to delete this item",
      });
    } catch (error) {
      console.error("Delete item error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Internal server error: Unable to delete item",
      });
    }
  }
}

module.exports = new itemController();
