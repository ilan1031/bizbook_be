const mongoose = require("mongoose");
const PurchaseOrderCollection = mongoose.model("Purchase_Order");
const OrganizationCollection = mongoose.model("Organization");
const fs = require("fs");
const path = require("path");
const UserCollection = mongoose.model("user");
const BillsCollection = mongoose.model("PO_bill");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const { ObjectId } = require("mongodb");
const apiHandler = require("../handler/api-handler");
const logUserActivity = require("../helpers/userActivityHelper");
const uploadDir = path.resolve(__dirname, "../../uploads/general");
const MESSAGES = require("../helpers/messageHelpers");

class purchaseOrderController {
  async getVendors(req, res) {
    try {
      let adminID = res.locals.user_id;
      let orgId = req.query.org_id;
      let getVenors = await VendorCollection.find({
        admin_id: adminID,
        organization_id: orgId,
        contact_type: "Vendor",
      });
      // console.log(getVenors, "getVenors");
      if (getVenors.length) {
        res.status(ST_CODES.OK).send({ data: getVenors, status: true });
      } else {
        res
          .status(ST_CODES.OK)
          .send({ data: [], Message: "There are no vendors" });
      }
    } catch (error) {
      console.log("getVendors error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async createPurchaseOrder(req, res) {
    try {
      // console.log("Processing Purchase Order Creation...");

      let poData = req.body;
      console.log(req.body, "*--**--**--**-*-");

      let orgId = req.query.org_id;
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      if (req.file) {
        poData["documents"] = req.file.filename;
      }

      if (!orgId || !poData || Object.keys(poData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and purchase order data are mandatory.",
        });
      }

      // Mapping status numbers to their respective string values
      const statusMap = {
        0: "ISSUED",
        1: "DRAFT",
      };

      if (poData.status === 0) {
        poData.order_status = "issued";
        poData.order_status_formatted = "Issued";
      } else {
        poData.order_status = "draft";
        poData.order_status_formatted = "Draft";
      }

      // Validate and map status
      if (!statusMap.hasOwnProperty(poData.status)) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Invalid status value. Allowed values: 0 (OPEN), 1 (DRAFT), 2 (VOID), 3 (ISSUED), 4 (CANCEL).",
        });
      }

      // Convert numeric status to string before storing
      poData.status_type = statusMap[poData.status];

      // Generate unique Purchase Order ID
      let poUniqueId = await commonHelper.generateUniqueId(
        PurchaseOrderCollection,
        "purchase_number",
        7,
        "PO"
      );

