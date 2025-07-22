const queryHelper = require("./query");
const ST_CODES = require("../helpers/statusCodeHelpers");

// Import your collections
const mongoose = require("mongoose");
const Item = mongoose.model("Item");
const EstimateCollection = require("../model/quotes");
const SalesOrderCollection = require("../model/salesOrder"); // Add this at the top
const InvoiceCollection = require("../model/invoice");
const DeliveryChallan = require("../model/deliveryChallan");
const RecurringInvoiceCollection = require("../model/recurringInvoice");
const PurchaseOrderCollection = mongoose.model("Purchase_Order");
const BillsCollection = mongoose.model("PO_bill");
class ItemHelper {
  
  constructor() {
    // Collection configuration with standardized approach
    this.collectionsConfig = {
      estimates: {
        model: EstimateCollection,
        projection: {
          date_formatted: 1,
          estimate_number: 1,
          customer_name: 1,
          line_items: 1,
          status_formatted: 1,
          rate: 1
        },
        outputFields: ['date_formatted', 'estimate_number', 'customer_name', 'status_formatted']
      },
      sales_orders: {
        model: SalesOrderCollection,
        projection: {
          date_formatted: 1,
          salesorder_id: 1,
          customer_name: 1,
          line_items: 1,
          status_formatted: 1,
          rate: 1
        },
        outputFields: ['date_formatted', 'salesorder_id', 'customer_name', 'status_formatted']
      },
      invoices: {
        model: InvoiceCollection,
        projection: {
          date_formatted: 1,
          invoice_number: 1,
          customer_name: 1,
          line_items: 1,
          status_formatted: 1,
          rate: 1
        },
        outputFields: ['date_formatted', 'invoice_number', 'customer_name', 'status_formatted']
      },
      delivery_challans: {
        model: DeliveryChallan,
        projection: {
          delivery_date: 1,
          deliverychallan_id: 1,
          customer_name: 1,
          line_items: 1,
          status_formatted: 1,
          rate: 1,
          date_formatted: 1
        },
        outputFields: ['delivery_date', 'deliverychallan_id', 'customer_name', 'status_formatted', 'date_formatted']
      },
      purchase_orders: {
        model: PurchaseOrderCollection,
        projection: {
          purchase_order_id: 1,
          customer_name: 1,
          date_formatted: 1,
          line_items: 1,
          status_formatted: 1,
          rate: 1
        },
        outputFields: ['purchase_order_id', 'customer_name', 'date_formatted', 'status_formatted']
      },
      bills: {
        model: BillsCollection,
        projection: {
          bill_id: 1,
          customer_name: 1,
          date_formatted: 1,
          line_items: 1,
          status_formatted: 1,
          rate: 1
        },
        outputFields: ['bill_id', 'customer_name', 'date_formatted', 'status_formatted']
      },
      recurring_invoices: {
        model: RecurringInvoiceCollection,
        projection: {
          date_formatted: 1,
          recurring_invoice_number: 1,
          customer_name: 1,
          line_items: 1,
          status_formatted: 1,
          rate: 1
        },
        outputFields: ['recurring_invoice_number', 'date_formatted', 'customer_name', 'status_formatted']
      }
    };
  }

  async getItemDetails(itemId) {
    const itemResult = await queryHelper.findData(
      Item,
      { item_id: itemId },
      {},
      {},
      0,
      1
    );

    if (!itemResult.status || !itemResult.msg || itemResult.msg.length === 0) {
      return {
        success: false,
        statusCode: ST_CODES.NOT_FOUND,
        message: "Item not found"
      };
    }

    return {
      success: true,
      data: itemResult.msg[0],
      itemObjectId: itemResult.msg[0]._id
    };
  }

  // Generic method to get collection data with filters
  async getCollectionData(collectionKey, itemObjectId, statusFilter = null) {
    const config = this.collectionsConfig[collectionKey];
    if (!config) {
      throw new Error(`Unknown collection: ${collectionKey}`);
    }

    // Build query with optional status filter
    let query = { "line_items.item_id": itemObjectId };
    if (statusFilter) {
      query.status_formatted = new RegExp(statusFilter, 'i'); // Case insensitive
    }

    const result = await queryHelper.findData(
      config.model,
      query,
      config.projection,
      {},
      0,
      100 // Default limit
    );

    let collectionData = [];
    if (result.status && result.msg?.length > 0) {
      result.msg.forEach((document) => {
        const relevantLineItems = document.line_items.filter(
          (lineItem) => lineItem.item_id.toString() === itemObjectId.toString()
        );
        
        relevantLineItems.forEach((lineItem) => {
          // Build output object dynamically based on config
          const outputItem = {};
          
          // Add collection-specific fields
          config.outputFields.forEach(field => {
            outputItem[field] = document[field];
          });
          
          // Add common line item fields
          outputItem.quantity = lineItem.quantity;
          outputItem.item_total_formatted = lineItem.item_total_formatted;
          outputItem.rate = lineItem.rate || document.rate || 0;
          
          collectionData.push(outputItem);
        });
      });
    }

    return collectionData;
  }

  // Method to get multiple collections with filters
  async getFilteredCollectionData(itemObjectId, collectionTypes = [], statusFilter = null) {
    const collectionsToFetch = collectionTypes.length > 0 
      ? collectionTypes.filter(type => this.collectionsConfig[type])
      : Object.keys(this.collectionsConfig);

    const collectionPromises = collectionsToFetch.map(collectionKey => 
      this.getCollectionData(collectionKey, itemObjectId, statusFilter)
        .then(data => ({ [collectionKey]: data }))
        .catch(error => {
          console.error(`Error fetching ${collectionKey}:`, error);
          return { [collectionKey]: [] };
        })
    );

    const results = await Promise.all(collectionPromises);
    
    // Merge all results into single object
    return results.reduce((acc, result) => ({ ...acc, ...result }), {});
  }

  formatItemDetails(rawItem) {
    return {
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
  }

  // Main method with filter options
  async getCompleteItemData(itemId, options = {}) {
    try {
      const { 
        collections = [], // Array of collection types to fetch
        status = null,     // Status filter
        limit = 100       // Default limit
      } = options;

      // Get item details
      const itemResult = await this.getItemDetails(itemId);
      if (!itemResult.success) {
        return itemResult;
      }

      const { data: rawItem, itemObjectId } = itemResult;

      // Get filtered collection data
      const collectionData = await this.getFilteredCollectionData(
        itemObjectId, 
        collections, 
        status
      );

      // Format item details
      const formattedItemDetails = this.formatItemDetails(rawItem);

      return {
        success: true,
        data: {
          item_details: formattedItemDetails,
          ...collectionData
        }
      };

    } catch (error) {
      console.error("Error in getCompleteItemData:", error);
      return {
        success: false,
        statusCode: ST_CODES.INTERNAL_SERVER_ERROR,
        message: "Internal server error"
      };
    }
  }

  // Utility method to get available collection types
  getAvailableCollectionTypes() {
    return Object.keys(this.collectionsConfig);
  }

  // Utility method to validate collection types
  validateCollectionTypes(collectionTypes) {
    const availableTypes = this.getAvailableCollectionTypes();
    const invalidTypes = collectionTypes.filter(type => !availableTypes.includes(type));
    
    return {
      valid: invalidTypes.length === 0,
      invalidTypes,
      availableTypes
    };
  }
}

module.exports = new ItemHelper();