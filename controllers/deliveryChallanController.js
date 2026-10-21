// deliveryChallanController.js
const mongoose = require("mongoose");
const DeliveryChallan = require("../model/deliveryChallan");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");
const ST_CODES = require("../helpers/statusCodeHelpers");
const apiHandler = require("../handler/api-handler");
const { default: axios } = require("axios");
const constants = require("../config/constant");
const SalesOrderCollection = require("../model/salesOrder");
const Organization = require("../model/organizationSchema");
const { createInvoiceData, postInvoiceJournal } = require("../helpers/invoiceHelper");
const InvoiceCollection = require("../model/invoice");

class DeliveryChallanController {
  // 📝 Create a new delivery challan
  async createDeliveryChallan(req, res) {
    try {
      const { organization_id } = req.query;
      if (!organization_id) {
        return res.status(400).json({
          code: 1,
          message: "Organization ID is required",
        });
      }

      let documents = req.body.documents;
      if (req.file) {
        documents = req.file.filename;
      }

      // Extract required fields from request body
      const {
        customer_id,
        customer_name,
        date,
        line_items,
        adjustment,
        adjustment_description,
        shipping_address,
        notes,
        terms,
        created_by_id,
      } = req.body;

      // Validate required fields
      if (!customer_id || !date || !line_items || !line_items.length) {
        return res.status(400).json({
          code: 1,
          message: "Missing required fields",
        });
      }

      // Generate unique IDs
      const deliveryChallanUniqueId = await commonHelper.generateUniqueId(
        DeliveryChallan,
        "deliverychallan_id"
      );

      const deliveryChallanNumber = await commonHelper.generateUniqueId(
        DeliveryChallan,
        "deliverychallan_number",
        6,
        "DC"
      );

      // Process line items dynamically
      const processedLineItems = line_items.map((item, index) => ({
        line_item_id: `line_item_${index + 1}`, // Generate a unique line item ID
        item_id: item.item_id || "",
        name: item.name || "",
        description: item.description || "",
        item_order: index + 1,
        item_type: item.item_type || "",
        quantity: parseFloat(item.quantity) || 0,
        rate: parseFloat(item.rate) || 0,
        item_total: parseFloat(item.item_total) || 0,
        item_total_formatted: `₹${parseFloat(item.item_total).toFixed(2)}`,
        item_total_inclusive_of_tax:
          parseFloat(item.item_total_inclusive_of_tax) || 0,
        item_total_inclusive_of_tax_formatted: `₹${parseFloat(
          item.item_total_inclusive_of_tax
        ).toFixed(2)}`,
        is_invoiced: false,
        tags: [],
        image_name: "",
        image_type: "",
        item_custom_fields: [],
        quantity_invoiced: 0,
        quantity_returned: 0,
      }));

      // Construct delivery challan object dynamically
      const deliveryChallanData = {
        deliverychallan_id: deliveryChallanUniqueId,
        documents: [],
        crm_owner_id: req.body.crm_owner_id || "",
        crm_custom_reference_id: req.body.crm_custom_reference_id || "",
        zcrm_potential_id: req.body.zcrm_potential_id || "",
        zcrm_potential_name: req.body.zcrm_potential_name || "",
        deliverychallan_number: deliveryChallanNumber,
        date: date,
        date_formatted: new Date(date).toLocaleDateString(),
        is_pre_gst: req.body.is_pre_gst || false,
        invoice_conversion_type: req.body.invoice_conversion_type || "",
        challan_type: req.body.challan_type || "",
        challan_type_formatted: req.body.challan_type_formatted || "",
        reference_number: req.body.reference_number || "",
        customer_id: customer_id,
        customer_name: customer_name,
        contact_persons: req.body.contact_persons || [],
        currency_id: req.body.currency_id || "",
        currency_code: req.body.currency_code || "",
        currency_symbol: req.body.currency_symbol || "",
        exchange_rate: req.body.exchange_rate || 1.0,
        discount_amount_formatted: req.body.discount_amount_formatted || "",
        discount_amount: req.body.discount_amount || 0,
        discount: req.body.discount || "",
        discount_applied_on_amount_formatted: `₹${parseFloat(
          req.body.sub_total
        ).toFixed(2)}`,
        discount_applied_on_amount: req.body.sub_total,
        is_discount_before_tax: req.body.is_discount_before_tax || true,
        discount_type: req.body.discount_type || "",
        is_inclusive_tax: req.body.is_inclusive_tax || false,
        tax_rounding: req.body.tax_rounding || "",
        status: req.body.status || "",
        status_formatted: req.body.status_formatted || "",
        challan_status: req.body.challan_status || "",
        challan_status_formatted: req.body.challan_status_formatted || "",
        invoiced_status: req.body.invoiced_status || "",
        invoiced_status_formatted: req.body.invoiced_status_formatted || "",
        is_eway_bill_required: req.body.is_eway_bill_required || false,
        has_fulfilled_qty: req.body.has_fulfilled_qty || false,
        source: req.body.source || "",
        line_items: processedLineItems,
        sub_total: req.body.sub_total,
        sub_total_formatted: `₹${parseFloat(req.body.sub_total).toFixed(2)}`,
        sub_total_inclusive_of_tax: req.body.sub_total,
        sub_total_inclusive_of_tax_formatted: `₹${parseFloat(
          req.body.sub_total
        ).toFixed(2)}`,
        tax_total: req.body.tax_total || 0.0,
        tax_total_formatted: `₹${
          req.body.tax_amount
            ? parseFloat(req.body.tax_amount).toFixed(2)
            : "0.00"
        }`,
        total: req.body.total,
        total_formatted: `₹${parseFloat(req.body.total).toFixed(2)}`,
        adjustment: parseFloat(req.body.adjustment) || 0,
        adjustment_formatted: `₹${parseFloat(req.body.adjustment || 0).toFixed(
          2
        )}`,
        adjustment_description: adjustment_description || "",
        transaction_rounding_type:
          req.body.transaction_rounding_type || "no_rounding",
        taxes: req.body.taxes || [],
        price_precision: req.body.price_precision || 2,
        comments: [
          {
            description: `Delivery Challan created for ₹${parseFloat(
              req.body.total
            ).toFixed(2)}`,
            commented_by_id: created_by_id || "",
            commented_by: req.body.commented_by || "",
            comment_type: req.body.comment_type || "system",
            date: new Date().toISOString(),
            date_formatted: new Date().toLocaleString(),
            date_description: "few seconds ago",
            time: new Date().toLocaleTimeString(),
            operation_type: req.body.operation_type || "Added",
            transaction_id: req.body.transaction_id || "",
            transaction_type: req.body.transaction_type || "deliverychallan",
          },
        ],
        invoices: req.body.invoices || [],
        shipping_address: shipping_address || {
          address: "",
          street2: "",
          city: "",
          state: "",
          zip: "",
          country: "",
          fax: "",
          phone: "",
          attention: "",
        },
        ewaybills: req.body.ewaybills || [],
        notes: notes || "",
        terms: terms || "",
        has_qty_returned: req.body.has_qty_returned || false,
        custom_fields: req.body.custom_fields || [],
        custom_field_hash: req.body.custom_field_hash || {},
        template_id: req.body.template_id || "",
        template_name: req.body.template_name || "",
        page_width: req.body.page_width || "",
        page_height: req.body.page_height || "",
        orientation: req.body.orientation || "",
        template_type: req.body.template_type || "",
        template_type_formatted: req.body.template_type_formatted || "",
        created_time: new Date().toISOString(),
        last_modified_time: new Date().toISOString(),
        created_by_id: created_by_id || "",
        attachment_name: req.body.attachment_name || "",
        organization_id: organization_id,
        place_of_supply: req.body.place_of_supply,
        challan_type: req.body.challan_type,
        challan_type_formatted: req.body.challan_type_formatted,
        tds_option: req.body.tds_option,
        tax_type: req.body.tax_type,
        tax_percentage: req.body.tax_percentage,
        discount_percent: req.body.discount_percent,
        documents: documents,
      };

      // Insert into database
      const savedChallan = await DeliveryChallan.create(deliveryChallanData);

      return res.status(201).json({
        code: 0,
        message: "Delivery Challan has been created.",
        deliverychallan: savedChallan,
        status: true,
      });
    } catch (error) {
      console.error("Error creating delivery challan:", error);
      return res.status(500).json({
        code: 1,
        message: "Failed to create delivery challan",
        error: error.message,
        status: false,
      });
    }
  }
  // 📝 Get all delivery challans with pagination
  async getDeliveryChallans(req, res) {
    try {
      let {
        limit = 25,
        page = 1,
        sort_column = "date",
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
        deleted_at: null, // Exclude soft-deleted delivery challans
      };

      // Add status filter if provided
      switch (filter) {
        case "Status.Draft":
          query.status = "draft";
          break;
        case "Status.Delivered":
          query.status = "delivered";
          break;
        case "Status.Open":
          query.status = "open";
          break;
        case "Status.Returned":
          query.status = "returned";
          break;
        case "Status.Invoiced":
          query.invoiced_status = "invoiced";
          break;
        case "Status.PartiallyInvoiced":
          query.invoiced_status = "partially_invoiced";
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
        console.log(customer_id, "customer_id");
        query.customer_id = customer_id;
      }

      const allowedSortColumns = [
        "customer_name",
        "date",
        "deliverychallan_number",
        "total",
      ];

      // Define sorting order
      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "date";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      // Fetch specific fields
      const projection = {
        _id: 1,
        deliverychallan_id: 1,
        deliverychallan_number: 1,
        reference_number: 1,
        date: 1,
        date_formatted: 1,
        customer_id: 1,
        customer_name: 1,
        company_name: 1,
        status: 1,
        status_formatted: 1,
        invoiced_status: 1,
        invoiced_status_formatted: 1,
        currency_id: 1,
        currency_code: 1,
        total: 1,
        total_formatted: 1,
        created_time: 1,
        last_modified_time: 1,
        has_attachment: 1,
        is_viewed_by_client: 1,
        client_viewed_time: 1,
        client_viewed_time_formatted: 1,
        is_emailed: 1,
        template_type: 1,
        template_id: 1,
        salesperson_id: 1,
        salesperson_name: 1,
        custom_field_hash: 1,
        tax_total: 1,
        tax_type: 1,
        adjustment: 1,
        place_of_supply: 1,
        documents: 1,
      };

      // Fetch delivery challans with pagination & sorting
      const results = await queryHelper.findData(
        DeliveryChallan,
        query,
        projection,
        sort,
        limit,
        page
      );

      // Check if delivery challans exist
      const deliveryChallans = results?.status ? results.msg : [];
      const totalCount = await queryHelper.countDocuments(
        DeliveryChallan,
        query
      );
      const hasMorePage = page * limit < totalCount;

      // Transform delivery challans to match expected output
      const transformedDeliveryChallans = await Promise.all(
        deliveryChallans.map(async (challan) => {
          // Extract the actual delivery challan object if it's a Mongoose document
          const challanData = challan._doc ? challan._doc : challan;

          let customer_name = challanData.customer_name || "";
          let company_name = "";

          // Fetch customer details if customer_id is present
          if (challanData.customer_id) {
            try {
              const [contactResponse] = await axios.all([
                apiHandler.getContactInformation(
                  challanData.customer_id,
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
            deliverychallan_id: challanData.deliverychallan_id || "",
            _id: challanData._id || "",
            deliverychallan_number: challanData.deliverychallan_number || "",
            reference_number: challanData.reference_number || "",
            date: challanData.date || "",
            date_formatted: challanData.date_formatted || "",
            customer_id: challanData.customer_id || "",
            customer_name: customer_name,
            company_name: company_name,
            status: challanData.status || "",
            status_formatted: challanData.status_formatted || "",
            invoiced_status: challanData.invoiced_status || "",
            invoiced_status_formatted:
              challanData.invoiced_status_formatted || "",
            currency_id: challanData.currency_id || "",
            currency_code: challanData.currency_code || "",
            total: challanData.total || 0,
            total_formatted: challanData.total_formatted || "",
            created_time: challanData.created_time || "",
            last_modified_time: challanData.last_modified_time || "",
            has_attachment: !!challanData.has_attachment,
            is_viewed_by_client: !!challanData.is_viewed_by_client,
            client_viewed_time: challanData.client_viewed_time || "",
            client_viewed_time_formatted:
              challanData.client_viewed_time_formatted || "",
            is_emailed: !!challanData.is_emailed,
            template_type: challanData.template_type || "",
            template_id: challanData.template_id || "",
            salesperson_id: challanData.salesperson_id || "",
            salesperson_name: challanData.salesperson_name || "",
            custom_field_hash: challanData.custom_field_hash || {},
            tax_total: challanData.tax_total || 0,
            tax_type: challanData.tax_type || "",
            adjustment: challanData.adjustment || 0,
            documents: challanData.documents || null,
          };
        })
      );

      // Construct response
      return res.status(200).json({
        code: 0,
        message: "success",
        deliverychallans: transformedDeliveryChallans,
        totalCount: totalCount,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage,
          report_name: "Delivery Challans",
          applied_filter: filter,
          custom_fields: [],
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      console.error("getDeliveryChallans Error:", error.message);
      return res.status(500).json({
        code: 1,
        message:
          "Internal Server Error: Unable to fetch delivery challans. Please try again later.",
      });
    }
  }
  // 📝 Get single delivery challan by ID
  async getDeliveryChallanById(req, res) {
    try {
      const { organization_id } = req.query;
      const { deliverychallan_id } = req.params;

      // Fetch the delivery challan from the database
      const deliveryChallan = await DeliveryChallan.findOne({
        organization_id: organization_id,
        deliverychallan_id: deliverychallan_id,
      });

      // Check if the delivery challan exists
      if (!deliveryChallan) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Delivery Challan not found or unauthorized access",
        });
      }

      // Fetch organization details
      const org_details = await Organization.findOne({ organization_id });

      // Return the delivery challan data with organizationData
      res.status(ST_CODES.OK).send({
        status: true,
        data: deliveryChallan,
        organizationData: org_details, // this is the additional key
      });
    } catch (error) {
      console.error("getDeliveryChallanById Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong",
      });
    }
  }
  // 📝 Update delivery challan
  async updateDeliveryChallan(req, res) {
    try {
      const { organization_id, deliverychallan_id } = req.query;
      let updateData = { ...req.body };

      // Validate required query parameters
      if (!organization_id || !deliverychallan_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message:
            "Missing required parameters: organization_id or deliverychallan_id",
        });
      }

      // Find existing delivery challan
      let deliveryChallan = await DeliveryChallan.findOne({
        deliverychallan_id,
        organization_id,
        deleted_at: null, // Ensure it's not soft-deleted
      });

      if (!deliveryChallan) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Unauthorized or delivery challan not found",
        });
      }

      // Perform the update
      let updatedDeliveryChallan = await DeliveryChallan.findOneAndUpdate(
        { deliverychallan_id, organization_id },
        { $set: updateData },
        { new: true } // Return the updated document
      );

      // Success Response
      return res.status(ST_CODES.OK).send({
        status: true,
        message: "Delivery Challan updated successfully",
        data: updatedDeliveryChallan,
      });
    } catch (error) {
      console.error("updateDeliveryChallan Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }
  // 📝 Delete delivery challan (soft delete)
  async deleteDeliveryChallan(req, res) {
    try {
      const { organization_id, deliverychallan_id } = req.query;

      // Validate required parameters
      if (!organization_id || !deliverychallan_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and deliverychallan_id",
        });
      }

      console.log("Input Parameters:", { organization_id, deliverychallan_id });

      // Convert deliverychallan_id and organization_id to strings to match database format
      const formattedDeliveryChallanId = String(deliverychallan_id);
      const formattedOrganizationId = String(organization_id);

      // Find the delivery challan
      let deliveryChallan = await DeliveryChallan.findOne({
        deliverychallan_id: formattedDeliveryChallanId, // Ensure query uses the correct format
        organization_id: formattedOrganizationId,
        deleted_at: null, // Ensure it's not already soft-deleted
      });

      if (!deliveryChallan) {
        console.warn("Delivery Challan not found for the given parameters:", {
          organization_id: formattedOrganizationId,
          deliverychallan_id: formattedDeliveryChallanId,
        });
        return res.status(404).json({
          code: 1,
          message: "Delivery Challan not found for this organization",
        });
      }

      // Perform soft delete by setting deleted_at timestamp
      deliveryChallan.deleted_at = new Date();
      await deliveryChallan.save();

      // Check if the delivery challan is linked to a sales order (has salesorder_id)
      if (deliveryChallan.salesorder_id) {
        // Validate salesorder_id to ensure it's a valid ObjectId
        if (mongoose.Types.ObjectId.isValid(deliveryChallan.salesorder_id)) {
          const salesOrder = await SalesOrderCollection.findById(
            deliveryChallan.salesorder_id
          );

          if (salesOrder) {
            // Remove the deleted delivery challan's ID from the delivery_challan_ids array
            salesOrder.delivery_challan_ids =
              salesOrder.delivery_challan_ids.filter(
                (id) => id !== deliveryChallan.deliverychallan_id
              );

            // Remove the deleted delivery challan's details from the delivery_challans array
            salesOrder.delivery_challans = salesOrder.delivery_challans.filter(
              (dc) =>
                dc.deliverychallan_id !== deliveryChallan.deliverychallan_id
            );

            // Check if this is the last delivery challan created by the sales order
            if (salesOrder.delivery_challan_ids.length === 0) {
              // Restore the original status of the sales order
              salesOrder.status = salesOrder.current_sub_status || "draft";
              salesOrder.status_formatted =
                salesOrder.current_sub_status_formatted || "Draft";

              // Clear the delivered amount fields
              salesOrder.delivered_amount = null;
              salesOrder.delivered_amount_formatted = null;

              // Optionally, clear current_sub_status and current_sub_status_formatted
              salesOrder.current_sub_status = null;
              salesOrder.current_sub_status_formatted = null;
            }

            // Save the updated sales order
            await salesOrder.save();
          } else {
            console.warn(
              `Sales Order with ID ${deliveryChallan.salesorder_id} not found.`
            );
          }
        } else {
          console.warn(
            `Invalid salesorder_id (${deliveryChallan.salesorder_id}) for delivery challan ${deliveryChallan.deliverychallan_id}. Skipping sales order update.`
          );
        }
      } else {
        console.log(
          "This is a direct delivery challan. No sales order to update."
        );
      }

      // Success Response
      return res.status(200).json({
        code: 0,
        message: "Delivery Challan deleted successfully", // Soft delete
        deliverychallan: deliveryChallan,
      });
    } catch (error) {
      console.error("deleteDeliveryChallan Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to delete delivery challan",
      });
    }
  }
  // get deliveryChallan unique Id
  async getUniqueId(req, res) {
    try {
      let deliverychallanId = await commonHelper.generateUniqueId(
        DeliveryChallan,
        "deliverychallan_number",
        6,
        "DC"
      );
      res.status(ST_CODES.OK).send({
        status: true,
        message: "challan Id has been generated",
        data: deliverychallanId,
      });
    } catch (err) {
      console.error("generatingChallanId Error:", err);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while generating challan id",
      });
    }
  }
  async updateChallanStatus(req, res) {
    try {
      const { organization_id, deliverychallan_id } = req.query;
      let { status, status_formatted, invoiced_status } = req.body;

      // Validate required parameters
      if (
        !organization_id ||
        !deliverychallan_id ||
        !status ||
        !status_formatted
      ) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      // Validate status value
      const validStatuses = ["draft", "open", "delivered", "returned"];
      if (!validStatuses.includes(status.toLowerCase())) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message:
            "Invalid status value. Must be one of: draft, open, delivered, returned",
        });
      }

      // Prepare update object
      const updateObj = {
        status,
        status_formatted,
        status_updated_at: new Date(),
      };

      // Only add invoice_status fields if invoice_status is an empty string
      if (invoiced_status === "") {
        updateObj.invoiced_status = "not_invoiced";
        updateObj.invoiced_status_formatted = "Not Invoiced";
      }

      // Update delivery challan
      const updatedChallan = await DeliveryChallan.findOneAndUpdate(
        {
          deliverychallan_id,
          organization_id,
          deleted_at: null,
        },
        { $set: updateObj },
        { new: true }
      );

      if (!updatedChallan) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Challan not found or unauthorized access",
        });
      }

      res.status(ST_CODES.OK).send({
        status: true,
        message: `Challan status updated to ${status} successfully`,
        data: {
          deliverychallan_id: updatedChallan.deliverychallan_id,
          status: updatedChallan.status,
        },
      });
    } catch (error) {
      console.error("updateChallanStatus Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while updating challan status",
      });
    }
  }
  //Convert to Invoice
  async convertToInvoice(req, res) {
    try {
      const { organization_id, deliverychallan_id } = req.query;

      // Validate required parameters
      if (!organization_id || !deliverychallan_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "organization_id and deliverychallan_id are required",
        });
      }
      // Find the Delivery Challan
      let challan = await DeliveryChallan.findOne({
        deliverychallan_id: deliverychallan_id,
        organization_id: organization_id,
        deleted_at: null,
      });
      if (!challan) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Delivery Challan not found for this organization",
        });
      }
      // Get the updated data from the frontend
      const updatedData = req.body;
      const invoiceData = {
        ...challan.toObject(), // Start with the original sales order data
        ...updatedData, // Override with updated fields from the frontend
        salesorder_id: challan._id, // Link to the sales order
        invoice_number: updatedData.invoice_number, // Use the generated unique invoice_number
        status: updatedData.status, // Default status for the invoice
        date: updatedData.date || new Date().toISOString(), // Use current date if not provided
        due_date:
          updatedData.due_date ||
          challan.expiry_date ||
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Use sales order due_date or 30 days from now
        organization_id: organization_id, // Include organization_id
      };

      // Remove unnecessary fields
      delete invoiceData._id; // Remove MongoDB _id
      delete invoiceData.__v; // Remove version key
      delete invoiceData.deleted_at; // Remove soft-delete field if present
      console.log("createInvoiceResponse7890", invoiceData);

      // const createInvoiceResponse = await axios.post(
      //   `${constants.SO_BACKEND_URL}/invoices?organization_id=${organization_id}`,
      //   invoiceData,
      //   {
      //     headers: {
      //       Authorization: req.headers.authorization, // Include the authorization token
      //     },
      //   }
      // );

      // console.log("createInvoiceResponse", createInvoiceResponse.data);

      // // Extract the created invoice
      // const createdInvoice = createInvoiceResponse.data.data;
      const invoicePayload = await createInvoiceData(req, invoiceData);
      const createdInvoice = await new InvoiceCollection(invoicePayload).save();
      await postInvoiceJournal(createdInvoice);
      if (!createdInvoice || !createdInvoice._id) {
        console.error("Invalid invoice response:", createInvoiceResponse.data);
        return res.status(500).send({
          status: false,
          message: "Failed to retrieve invoice details from the response",
        });
      }
      if (challan.status === "draft") {
        challan.status = "open";
        challan.status_formatted = "Open";
      }
      challan.invoiced_status = "invoiced";
      challan.invoiced_status_formatted = "Invoiced";
      challan.invoice_conversion_type = "invoice";

      if (!Array.isArray(challan.invoices)) {
        challan.invoices = [];
      }
      challan.invoices.push({
        invoice_id: createdInvoice.invoice_id,
        invoice_number: createdInvoice.invoice_number,
        status: createdInvoice.status,
        status_formatted: createdInvoice.status_formatted,
        balance: createdInvoice.balance,
        balance_formatted: createdInvoice.balance_formatted,
        date: createdInvoice.date,
        date_formatted: createdInvoice.date_formatted,
        due_date: createdInvoice.due_date,
        due_date_formatted: createdInvoice.due_date_formatted,
        total: createdInvoice.total,
        total_formatted: createdInvoice.total_formatted,
      });
      console.log(challan, "challan");
      // Save the updated sales order
      await challan.save();
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Delivery Challan converted to invoice successfully",
        data: {
          invoice: {
            invoice_id: createdInvoice.invoice_id,
            deliverychallan_id: challan.deliverychallan_id,
          },
        },
      });
    } catch (error) {
      console.error("convertToInvoice Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message:
          "Something went wrong while converting Delivery Challan to invoice",
      });
    }
  }
}

module.exports = new DeliveryChallanController();
