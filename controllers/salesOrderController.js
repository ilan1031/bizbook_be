const mongoose = require("mongoose");
const SalesOrderCollection = require("../model/salesOrder");
const OrganizationCollection = require("../model/organizationSchema");
const UserCollection = mongoose.model("user");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { default: axios } = require("axios");
const apiHandler = require("../handler/api-handler");
const constants = require("../config/constant");
const MESSAGES = require("../config/messages");
const { createSalesData } = require("../helpers/salesOrderHelper");
const InvoiceCollection = require("../model/invoice");
const { createInvoiceData } = require("../helpers/invoiceHelper");

class SalesOrderController {
  // 📝 Create a new sales order
  // async createSalesOrder(req, res) {
  //   try {
  //     let bData = req.body;
  //     console.log("bData in createSalesOrder:", bData);
  //     const { organization_id } = req.query;
  //     const { salesorder_number } = req.query;
  //     console.log(req.file, "req.file in createSalesOrder");
  //     if (req.file) {
  //       bData["documents"] = req.file.filename;
  //     }

  //     // Generate unique ID for sales order
  //     let salesOrderId = await commonHelper.generateUniqueId(
  //       SalesOrderCollection,
  //       "salesorder_id"
  //     );
  //     bData["salesorder_id"] = salesOrderId;
  //     bData["admin_id"] = res.locals.user_id;
  //     bData["organization_id"] = organization_id;
  //     bData["salesorder_number"] = bData.salesorder_number;
  //     // Set default status if not provided
  //     bData["status"] = bData.status || "draft";
  //     // Set dates
  //     const currentDate = new Date();
  //     bData["date"] = bData.date || currentDate.toISOString();

  //     // Calculate totals if not provided
  //     if (bData.line_items && bData.line_items.length > 0) {
  //       let subTotal = 0;

  //       // Calculate sub-total from line items
  //       bData.line_items.forEach((item) => {
  //         const lineTotal = (item.quantity || 0) * (item.rate || 0);
  //         item.item_total = lineTotal;
  //         item.item_total_formatted = `₹${lineTotal.toFixed(2)}`;
  //         subTotal += lineTotal;
  //       });

  //       bData["sub_total"] = subTotal;

  //       // Calculate tax amount if applicable
  //       const taxRate = bData.tax_percentage || 0;
  //       const taxAmount = (subTotal * taxRate) / 100;
  //       bData["tax_total"] = taxAmount;

  //       // Calculate discount if applicable
  //       const discountAmount = bData.discount_amount || 0;

  //       // Calculate final total
  //       bData["total"] = subTotal + taxAmount - discountAmount;
  //     }

  //     // Insert sales order
  //     let newSalesOrder = await queryHelper.insertData(
  //       SalesOrderCollection,
  //       bData
  //     );

  //     if (newSalesOrder.status) {
  //       res.status(ST_CODES.OK).send({
  //         status: newSalesOrder.status,
  //         message: "Sales Order created successfully",
  //         data: newSalesOrder.msg,
  //       });
  //     } else {
  //       res.status(ST_CODES.BAD_REQUEST).send({
  //         status: newSalesOrder.status,
  //         message: newSalesOrder.msg,
  //       });
  //     }
  //   } catch (error) {
  //     console.error("createSalesOrder Error:", error);
  //     res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
  //       status: false,
  //       message: "Something went wrong while creating sales order",
  //     });
  //   }
  // }

  async createSalesOrder(req,res){
    try{
      const salesData = await createSalesData(req,req.body);
      const savedSalesOrder = await new SalesOrderCollection (salesData).save();
      res.status(200).json({
        status:true,
        message:"Sales Order created successfully",
        data:savedSalesOrder,
      });
    }catch (error){
      console.error("createSalesOrder Error:", error);
      res.status(500).json({
        status:false,
        message:"Something went wrong while creating sales order",
        });
    }
  }

