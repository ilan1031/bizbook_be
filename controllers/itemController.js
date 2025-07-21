// controllers/itemController.js
const mongoose = require("mongoose");
const Item = mongoose.model("Item");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const EstimateCollection = require("../model/quotes");

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

      if (!id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .json({ status: false, msg: "ID is required" });
      }

      // Get item details from Item collection
      const itemResult = await queryHelper.findData(
        Item,
        { item_id: id },
        {},
        {},
        0,
        1
      );

      if (
        !itemResult.status ||
        !itemResult.msg ||
        itemResult.msg.length === 0
      ) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          msg: "Item not found",
        });
      }

      // Get the ObjectId (_id) from the item result (data is in msg field)
      const itemObjectId = itemResult.msg[0]._id;
      console.log("Item ObjectId:", itemObjectId);
      console.log("Item data:", itemResult.msg[0]);

      // Get estimates that contain this item using the ObjectId
      const estimatesResult = await queryHelper.findData(
        EstimateCollection,
        { "line_items.item_id": itemObjectId },
        {
          date_formatted: 1,
          estimate_number: 1,
          customer_name: 1,
          line_items: 1,
          status_formatted: 1,
        },
        {},
        0,
        0 // Get all matching estimates
      );

      // Process estimate data and flatten into array format
      let estimateData = [];

      if (
        estimatesResult.status &&
        estimatesResult.msg &&
        estimatesResult.msg.length > 0
      ) {
        // Flatten the estimates into a simple array format
        estimatesResult.msg.forEach((estimate) => {
          // Filter line items to only include the requested item using ObjectId
          const relevantLineItems = estimate.line_items.filter(
            (lineItem) =>
              lineItem.item_id.toString() === itemObjectId.toString()
          );

          // Add each relevant line item as a separate entry in the array
          relevantLineItems.forEach((lineItem) => {
            estimateData.push({
              date_formatted: estimate.date_formatted,
              estimate_number: estimate.estimate_number,
              customer_name: estimate.customer_name,
              status_formatted: estimate.status_formatted,
              quantity: lineItem.quantity,
              item_total_formatted: lineItem.item_total_formatted,
            });
          });
        });
      }

      // Format the item details
      const rawItem = itemResult.msg[0];
      const formattedItemDetails = {
        _id: rawItem._id,
        item_id: rawItem.item_id,
        admin_id: rawItem.admin_id,
        organization_id: rawItem.organization_id,
        name: rawItem.name,
        item_name: rawItem.item_name,
        unit: rawItem.unit || "",
        status: rawItem.status,
        status_formatted:
          rawItem.status === "active"
            ? "Active"
            : rawItem.status === "inactive"
            ? "InActive"
            : rawItem.status
            ? rawItem.status.charAt(0).toUpperCase() +
              rawItem.status.slice(1).toLowerCase()
            : "Active",
        description: rawItem.description || "",
        rate: rawItem.rate || 0,
        rate_formatted:
          rawItem.rate !== undefined && rawItem.rate !== null
            ? `₹${parseFloat(rawItem.rate).toFixed(2)}`
            : "₹0.00",
        tax_id: rawItem.tax_id || "",
        purchase_account_id: rawItem.purchase_account_id || "",
        purchase_account_name: rawItem.purchase_account_name || "",
        account_id: rawItem.account_id || "",
        account_name: rawItem.account_name || "",
        purchase_description: rawItem.purchase_description || "",
        purchase_rate: rawItem.purchase_rate || 0,
        opening_stock: rawItem.opening_stock,
        opening_stock_rate: rawItem.opening_stock_rate,
        purchase_rate_formatted:
          rawItem.purchase_rate !== undefined && rawItem.purchase_rate !== null
            ? `₹${parseFloat(rawItem.purchase_rate).toFixed(2)}`
            : "₹0.00",
        can_be_sold: rawItem.can_be_sold || false,
        can_be_purchased: rawItem.can_be_purchased || false,
        track_inventory: rawItem.track_inventory || false,
        item_type: rawItem.item_type || "goods",
        item_type_formatted:
          rawItem.item_type && typeof rawItem.item_type === "string"
            ? rawItem.item_type.charAt(0).toUpperCase() +
              rawItem.item_type.slice(1).toLowerCase()
            : "Goods",
        is_taxable: rawItem.is_taxable || false,
        sku: rawItem.sku || "",
        hsn_or_sac: rawItem.hsn_or_sac || "",
        tags: rawItem.tags || [],
        // Filter out incomplete comments and format properly
        comments: (rawItem.comments || [])
          .filter((comment) => comment.comment_id && comment.description)
          .map((comment) => ({
            comment_id: comment.comment_id,
            description: comment.description,
            commented_by_id: comment.commented_by_id,
            commented_by: comment.commented_by,
            comment_type: comment.comment_type,
            date: comment.date,
            date_formatted: comment.date_formatted,
            date_with_time: comment.date_with_time,
            date_description: comment.date_description,
            time: comment.time,
            operation_type: comment.operation_type,
            transaction_id: comment.transaction_id,
            transaction_type: comment.transaction_type,
            sentiment: comment.sentiment || "none",
          })),
        createdAt: rawItem.createdAt,
        updatedAt: rawItem.updatedAt,
        __v: rawItem.__v,
      };

      // Combine item details with estimate data
      const response = {
        status: true,
        data: {
          item_details: formattedItemDetails,
          estimates: estimateData,
        },
      };

      return res.json(response);
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
      admin_id: admin_id
    });

    console.log("Delete result:", deleteResult ? "Success" : "Failed");

    if (deleteResult) {
      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Item deleted successfully",
        data: {
          item_id: id,
          deleted_item_name: deleteResult.name || deleteResult.item_name || "Unknown"
        }
      });
    }

    // If no item found or delete fails
    return res.status(ST_CODES.NOT_FOUND).json({
      status: false,
      message: "Item not found or you don't have permission to delete this item"
    });

  } catch (error) {
    console.error("Delete item error:", error);
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
      status: false,
      message: "Internal server error: Unable to delete item"
    });
  }
}
}

module.exports = new itemController();