      // Check if vendor_id is provided
      if (!poData.vendor_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Vendor ID is required to create a purchase order.",
        });
      }

      try {
        // Using the findData helper function to retrieve the vendor from Contact collection
        const ContactCollection = mongoose.model("Contact");
        let vendorQuery = {};
        try {
          vendorQuery = { _id: new mongoose.Types.ObjectId(poData.vendor_id) };
        } catch (err) {
          // If conversion fails, try using the ID as is
          vendorQuery = { _id: poData.vendor_id };
        }

        const vendorData = await queryHelper.findData(
          ContactCollection,
          vendorQuery, // Query by vendor_id
          {}, // Get all fields
          {}, // No sorting
          0, // No limit
          1 // First page
        );

        if (
          !vendorData ||
          !vendorData.status ||
          !vendorData.msg ||
          vendorData.msg.length === 0
        ) {
          return res.status(ST_CODES.BAD_REQUEST).json({
            success: false,
            message: "Vendor not found with the provided ID.",
          });
        }

        // Extract vendor details (first result from the query)
        const vendor = vendorData.msg[0];

        // Format and assign billing address if available in vendor data
        if (vendor.billing_address) {
          // Billing address should be an array as per schema
          poData.billing_address = [
            {
              address_id: vendor.billing_address._id
                ? vendor.billing_address._id.toString()
                : "",
              attention: vendor.billing_address.attention || "",
              address: vendor.billing_address.address || "",
              street1: vendor.billing_address.street1 || "",
              street2: vendor.billing_address.street2 || "",
              city: vendor.billing_address.city || "",
              state_code: vendor.billing_address.state_code || "",
              state: vendor.billing_address.state || "",
              zip: vendor.billing_address.zip || "",
              country: vendor.billing_address.country || "",
              county: vendor.billing_address.county || "",
              country_code: vendor.billing_address.country_code || "",
              phone: vendor.billing_address.phone || "",
              phone_formatted: vendor.billing_address.phone_formatted || "",
              fax: vendor.billing_address.fax || "",
              tax_info_id: vendor.billing_address.tax_info_id || "",
            },
          ];
        } else {
          poData.billing_address = [];
        }
        // Format and assign shipping address if available in vendor data
        // Shipping address is a single object as per schema
        if (vendor.shipping_address) {
          poData.shipping_address = {
            address_id: vendor.shipping_address._id
              ? vendor.shipping_address._id.toString()
              : "",
            attention: vendor.shipping_address.attention || "",
            address: vendor.shipping_address.address || "",
            street1: vendor.shipping_address.street1 || "",
            street2: vendor.shipping_address.street2 || "",
            city: vendor.shipping_address.city || "",
            state_code: vendor.shipping_address.state_code || "",
            state: vendor.shipping_address.state || "",
            zip: vendor.shipping_address.zip || "",
            country: vendor.shipping_address.country || "",
            county: vendor.shipping_address.county || "",
            country_code: vendor.shipping_address.country_code || "",
            phone: vendor.shipping_address.phone || "",
            phone_formatted: vendor.shipping_address.phone_formatted || "",
            fax: vendor.shipping_address.fax || "",
            latitude: vendor.shipping_address.latitude || "",
            longitude: vendor.shipping_address.longitude || "",
            is_shipping_address_verified:
              vendor.shipping_address.is_shipping_address_verified || false,
            is_verifiable: vendor.shipping_address.is_verifiable || false,
            is_valid: vendor.shipping_address.is_valid || false,
          };
        }
        // Format and assign delivery address (using shipping address if delivery is not specified)
        // Delivery address is a single object as per schema
        if (vendor.delivery_address) {
          poData.delivery_address = {
            address_id: vendor.delivery_address._id
              ? vendor.delivery_address._id.toString()
              : "",
            attention: vendor.delivery_address.attention || "",
            address: vendor.delivery_address.address || "",
            street1: vendor.delivery_address.street1 || "",
            street2: vendor.delivery_address.street2 || "",
            city: vendor.delivery_address.city || "",
            state_code: vendor.delivery_address.state_code || "",
            state: vendor.delivery_address.state || "",
            zip: vendor.delivery_address.zip || "",
            country: vendor.delivery_address.country || "",
            county: vendor.delivery_address.county || "",
            country_code: vendor.delivery_address.country_code || "",
            phone: vendor.delivery_address.phone || "",
            phone_formatted: vendor.delivery_address.phone_formatted || "",
            fax: vendor.delivery_address.fax || "",
            latitude: vendor.delivery_address.latitude || "",
            longitude: vendor.delivery_address.longitude || "",
            is_shipping_address_verified:
              vendor.delivery_address.is_shipping_address_verified || false,
            is_verifiable: vendor.delivery_address.is_verifiable || false,
            is_valid: vendor.delivery_address.is_valid || false,
          };
        } else if (vendor.shipping_address) {
          // Use shipping address as delivery address if no specific delivery address is provided
          poData.delivery_address = {
            address_id: vendor.shipping_address._id
              ? vendor.shipping_address._id.toString()
              : "",
            attention: vendor.shipping_address.attention || "",
            address: vendor.shipping_address.address || "",
            street1: vendor.shipping_address.street1 || "",
            street2: vendor.shipping_address.street2 || "",
            city: vendor.shipping_address.city || "",
            state_code: vendor.shipping_address.state_code || "",
            state: vendor.shipping_address.state || "",
            zip: vendor.shipping_address.zip || "",
            country: vendor.shipping_address.country || "",
            county: vendor.shipping_address.county || "",
            country_code: vendor.shipping_address.country_code || "",
            phone: vendor.shipping_address.phone || "",
            phone_formatted: vendor.shipping_address.phone_formatted || "",
            fax: vendor.shipping_address.fax || "",
            latitude: vendor.shipping_address.latitude || "",
            longitude: vendor.shipping_address.longitude || "",
            is_shipping_address_verified:
              vendor.shipping_address.is_shipping_address_verified || false,
            is_verifiable: vendor.shipping_address.is_verifiable || false,
            is_valid: vendor.shipping_address.is_valid || false,
          };
        }

        // Format and assign additional address if available
        // Additional address should be an array as per schema
        if (
          vendor.additional_address &&
          Array.isArray(vendor.additional_address) &&
          vendor.additional_address.length > 0
        ) {
          poData.additional_address = vendor.additional_address.map((addr) => ({
            address_id: addr._id ? addr._id.toString() : "",
            attention: addr.attention || "",
            address: addr.address || "",
            street1: addr.street1 || "",
            street2: addr.street2 || "",
            city: addr.city || "",
            state: addr.state || "",
            state_code: addr.state_code || "",
            zip: addr.zip || "",
            country: addr.country || "",
            country_code: addr.country_code || "",
            phone: addr.phone || "",
            phone_formatted: addr.phone_formatted || "",
            fax: addr.fax || "",
            tax_info_id: addr.tax_info_id || "",
          }));
        } else {
          // Set an empty array if no additional addresses
          poData.additional_address = [];
        }
      } catch (error) {
        console.log("Error fetching vendor data:", error);
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to retrieve vendor information: " + error.message,
        });
      }

      // Assign additional fields
      poData["purchase_number"] = poUniqueId;
      poData["org_id"] = orgId;
      poData["admin_id"] = admin_id;
      poData["due_date"] = poData.delivery_date;

      // Insert new Purchase Order into the database
      let createPO = await queryHelper.insertData(
        PurchaseOrderCollection,
        poData
      );
      await logUserActivity(
        admin_id,
        orgId,
        poData.vendor_id,
        `Purchase order created for ₹${poData.total}`,
        "Purchase order created",
        createPO.msg._id,
        "purchase_order"
      );
      if (!createPO.status) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: createPO.msg,
        });
      }

      return res.status(ST_CODES.CREATED).json({
        success: true,
        message: "Purchase Order created successfully.",
        data: {
          purchase_number: poUniqueId,
          status: poData.status,
          status_type: poData.status_type,
        },
      });
    } catch (error) {
      console.log("createPurchaseOrder Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Internal Server Error: Unable to create purchase order. Please try again later.",
      });
    }
  }
  async getAllPurchaseOrders(req, res) {
    try {
      const {
        org_id,
        sort_column = "createdAt",
        sort_order = "D",
        filter_by = "",
      } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      if (!org_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          message: "Missing required field: org_id is mandatory.",
        });
      }

      const query = {
        admin_id: res.locals.user_id,
        org_id: Number(org_id),
        deleted_at: null,
      };

      switch (filter_by) {
        case "Status.Issued":
          query.status_type = "ISSUED";
          break;
        case "Status.Void":
          query.status_type = "VOID";
          break;
        case "Status.Open":
          query.status_type = "OPEN";
          break;
        case "Status.Canceled":
          query.status_type = "CANCELED";
          break;
        case "Status.Partially":
          query.status_type = "PARTIALLY";
          break;
        case "Status.Billed":
          query.status_type = "BILLED";
          break;
        case "Status.Pending":
          query.status_type = "PENDING";
          break;
        case "Status.Closed":
          query.status_type = "CLOSED";
          break;
        case "Status.All":
        default:
          break;
      }

      const allowedSortColumns = [
        "contact_name",
        "due_date",
        "createdAt",
        "updatedAt",
        "purchase_number",
        "date",
        "total",
      ];

      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      const gets = {
        _id: 1,
        org_id: 1,
        purchase_number: 1,
        vendor_id: 1,
        status: 1,
        status_type: 1,
        reference_number: 1,
        date: 1,
        due_date: 1,
        currency_id: 1,
        exchange_rate: 1,
        total: 1,
        subtotal: 1,
        taxAmount: 1,
        balance: 1,
        payment_made: 1,
        created_time: 1,
        last_modified_time: 1,
        documents: 1,
        createdAt: 1,
      };

      // Count total records
      const totalCount = await PurchaseOrderCollection.countDocuments(query);

      // Fetch paginated results
      let results = await queryHelper.findDataWithPopulate(
        PurchaseOrderCollection,
        query,
        gets,
        {}, // no sort here
        limit,
        page,
        ["vendor_id"]
      );

      // Post-sort if sort_column is 'contact_name'
      if (sort_column === "contact_name") {
        results.msg.sort((a, b) => {
          const nameA = a.vendor_id?.contact_name?.toLowerCase() || "";
          const nameB = b.vendor_id?.contact_name?.toLowerCase() || "";
          return sort_order === "A"
            ? nameA.localeCompare(nameB)
            : nameB.localeCompare(nameA);
        });
      } else {
        // Otherwise sort normally
        results.msg.sort((a, b) => {
          const valA = a[sort_column];
          const valB = b[sort_column];
          if (valA == null) return 1;
          if (valB == null) return -1;
          return sort_order === "A"
            ? valA > valB
              ? 1
              : -1
            : valA < valB
            ? 1
            : -1;
        });
      }

      // Helper function to format date
      const formatDate = (dateString) => {
        if (!dateString) return "N/A";
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };

      // Helper function to format amount with bold and comma separators
      const formatAmount = (amount) => {
        if (!amount || amount === 0) return "₹0.00";
        const numericAmount = parseFloat(amount);
        const formattedAmount = numericAmount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        return `₹${formattedAmount}`;
      };

      // Format the results
      const formattedBills = (results.msg || []).map((bill) => ({
        purchase_number: bill.purchase_number,
        _id: bill._id,
        reference_number: bill.reference_number,
        createdAt: formatDate(bill.createdAt),
        date: formatDate(bill.date),
        created_time: formatDate(bill.created_time),
        due_date: formatDate(bill.due_date),
        organization_id: bill.org_id,
        status: bill.status,
        status_type: bill.status_type,
        total: formatAmount(bill.total),
        subtotal: formatAmount(bill.subtotal),
        taxAmount: formatAmount(bill.taxAmount),
        balance: formatAmount(bill.balance),
        payment_made: formatAmount(bill.payment_made),
        vendor_id: bill.vendor_id?._id || null,
        contact_name: bill.vendor_id?.contact_name || "Unknown Vendor",
        company_name: bill.vendor_id?.company_name || "",
      }));

      // Pagination info
      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      res.status(ST_CODES.OK).send({
        status: results.status,
        data: formattedBills,
        pagination: {
          totalCount,
          totalPages,
          currentPage: page,
          hasNextPage,
          hasPrevPage,
        },
        type: "Purchase Orders",
      });
    } catch (error) {
      console.error("getAllPurchaseOrders error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async getIndividualPurchaseOrder(req, res) {
    try {
      const { org_id, po_id } = req.query;
      if (!org_id || !po_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Unauthorized route" });
      }

      // Fetch the purchase order using the query parameters directly
      const poData = await PurchaseOrderCollection.findOne({
        admin_id: res.locals.user_id,
        org_id: org_id,
        purchase_number: po_id,
      })
        .populate("vendor_id")
        .populate({
          path: "bills.bill_ref_id",
          select: "bill_number status_type due_date total billDate _id",
        });

      if (!poData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Purchase Order not found..." });
      }

      // Find the organization using the same approach that works in getIndividualBill
      let organizationData = await OrganizationCollection.findOne(
        {
          $or: [
            { organization_number: Number(org_id) },
            { organization_code: org_id.toString() },
            { organization_id: org_id },
          ],
        },
        {
          first_street: 1,
          second_street: 1,
          org_name: 1,
          email: 1,
          city: 1,
          country: 1,
          gst_in: 1,
          zip: 1,
          phone: 1,
          organizationName: 1,
          state: 1,
        }
      );

      // If we still can't find the organization, try using a field from the purchase order
      if (!organizationData && poData.org_id) {
        organizationData = await OrganizationCollection.findOne(
          {
            $or: [
              { organization_number: Number(poData.org_id) },
              { organization_code: poData.org_id.toString() },
              { organization_id: poData.org_id },
            ],
          },
          {
            first_street: 1,
            second_street: 1,
            org_name: 1,
            email: 1,
            city: 1,
            country: 1,
            gst_in: 1,
            zip: 1,
            phone: 1,
            organizationName: 1,
            state: 1,
          }
        );
      }

      if (!organizationData) {
        return res.status(ST_CODES.ORG_NOT_FOUND).send({
          success: true,
          message: MESSAGES.ORG_NOT_FOUND,
        });
      }

      // Combine purchase order data with organization data
      const responseData = {
        ...poData.toObject(),
        organization: organizationData.toObject(),
      };

      return res
        .status(ST_CODES.OK)
        .send({ message: "Successfully fetched", data: responseData });
    } catch (error) {
      console.log("getIndividualPurchaseOrder error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong", error: error.message });
    }
  }
  async updateIndividualPurchaseOrder(req, res) {
    try {
      const { org_id, po_id } = req.query;
      const poData = req.body;
      if (req.file) {
        poData["documents"] = req.file.filename;
      }
      // console.log(poData, "---------poData");
      poData["purchase_order_number"] = poData.purchaseOrderNumber;
      poData["reference_number"] = poData.referenceNumber;
      poData["due_date"] = poData.delivery_date;
      poData["address_type"] = poData.addressType;
      poData["organization_name"] = poData.organizationName;
      poData["shipment_preference"] = poData.shipmentPreference;
      poData["tax_category"] = poData.taxCategory;
      poData["tds_tcs"] = poData.tdsOrTcs;
      poData["tax_amount"] = poData.taxAmount;
      poData["status_type"] = poData.status == 0 ? "ISSUED" : "CLOSED";

      if (poData.status === 0) {
        poData.order_status = "issued";
        poData.order_status_formatted = "Issued";
      } else {
        poData.order_status = "draft";
        poData.order_status_formatted = "Draft";
      }

      // return;
      const updatedPO = await PurchaseOrderCollection.findOneAndUpdate(
        {
          admin_id: res.locals.user_id,
          org_id: org_id,
          purchase_number: po_id,
        },
        { $set: poData }, // Updating fields with request body data
        { new: true, runValidators: true } // Returns updated document and applies schema validation
      );
      await logUserActivity(
        res.locals.user_id,
        org_id,
        poData.vendor_id,
        `Purchase order has been updated for ₹${poData.total}`,
        "Purchase order updated",
        updatedPO._id,
        "purchase_order"
      );
      // If purchase order is found and updated, return the updated document
      if (updatedPO) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Purchase Order updated successfully",
          data: updatedPO,
        });
      }

      // If no matching purchase order is found
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Purchase Order not found",
      });
    } catch (error) {
      console.log("updateIndividualPurchaseOrder error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async deleteIndividualPurchaseOrder(req, res) {
    try {
      const { org_id, po_id } = req.query;

      // Validate input
      if (!org_id || !po_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing organization ID or purchase order ID",
        });
      }

      const user_id = res.locals.user_id;

      // Perform soft delete by updating 'deleted_at' timestamp
      const deletedPO = await PurchaseOrderCollection.findOneAndUpdate(
        {
          admin_id: user_id,
          org_id: org_id,
          purchase_number: po_id,
          deleted_at: null, // ensure not already deleted
        },
        {
          $set: {
            deleted_at: new Date(),
          },
        },
        {
          new: true,
        }
      );

      console.log(deletedPO, "deletedPOdeletedPO----");

      if (deletedPO) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Purchase Order deleted successfully (soft delete)",
        });
      }

      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Purchase Order not found or already deleted",
      });
    } catch (error) {
      console.error("deleteIndividualPurchaseOrder error", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        message: "Something went wrong",
      });
    }
  }
  async updatePurchaseOrderStatusToVoid(req, res) {
    try {
      const { org_id, po_id, status } = req.query;

      const findPO = await PurchaseOrderCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        purchase_number: po_id,
      });

      if (!findPO) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Purchase Order not found",
        });
      }

      if (findPO.status === 0 && status === "void") {
        await PurchaseOrderCollection.updateOne(
          { _id: findPO._id },
          { $set: { status: 2, status_type: "VOID" } }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Purchase Order status updated successfully",
        });
      }

      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Invalid purchase order status cannot be updated.",
      });
    } catch (error) {
      console.error("updatePurchaseOrderStatusToVoid error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Something went wrong" });
    }
  }
  async updatePurchaseOrderStatusToDraft(req, res) {
    try {
      const { org_id, po_id, status } = req.query;

      const findPO = await PurchaseOrderCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        purchase_number: po_id,
      });
      if (!findPO) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Purchase Order not found",
        });
      }
      if ((findPO.status === 2 || findPO.status === 4) && status === "draft") {
        await PurchaseOrderCollection.updateOne(
          { _id: findPO._id },
          { $set: { status: 1, status_type: "DRAFT" } }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Purchase Order status updated successfully",
        });
      }
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message:
          "Only Void or Cancelled purchase orders can be updated as draft.",
      });
    } catch (error) {
      console.error("updatePurchaseOrderStatusToDraft error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Something went wrong" });
    }
  }
  async updatePurchaseOrderStatusFromDraft(req, res) {
    try {
      const { org_id, po_id, status } = req.query;

      const findPO = await PurchaseOrderCollection.findOne({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        purchase_number: po_id,
      });
      if (!findPO) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Purchase Order not found",
        });
      }
      if (findPO.status === 1 && status === "open") {
        await PurchaseOrderCollection.updateOne(
          { _id: findPO._id },
          { $set: { status: 0, status_type: "OPEN" } }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Purchase Order status updated successfully",
        });
      } else if (findPO.status === 1 && status === "issued") {
        await PurchaseOrderCollection.updateOne(
          { _id: findPO._id },
          { $set: { status: 3, status_type: "ISSUED" } }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Purchase Order status updated successfully",
        });
      } else if (findPO.status === 1 && status === "cancel") {
        await PurchaseOrderCollection.updateOne(
          { _id: findPO._id },
          { $set: { status: 4, status_type: "CANCEL" } }
        );
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Purchase Order status updated successfully",
        });
      } else {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Invalid purchase order status cannot be updated.",
        });
      }
    } catch (error) {
      console.error("updatePurchaseOrderStatusFromDraft error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .json({ message: "Something went wrong" });
    }
  }
  async updateBillingAddress(req, res) {
    try {
      let bData = req.body;
      const { org_id, po_id } = req.query;
      const updateBillingAddress =
        await PurchaseOrderCollection.findOneAndUpdate(
          {
            admin_id: res.locals.user_id,
            organization_id: org_id,
            purchase_number: po_id,
          },
          {
            $set: {
              billing_address: bData,
            },
          }
        );
      if (updateBillingAddress) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Billing address updated successfully",
          data: updateBillingAddress,
        });
      }

      // If no matching purchase order is found
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Purchase Order not found",
      });
    } catch (error) {
      console.log("updateBillingAddress error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async updateShippingAddress(req, res) {
    try {
      let sData = req.body;
      const { org_id, po_id } = req.query;
      const updateShippingAddress =
        await PurchaseOrderCollection.findOneAndUpdate(
          {
            admin_id: res.locals.user_id,
            organization_id: org_id,
            purchase_number: po_id,
          },
          {
            $set: {
              shipping_address: sData,
            },
          }
        );
      if (updateShippingAddress) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Shipping address updated successfully",
          data: updateShippingAddress,
        });
      }

      // If no matching purchase order is found
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Purchase Order not found",
      });
    } catch (error) {
      console.log("updateShippingAddress error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async updateDeliveryAddress(req, res) {
    try {
      let dData = req.body;
      const { org_id, po_id } = req.query;
      const updateDeliveryAddress =
        await PurchaseOrderCollection.findOneAndUpdate(
          {
            admin_id: res.locals.user_id,
            organization_id: org_id,
            purchase_number: po_id,
          },
          {
            $set: {
              delivery_address: dData,
            },
          }
        );
      if (updateDeliveryAddress) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Delivery address updated successfully",
          data: updateDeliveryAddress,
        });
      }

      // If no matching purchase order is found
      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Purchase Order not found",
      });
    } catch (error) {
      console.log("updateDeliveryAddress error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async addCommentToPurchaseOrder(req, res) {
    try {
      const { org_id, po_id } = req.query;
      const { description, operation_type } = req.body;

      if (!description) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Comment description is required",
        });
      }

      const comment = {
        commented_by_id: res.locals.user_id,
        description,
        date: new Date(),
        operation_type: operation_type || "comment",
      };

      const updatedPO = await PurchaseOrderCollection.findOneAndUpdate(
        {
          admin_id: res.locals.user_id,
          organization_id: org_id,
          purchase_number: po_id,
        },
        {
          $push: { comments: comment },
        },
        { new: true }
      );

      if (updatedPO) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Comment added successfully",
          data: updatedPO.comments[updatedPO.comments.length - 1],
        });
      }

      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Purchase Order not found",
      });
    } catch (error) {
      console.log("addCommentToPurchaseOrder error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async addDocumentToPurchaseOrder(req, res) {
    try {
      const { org_id, po_id } = req.query;
      const { file_name, file_size, file_type, uploaded_by } = req.body;

      if (!file_name || !file_size || !file_type) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Document details are required",
        });
      }

      const document = {
        file_name,
        file_size,
        file_type,
        uploaded_by: uploaded_by || res.locals.user_id,
      };

      const updatedPO = await PurchaseOrderCollection.findOneAndUpdate(
        {
          admin_id: res.locals.user_id,
          org_id: org_id,
          purchase_number: po_id,
        },
        {
          $push: { documents: document },
        },
        { new: true }
      );

      if (updatedPO) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Document added successfully",
          data: updatedPO.documents[updatedPO.documents.length - 1],
        });
      }

      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Purchase Order not found",
      });
    } catch (error) {
      console.log("addDocumentToPurchaseOrder error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async updatePurchaseOrderToBill(req, res) {
    try {
      let { org_id, po_id } = req.query;
      let bData = req.body;
      let getPurchaseOrder = await PurchaseOrderCollection.findOne({
        admin_id: res.locals.user_id,
        org_id: org_id,
        purchase_number: po_id,
      });
      if (!getPurchaseOrder) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: true,
          message: "Purchase order not found",
        });
      }
      let billUniqueId = await commonHelper.generateUniqueId(
        BillsCollection,
        "bill_number",
        7,
        "BL"
      );
      if (req.file) {
        bData["documents"] = req.file.filename;
      }
      // Assign additional fields
      bData["bill_number"] = billUniqueId;
      bData["admin_id"] = res.locals.user_id;
      bData["purchase_orders"] = [{ po_ref_id: getPurchaseOrder._id }];
      bData["due_amt"] = bData.total;
      // console.log("bData", req.file, bData);
      // // return;
      let newBills = new BillsCollection(bData);
      await newBills.save(); // Save the new bill
      await logUserActivity(
        res.locals.user_id,
        org_id,
        bData.vendor_id,
        `Purchase order converted to Bill ${billUniqueId}`,
        "Purchase order to bill converstion",
        getPurchaseOrder._id,
        "purchase_order"
      );
      // Update the purchase order with the new bill ID
      await PurchaseOrderCollection.findOneAndUpdate(
        {
          admin_id: res.locals.user_id,
          org_id: org_id,
          purchase_number: po_id,
        },
        {
          $set: { status: 1, status_type: "CLOSED" },
          $push: { bills: { bill_ref_id: newBills._id } },
        }
      );
      return res.status(ST_CODES.OK).json({
        success: true,
        message: "Purchase order updated with new bill",
        data: newBills,
      });
    } catch (error) {
      console.log("updatePurchaseOrderToBill error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async getPurchaseOrderEmailDetails(req, res) {
    try {
      const { org_id } = req.query;
      const { po_id } = req.params;
      const token = req.headers.authorization;

      // Validate required parameters
      if (!org_id || !po_id || !token) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Missing required parameters: org_id, po_id, or token",
        });
      }

      console.log(`Fetching Purchase Order details for ID: ${po_id}`);

      // Fetch Purchase Order
      const purchaseOrder = await PurchaseOrderCollection.findOne({
        org_id: org_id,
        purchase_number: po_id,
        // admin_id: res.locals.user_id,
      });

      if (!purchaseOrder) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Purchase Order not found",
        });
      }

      if (!purchaseOrder.vendor_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Purchase order does not have a valid vendor_id",
        });
      }

      let organization = {};
      let vendorContact = {};

      try {
        let contact_id = purchaseOrder.vendor_id;
        let organization_id = org_id;

        // Fetch organization and vendor contact data in parallel
        const [organizationResponse, vendorContactResponse] = await Promise.all(
          [
            apiHandler.getOrganizationDetails(organization_id, token),
            apiHandler.getContactPersonInformation(
              contact_id,
              organization_id,
              token
            ),
          ]
        );

        if (organizationResponse?.data?.data) {
          organization = organizationResponse.data.data;
          console.log("✅ Organization data retrieved successfully.");
        } else {
          console.log("⚠️ Organization API returned empty data.");
        }

        if (vendorContactResponse?.data) {
          vendorContact = vendorContactResponse.data;
          console.log("✅ Vendor contact data retrieved successfully.");
        } else {
          console.log("⚠️ Vendor contact API returned empty data.");
        }
      } catch (error) {
        console.error(
          "❌ Error fetching organization or vendor details:",
          error.message
        );
        if (error.response) {
          console.error(
            "API response error:",
            error.response.status,
            error.response.data
          );
        }
      }
      const to_contact = Array.isArray(vendorContact?.data)
        ? vendorContact.data.map((contact) => ({
            contact_person_id: contact.contact_person_id || "",
            contact_id: contact.contact_id || "",
            organization_id: contact.organization_id || "",
            salutation: contact.salutation || "",
            first_name: contact.first_name || "",
            last_name: contact.last_name || "",
            email: contact.email || "",
            phone: contact.phone || "",
            mobile: contact.mobile || "",
            skype: contact.skype || "",
            department: contact.department || "",
            designation: contact.designation || "",
            is_primary_contact: contact.is_primary_contact || false,
            is_portal_invitation_accepted:
              contact.is_portal_invitation_accepted || false,
            contact_name: `${contact.salutation || ""} ${
              contact.first_name || ""
            } ${contact.last_name || ""}`.trim(),
          }))
        : [];

      // Extract orgemail_name details from organization
      const orgemail_name = Array.isArray(organization?.orgemail_name)
        ? organization.orgemail_name.map((emailData) => ({
            email: emailData.email || "",
            contact_name: emailData.contact_name || "",
          }))
        : [];

      // Get primary contact name or vendor name
      let vendorName = purchaseOrder.vendor_name || "";
      if (
        !vendorName &&
        Array.isArray(vendorContact?.data) &&
        vendorContact.data.length > 0
      ) {
        // Try to find primary contact
        const primaryContact = vendorContact.data.find(
          (c) => c.is_primary_contact
        );
        if (primaryContact) {
          vendorName =
            primaryContact.contact_name ||
            `${primaryContact.salutation || ""} ${
              primaryContact.first_name || ""
            } ${primaryContact.last_name || ""}`.trim();
        } else {
          // Use first contact if no primary
          vendorName =
            vendorContact.data[0].contact_name ||
            `${vendorContact.data[0].salutation || ""} ${
              vendorContact.data[0].first_name || ""
            } ${vendorContact.data[0].last_name || ""}`.trim();
        }
      }

      // Format date if available
      let formattedDate = "";
      if (purchaseOrder.date) {
        try {
          formattedDate = new Date(purchaseOrder.date).toLocaleDateString(
            "en-GB"
          );
        } catch (e) {
          console.error("Error formatting date:", e);
        }
      }

      // Format amount if available
      let formattedAmount = "";
      if (purchaseOrder.total) {
        try {
          formattedAmount = purchaseOrder.total.toLocaleString("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2,
          });
        } catch (e) {
          console.error("Error formatting amount:", e);
        }
      }

      const admin = await UserCollection.findOne(
        { _id: res.locals.user_id },
        { email: 1 }
      );

      // Prepare Email Details Object
      const emailDetails = {
        from_email: organization.email || admin ? admin.email : null,
        subject: `Purchase Order ${purchaseOrder.purchase_number} from ${
          organization.organization_name || ""
        }`,
        body: `Dear ${
          vendorName || "Vendor"
        },\n\nPlease find attached the purchase order ${
          purchaseOrder.purchase_number
        }.\n\nBest regards,\n${organization.organization_name || ""}`,
        vendor_name: vendorName,
        vendor_id: purchaseOrder.vendor_id || "",
        organization_name: organization.organization_name || "",
        organization_id: org_id,
        purchase_number: purchaseOrder.purchase_number || "",
        purchase_order_id: purchaseOrder._id,
        total: purchaseOrder.total || 0,
        amount_formatted: formattedAmount || "",
        date: purchaseOrder.date || purchaseOrder.createdAt || "",
        date_formatted: formattedDate || "",
        file_name: `PurchaseOrder-${purchaseOrder.purchase_number}`,
        file_name_without_extension: `PurchaseOrder-${purchaseOrder.purchase_number}.pdf`,
        orgemail_detail: orgemail_name,
        to_contact,
        entity_type: "purchaseorder",
      };

      console.log("✅ Email details successfully prepared");

      // Return the email details
      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Email details retrieved successfully",
        data: emailDetails,
      });
    } catch (error) {
      console.error("❌ getPurchaseOrderEmailDetails Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Something went wrong while fetching email details",
        error: error.message,
      });
    }
  }
  async  updatePurchaseOrderStatus(req, res) {
    try {
      const { org_id, po_id } = req.query;
      const { status } = req.body;

      if (!org_id || !po_id || !status) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      const updateFields = {
        status_updated_at: new Date(),
      };

      // Assign correct field updates based on status code
      switch (status) {
        case 0: // Open
          updateFields.status = "open";
          updateFields.status_formatted = "Open";
          break;

        case 1: // Draft
          updateFields.status = "draft";
          updateFields.status_formatted = "Draft";
          break;

        case 5: // Re-open
          updateFields.order_status = "reopen";
          updateFields.order_status_formatted = "Draft";
          break;

        case 2: // Void
          updateFields.order_status = "void";
          updateFields.order_status_formatted = "Void";
          break;

        case 3: // Paid
          updateFields.order_status = "paid";
          updateFields.order_status_formatted = "Paid";
          break;

        case 4: // Canceled
          updateFields.order_status = "canceled";
          updateFields.order_status_formatted = "Canceled";
          break;

        case 6: // Received
          updateFields.received_status = "received";
          updateFields.received_status_formatted = "Received";
          break;

        case 8: // Undo-mark as received
          updateFields.received_status = "undo-mark-as-received";
          updateFields.received_status_formatted = "Undo-mark as received";
          break;

        case 7: // Billed
          updateFields.billed_status = "billed";
          updateFields.billed_status_formatted = "Billed";
          break;

        case 9: // Re-open
          updateFields.order_status = "issued";
          updateFields.order_status_formatted = "Issued";
          break;

        default:
          return res.status(ST_CODES.BAD_REQUEST).send({
            status: false,
            message: "Invalid status code",
          });
      }

      // Perform the update
      const updatedOrder = await PurchaseOrderCollection.findOneAndUpdate(
        {
          purchase_number: po_id,
          org_id,
          deleted_at: null,
        },
        { $set: updateFields },
        { new: true }
      );

      if (!updatedOrder) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Purchase Order not found or unauthorized access",
        });
      }

      return res.status(ST_CODES.OK).send({
        status: true,
        message: "Purchase Order status updated successfully.",
        data: updatedOrder,
      });
    } catch (error) {
      console.error("updatePurchaseOrderStatus Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while updating purchase order status",
      });
    }
  }
  async removeDocumentFromPurchaseOrder(req, res) {
    try {
      const { org_id, po_id } = req.query;

      // Validate required parameters
      if (!org_id || !po_id) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameters: org_id or po_id",
        });
      }

      // Find the purchase order
      const purchaseOrder = await PurchaseOrderCollection.findOne({
        admin_id: res.locals.user_id,
        org_id: org_id,
        purchase_number: po_id,
      });

      // If PO not found
      if (!purchaseOrder) {
        return res.status(404).json({
          success: false,
          message: "Purchase Order not found",
        });
      }

      // If no document exists
      if (!purchaseOrder.documents || purchaseOrder.documents === "") {
        return res.status(404).json({
          success: false,
          message: "No document attached to remove",
        });
      }

      // Optional: Delete the physical file from disk
      const filePath = path.join(uploadDir, purchaseOrder.documents);

      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (!err) {
          // File exists, delete it
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error("Error deleting file from disk:", unlinkErr);
            } else {
              console.log(
                `File ${purchaseOrder.documents} deleted successfully`
              );
            }
          });
        } else {
          console.warn(
            `File ${purchaseOrder.documents} does not exist on disk`
          );
        }
      });

      // Update the documents field to empty string
      const updatedPO = await PurchaseOrderCollection.findOneAndUpdate(
        {
          admin_id: res.locals.user_id,
          org_id: org_id,
          purchase_number: po_id,
        },
        {
          $set: {
            documents: "", // Clear the document field
          },
        },
        { new: true }
      );

      return res.status(200).json({
        success: true,
        message: "Document removed successfully",
        data: updatedPO,
      });
    } catch (error) {
      console.error("removeDocumentFromPurchaseOrder error", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  }
  // 📌 Get Purchase Order unique ID
  async getUniqueId(req, res) {
    try {
      // Generate unique Purchase Order ID
      let poUniqueId = await commonHelper.generateUniqueId(
        PurchaseOrderCollection,
        "purchase_number",
        7,
        "PO"
      );
      // Send success response
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Purchase Order ID has been generated",
        data: poUniqueId,
      });
    } catch (err) {
      console.error("generatingPurchaseOrderId Error:", err);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while generating purchase order ID",
      });
    }
  }
}

module.exports = new purchaseOrderController();