  // 📝 Get all sales orders with pagination
  async getSalesOrders(req, res) {
    try {
      let {
        limit = 10,
        page = 1,
        sort_column = "created_time",
        sort_order = "D",
        filter = "Status.All",
        customer_id = null, // Add support for customer_id filtering
      } = req.query;
      const { organization_id } = req.query;

      // Validate required parameters
      if (!organization_id) {
        return res.status(400).json({
          code: 1,
          message: "Missing required parameter: organization_id",
        });
      }

      // Convert limit and page to numbers
      limit = parseInt(limit, 10);
      page = parseInt(page, 10);

      // Define query conditions
      const query = {
        organization_id: organization_id,
        deleted_at: null, // Exclude soft-deleted sales orders
      };

      switch (filter) {
        case "Status.Draft":
          query.order_status = "draft";
          break;
        case "Status.Confirmed":
          query.order_status = "confirmed";
          break;
        case "Status.Void":
          query.order_status = "void";
          break;
        case "Status.Closed":
          query.order_status = "closed";
          break;
        case "Status.Invoiced":
          query.invoiced_status = "invoiced";
          break;
        case "Status.All":
        case "":
          // No additional filtering for 'All' or empty filter
          break;
        default:
          // Handle unknown filter or ignore
          break;
      }

      // Add customer_id filter if provided
      if (customer_id) {
        console.log(customer_id, "customer_idcustomer_id");
        query.customer_id = customer_id;
      }

      const allowedSortColumns = [
        "customer_name",
        "date",
        "createdAt",
        "reference_number",
        "salesorder_number",
        "total",
      ];

      // Define sorting order
      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      // Fetch specific fields
      const projection = {
        _id: 1,
        salesorder_id: 1,
        zcrm_potential_id: 1,
        zcrm_potential_name: 1,
        customer_id: 1,
        customer_name: 1,
        company_name: 1,
        status: 1,
        status_formatted: 1,
        order_status: 1,
        order_status_formatted: 1,
        invoiced_status: 1,
        invoiced_status_formatted: 1,
        paid_status: 1,
        paid_status_formatted: 1,
        color_code: 1,
        current_sub_status_id: 1,
        current_sub_status: 1,
        current_sub_status_formatted: 1,
        salesorder_number: 1,
        reference_number: 1,
        date: 1,
        date_formatted: 1,
        currency_id: 1,
        currency_code: 1,
        total: 1,
        total_formatted: 1,
        created_time: 1,
        last_modified_time: 1,
        accepted_date: 1,
        accepted_date_formatted: 1,
        declined_date: 1,
        declined_date_formatted: 1,
        expiry_date: 1,
        expiry_date_formatted: 1,
        has_attachment: 1,
        is_viewed_by_client: 1,
        client_viewed_time: 1,
        client_viewed_time_formatted: 1,
        is_emailed: 1,
        shipment_date_formatted: 1,
        shipment_date: 1,
        template_type: 1,
        template_id: 1,
        salesperson_id: 1,
        salesperson_name: 1,
        custom_field_hash: 1,
        tax_total: 1,
        tax_type: 1,
        adjustment: 1,
        documents: 1,
      };

      // Fetch sales orders with pagination & sorting
      const results = await queryHelper.findData(
        SalesOrderCollection,
        query,
        projection,
        sort,
        limit,
        page
      );

      // Check if sales orders exist
      const salesOrders = results?.status ? results.msg : [];
      const totalCount = await queryHelper.countDocuments(
        SalesOrderCollection,
        query
      );
      const hasMorePage = page * limit < totalCount;

      // Transform sales orders to match expected output
      const transformedSalesOrders = await Promise.all(
        salesOrders.map(async (salesOrder) => {
          // Extract the actual sales order object if it's a Mongoose document
          const salesOrderData = salesOrder._doc ? salesOrder._doc : salesOrder;

          let customer_name = salesOrderData.customer_name || "";
          let company_name = "";

          // Fetch customer details if customer_id is present
          if (salesOrderData.customer_id) {
            try {
              const [contactResponse] = await axios.all([
                apiHandler.getContactInformation(
                  salesOrderData.customer_id,
                  organization_id,
                  req.headers.authorization
                ),
              ]);

              if (contactResponse?.data?.data) {
                customer_name =
                  contactResponse.data.data.contact_name || customer_name;
                company_name = contactResponse.data.data.company_name || "";
              }
            } catch (error) {
              console.error(
                "Error fetching customer information:",
                error.message
              );
            }
          }

          return {
            salesorder_id: salesOrderData.salesorder_id || "",
            _id: salesOrderData._id || "",
            zcrm_potential_id: salesOrderData.zcrm_potential_id || "",
            zcrm_potential_name: salesOrderData.zcrm_potential_name || "",
            customer_id: salesOrderData.customer_id || "",
            customer_name: customer_name,
            company_name: company_name,
            status: salesOrderData.status || "",
            status_formatted: salesOrderData.status_formatted || "",
            order_status: salesOrderData.order_status || "",
            order_status_formatted: salesOrderData.order_status_formatted || "",
            invoiced_status: salesOrderData.invoiced_status || "",
            invoiced_status_formatted:
              salesOrderData.invoiced_status_formatted || "",
            paid_status: salesOrderData.paid_status || "",
            paid_status_formatted: salesOrderData.paid_status_formatted || "",
            color_code: salesOrderData.color_code || "",
            current_sub_status_id: salesOrderData.current_sub_status_id || "",
            current_sub_status: salesOrderData.current_sub_status || "",
            current_sub_status_formatted:
              salesOrderData.current_sub_status_formatted || "",
            salesorder_number: salesOrderData.salesorder_number || "",
            reference_number: salesOrderData.reference_number || "",
            date: salesOrderData.date || "",
            date_formatted: salesOrderData.date_formatted || "",
            currency_id: salesOrderData.currency_id || "",
            currency_code: salesOrderData.currency_code || "",
            total: salesOrderData.total || 0,
            total_formatted: salesOrderData.total_formatted || "",
            created_time: salesOrderData.created_time || "",
            last_modified_time: salesOrderData.last_modified_time || "",
            accepted_date: salesOrderData.accepted_date || "",
            accepted_date_formatted:
              salesOrderData.accepted_date_formatted || "",
            declined_date: salesOrderData.declined_date || "",
            declined_date_formatted:
              salesOrderData.declined_date_formatted || "",
            expiry_date: salesOrderData.expiry_date || "",
            expiry_date_formatted: salesOrderData.expiry_date_formatted || "",
            has_attachment: !!salesOrderData.has_attachment,
            is_viewed_by_client: !!salesOrderData.is_viewed_by_client,
            client_viewed_time: salesOrderData.client_viewed_time || "",
            client_viewed_time_formatted:
              salesOrderData.client_viewed_time_formatted || "",
            is_emailed: !!salesOrderData.is_emailed,
            template_type: salesOrderData.template_type || "",
            template_id: salesOrderData.template_id || "",
            shipment_date_formatted:
              salesOrderData.shipment_date_formatted || "",
            shipment_date: salesOrderData.shipment_date || "",
            salesperson_id: salesOrderData.salesperson_id || "",
            salesperson_name: salesOrderData.salesperson_name || "",
            custom_field_hash: salesOrderData.custom_field_hash || {},
            tax_total: salesOrderData.tax_total || 0,
            tax_type: salesOrderData.tax_type || "",
            adjustment: salesOrderData.adjustment || 0,
            documents: salesOrderData.documents,
          };
        })
      );

      // Construct response
      return res.status(200).json({
        code: 0,
        message: "success",
        salesorders: transformedSalesOrders,
        totalCount: totalCount,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage,
          report_name: "Sales Orders",
          applied_filter: filter,
          custom_fields: [],
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      console.error("getSalesOrders Error:", error.message);
      return res.status(500).json({
        code: 1,
        message:
          "Internal Server Error: Unable to fetch sales orders. Please try again later.",
      });
    }
  }

  // 📝 Get single sales order by ID
  async  getSalesOrderById(req, res) {
    try {
      const { organization_id } = req.query;
      const { salesorder_id } = req.params;
      // Validate required parameters
      if (!organization_id || !salesorder_id) {
        return res.status(400).json({
          status: false,
          message:
            "Missing required parameters: organization_id and salesorder_id",
        });
      }

      // Fetch Sales Order
      const salesOrder = await SalesOrderCollection.findOne({
        organization_id: organization_id,
        salesorder_id,
        deleted_at: null, // Ensure it's not soft-deleted
      }).lean();

      // Check if sales order exists
      if (!salesOrder) {
        return res.status(404).json({
          status: false,
          message: "Sales Order not found or unauthorized access",
        });
      }

      // Fetch Organization with better error handling
      let organization = null;
      try {
        organization = await OrganizationCollection.findOne(
          { organization_id },
          {
            name: 1,
            org_name: 1,
            first_street: 1,
            second_street: 1,
            city: 1,
            state: 1,
            zip: 1,
            country: 1,
            currency_code: 1,
            currency_symbol: 1,
            email: 1,
            phone: 1,
            address: 1,
            gst_number: 1,
            _id: 0, // Exclude _id field
          }
        ).lean();

        // Explicitly check if organization was found
        if (!organization) {
          //     return res.status(ST_CODES.ORG_NOT_FOUND).send({
          //       success: true,
          //       message: MESSAGES.ORG_NOT_FOUND,
          //     });
          //   }
          // } catch (dbError) {
          //   console.error("Organization Fetch Error:", dbError);
          //   return res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
          //     success: false,
          //     message: "Error fetching organization details",
          //   });
          console.warn(`Organization with ID ${organization_id} not found`);
        }
      } catch (dbError) {
        console.error("Organization Fetch Error:", dbError);
      }

      // Return success response with explicit logging
      console.log("Organization data:", organization);

      return res.status(200).json({
        status: true,
        message: "Sales order retrieved successfully",
        data: salesOrder,
        organization_details: organization || {},
      });
    } catch (error) {
      console.error("getSalesOrderById Error:", error.message);
      return res.status(500).json({
        status: false,
        message: "Internal server error while fetching sales order",
        error: error.message,
      });
    }
  }

  // 📝 Update sales order
  async updateSalesOrder(req, res) {
    try {
      const { organization_id, salesorder_id } = req.query;
      let updateData = { ...req.body };

      let documents = updateData.documents;

      if (req.file) {
        documents = req.file.filename;
      }

      updateData["documents"] = documents;

      // Validate required query params
      if (!organization_id || !salesorder_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      // Find existing sales order
      let salesOrder = await SalesOrderCollection.findOne({
        salesorder_id,
        organization_id,
        // admin_id: res.locals.user_id,
      });

      if (!salesOrder) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Unauthorized or sales order not found",
        });
      }

      // Recalculate totals if line items are updated
      if (updateData.line_items && updateData.line_items.length > 0) {
        let subTotal = 0;

        // Calculate sub-total from line items
        updateData.line_items.forEach((item) => {
          const lineTotal = (item.quantity || 0) * (item.rate || 0);
          item.item_total = lineTotal;
          subTotal += lineTotal;
        });

        updateData["sub_total"] = subTotal;

        // Calculate tax amount if applicable
        const taxRate =
          updateData.tax_percentage || salesOrder.tax_percentage || 0;
        const taxAmount = (subTotal * taxRate) / 100;
        updateData["tax_total"] = taxAmount;

        // Calculate discount if applicable
        const discountAmount =
          updateData.discount_amount || salesOrder.discount_amount || 0;

        // Calculate final total
        updateData["total"] = subTotal + taxAmount - discountAmount;
      }
      console.log(updateData.place_of_supply, "place_of_supply");

      // Perform the update
      let updatedSalesOrder = await SalesOrderCollection.findOneAndUpdate(
        { salesorder_id, organization_id },
        { $set: updateData },
        { new: true }
      );

      // Success Response
      return res.status(ST_CODES.OK).send({
        status: true,
        message: "Sales Order updated successfully",
        data: updatedSalesOrder,
      });
    } catch (error) {
      console.error("updateSalesOrder Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }

  // 📝 Delete sales order (soft delete)
  async deleteSalesOrder(req, res) {
    try {
      const { organization_id, salesorder_id } = req.query;
      const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!organization_id || !salesorder_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "organization_id and admin_id are required",
        });
      }

      // Find the sales order
      let salesOrder = await SalesOrderCollection.findOne({
        salesorder_id: salesorder_id,
        organization_id: organization_id,
        // admin_id: admin_id,
        deleted_at: null, // Ensure it's not already deleted
      });

      if (!salesOrder) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Sales Order not found for this organization",
        });
      }

      // Perform soft delete by setting deleted_at timestamp
      salesOrder.deleted_at = new Date();
      await salesOrder.save();

      res.status(ST_CODES.OK).send({
        status: true,
        message: "Sales Order deleted successfully", // soft delete
        data: salesOrder,
      });
    } catch (error) {
      console.error("deleteSalesOrder Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong",
      });
    }
  }

  // 📝 Convert sales order to invoice
  // :memo: Convert sales order to invoice
  async convertToInvoice(req, res) {
    try {
      const { organization_id, salesorder_id } = req.query;

      // Validate required parameters
      if (!organization_id || !salesorder_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "organization_id, salesorder_id, and admin_id are required",
        });
      }
      // Find the sales order
      let salesOrder = await SalesOrderCollection.findOne({
        salesorder_id: salesorder_id,
        organization_id: organization_id,
        deleted_at: null,
      });
      if (!salesOrder) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Sales Order not found for this organization",
        });
      }

      // Get the updated data from the frontend
      const updatedData = req.body;
      console.log(updatedData.invoice_number,"invoice_number")
      // Prepare invoice data
      const invoiceData = {
        ...salesOrder.toObject(), // Start with the original sales order data
        ...updatedData, // Override with updated fields from the frontend
        salesorder_id: salesOrder._id, // Link to the sales order
        invoice_number: updatedData.invoice_number, // Use the generated unique invoice_number
        status: updatedData.status, // Default status for the invoice
        status_formatted: updatedData.status_formatted, // Default status for the invoice
        date: updatedData.date || new Date().toISOString(), // Use current date if not provided
        due_date:
          updatedData.due_date ||
          salesOrder.due_date ||
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Use sales order due_date or 30 days from now
        organization_id: organization_id, // Include organization_id
      };

      // Remove unnecessary fields
      delete invoiceData._id; // Remove MongoDB _id
      delete invoiceData.__v; // Remove version key
      delete invoiceData.deleted_at; // Remove soft-delete field if present

      // Call the createInvoice API to create the invoice
      // const createInvoiceResponse = await axios.post(
      //   `${constants.SO_BACKEND_URL}/invoices?organization_id=${organization_id}`,
      //   invoiceData,
      //   {
      //     headers: {
      //       Authorization: req.headers.authorization, // Include the authorization token
      //     },
      //   }
      // );

      // // Extract the created invoice
      // const createdInvoice = createInvoiceResponse.data.data; // Ensure correct path to the invoice object
      const invoicePayload = await createInvoiceData(req, invoiceData);
      const createdInvoice = await new InvoiceCollection(invoicePayload).save();
      console.log(createdInvoice, "createdInvoice-response");
      if (!createdInvoice || !createdInvoice._id) {
        console.error("Invalid invoice response:", createInvoiceResponse.data);
        return res.status(500).send({
          status: false,
          message: "Failed to retrieve invoice details from the response",
        });
      }

      const invoiceMongoId = createdInvoice._id;

      // Update sales order fields
      salesOrder.order_status = "closed"; // Update status to indicate conversion
      salesOrder.order_status_formatted = "Closed"; // Update status to indicate conversion
      salesOrder.invoiced_status = "invoiced"; // Update status to indicate conversion
      salesOrder.invoiced_status_formatted = "Invoiced"; // Update status to indicate conversion
      salesOrder.invoice_conversion_type = "invoice";

      if (!Array.isArray(salesOrder.invoice_ids)) {
        salesOrder.invoice_ids = [];
      }
      salesOrder.invoice_ids.push(createdInvoice.invoice_id);

      if (!Array.isArray(salesOrder.invoices)) {
        salesOrder.invoices = [];
      }
      salesOrder.invoices.push({
        invoice_id: createdInvoice.invoice_id,
        invoice_number: createdInvoice.invoice_number, // Include the generated invoice_number
        status: createdInvoice.status,
        status_formatted: createdInvoice.status_formatted,
        balance: createdInvoice.balance,
        balance_formatted: createdInvoice.balance_formatted,
        date: createdInvoice.date,
        date_formatted: createdInvoice.date_formatted,
        due_date: createdInvoice.due_date,
        due_date_formatted: createdInvoice.due_date_formatted,
        due_days: createdInvoice.due_days,
        total: createdInvoice.total,
        total_formatted: createdInvoice.total_formatted,
      });

      salesOrder.invoiced_amount = salesOrder.total;
      // salesOrder.invoiced_amount_formatted = salesOrder.total_formatted;

      // Save the updated sales order
      await salesOrder.save();
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Sales Order converted to invoice successfully",
        data: {
          invoice: {
            salesorder_id: salesOrder.salesorder_id,
            invoice_id: createdInvoice.invoice_id, // This would come from the actual invoice creation
          },
        },
      });
    } catch (error) {
      console.error("convertToInvoice Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while converting sales order to invoice",
      });
    }
  }

  // 📝 Change sales order status
  async updateSalesOrderStatus(req, res) {
    try {
      const { organization_id, salesorder_id } = req.query;
      const {
        status,
        status_formatted,
        order_status,
        order_status_formatted,
        invoiced_status,
        invoiced_status_formatted,
        paid_status,
        paid_status_formatted,
      } = req.body;
      // const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!organization_id || !salesorder_id || !status || !status_formatted) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      // Validate status value
      const validStatuses = [
        "draft",
        "send",
        "accepted",
        "confirmed",
        "void",
        "closed",
        "declined",
        "expired",
        "invoiced",
        "not_invoiced",
        "unpaid",
        "paid",
        "open",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message:
            "Invalid status value. Must be one of: draft, sent, accepted, declined, expired",
        });
      }

      // Find and update the sales order
      const updatedSalesOrder = await SalesOrderCollection.findOneAndUpdate(
        {
          salesorder_id: salesorder_id,
          organization_id: organization_id,
          // admin_id: admin_id,
          deleted_at: null,
        },
        {
          $set: {
            status: status,
            status_formatted: status_formatted,
            order_status: order_status,
            order_status_formatted: order_status_formatted,
            invoiced_status: invoiced_status,
            invoiced_status_formatted: invoiced_status_formatted,
            paid_status: paid_status,
            paid_status_formatted: paid_status_formatted,
            status_updated_at: new Date(),
          },
        },
        { new: true }
      );

      if (!updatedSalesOrder) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Sales Order not found or unauthorized access",
        });
      }

      res.status(ST_CODES.OK).send({
        status: true,
        message: `The status of the Sales order has been changed to ${status_formatted}.`,
        data: {
          salesorder_id: updatedSalesOrder.salesorder_id,
          status: updatedSalesOrder.status_formatted,
        },
      });
    } catch (error) {
      console.error("updateSalesOrderStatus Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while updating sales order status",
      });
    }
  }

  // 📌 Get sales order unique ID
  async getUniqueId(req, res) {
    try {
      // Generate a unique sales order ID
      let salesOrderId = await commonHelper.generateUniqueId(
        SalesOrderCollection, // Use the SalesOrderCollection model
        "salesorder_number", // Field to ensure uniqueness
        6, // Length of the numeric part
        "SO" // Prefix for sales order numbers
      );
      // Send success response
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Sales Order ID has been generated",
        data: salesOrderId,
      });
    } catch (err) {
      console.error("generatingSalesOrderId Error:", err);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while generating sales order ID",
      });
    }
  }

  async getSalesOrderEmailDetails(req, res) {
    try {
      const { organization_id } = req.query;
      const { salesorder_id } = req.params;
      const token = req.headers.authorization;

      // Validate required parameters
      if (!organization_id || !salesorder_id || !token) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id, salesorder_id, or token",
        });
      }

      console.log(`Fetching Sales Order details for ID: ${salesorder_id}`);

      // Fetch Sales Order
      const salesOrder = await SalesOrderCollection.findOne({
        organization_id: organization_id,
        salesorder_id: salesorder_id,
      });

      if (!salesOrder) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Sales Order not found",
        });
      }

      if (!salesOrder.customer_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Sales order does not have a valid customer_id",
        });
      }

      let organization = {};
      let contactPerson = {};

      try {
        console.log("Fetching organization and contact person details...");

        // Fetch organization and contact person data in parallel
        const [organizationResponse, contactPersonResponse] = await Promise.all(
          [
            apiHandler.getOrganizationDetails(organization_id, token),
            apiHandler.getContactPersonInformation(
              salesOrder.customer_id,
              organization_id,
              token
            ),
          ]
        );

        if (organizationResponse?.data?.data) {
          organization = organizationResponse.data.data;
          console.log(
            "✅ Organization data retrieved successfully.",
            organization
          );
        } else {
          console.log("⚠️ Organization API returned empty data.");
        }

        if (contactPersonResponse?.data) {
          contactPerson = contactPersonResponse.data;
          console.log("✅ Contact person data retrieved successfully.");
        } else {
          console.log("⚠️ Contact person API returned empty data.");
        }
      } catch (error) {
        console.error(
          "❌ Error fetching organization or contact details:",
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

      // Extract relevant contact information (Ensure it's always an array)
      const to_contact = Array.isArray(contactPerson?.data)
        ? contactPerson.data.map((contact) => ({
            contact_person_id: contact.contact_person_id || "",
            contact_id: contact.contact_id || "",
            organization_id: contact.organization_id || "",
            salutation: contact.salutation || "",
            first_name: contact.first_name || "",
            last_name: contact.last_name || "",
            email: contact.email || "", // Ensure email is included here
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
        : []; // Default to empty array if not an array

      // Extract orgemail_name details from organization
      const orgemail_name = Array.isArray(organization?.orgemail_name)
        ? organization.orgemail_name.map((emailData) => ({
            email: emailData.email || "",
            contact_name: emailData.contact_name || "",
          }))
        : [];

      const admin = await UserCollection.findOne(
        { _id: res.locals.user_id },
        { email: 1 }
      );

      // Prepare Email Details Object
      const emailDetails = {
        from_email: organization.email || admin ? admin.email : null,
        subject: `Sales Order ${salesOrder.salesorder_number} from ${
          organization.organization_name || ""
        }`,
        body: `Dear ${
          salesOrder.customer_name
        },\n\nPlease find attached the sales order ${
          salesOrder.salesorder_number
        }.\n\nBest regards,\n${organization.organization_name || ""}`,
        customer_name: salesOrder.customer_name || "",
        customer_id: salesOrder.customer_id || "",
        organization_name: organization.organization_name || "",
        organization_id: organization_id,
        salesorder_number: salesOrder.salesorder_number || "",
        salesorder_id: salesOrder.salesorder_id,
        total: salesOrder.total || 0,
        total_formatted: salesOrder.total_formatted || "",
        date: salesOrder.date || "",
        date_formatted: salesOrder.date_formatted || "",
        file_name: salesOrder.salesorder_number,
        file_name_without_extension: `${salesOrder.salesorder_number}.pdf`,
        orgemail_detail: orgemail_name, // Include the correctly formatted orgemail_name array
        to_contact, // Include the contact list with emails
        status: salesOrder.order_status || "",
        entity_type: "salesorder",
      };

      console.log("✅ Email details successfully prepared:", emailDetails);

      // Return the email details
      res.status(ST_CODES.OK).json({
        status: true,
        message: "Email details retrieved successfully",
        data: emailDetails,
      });
    } catch (error) {
      console.error("❌ getSalesOrderEmailDetails Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Something went wrong while fetching email details",
        error: error.message,
      });
    }
  }
}

module.exports = new SalesOrderController();
