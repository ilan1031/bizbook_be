// estimateController.js
const mongoose = require("mongoose");
// const EstimateCollection = mongoose.model("Estimate");
const EstimateCollection = require("../model/quotes");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");
const ST_CODES = require("../helpers/statusCodeHelpers");
const apiHandler = require("../handler/api-handler");
const { default: axios } = require("axios");
const constants = require("../config/constant");
const SalesOrderCollection = require("../model/salesOrder");
const InvoiceCollection = require("../model/invoice");
const UserCollection = mongoose.model("user");
const OrganizationCollection = require("../model/organizationSchema");
const { createInvoiceData } = require("../helpers/invoiceHelper");
function createComments(
  commented_by,
  commented_by_id,
  comment_type,
  id,
  description,
  operation_type = "",
  transaction_id = "",
  transaction_type = ""
) {
  const now = new Date();
  const date = now.toISOString().split("T")[0]; // yyyy-mm-dd
  const formattedDate = now.toLocaleDateString("en-GB"); // dd/mm/yyyy
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }); // e.g. 10:30 AM
  const formattedDateTime = `${formattedDate} ${time}`;

  const commentData = {
    comment_id: new mongoose.Types.ObjectId(), // generate ObjectId
    estimate_id: id,
    description: description,
    commented_by_id: commented_by_id,
    commented_by: commented_by,
    comment_type: comment_type,
    date: date,
    date_formatted: formattedDateTime,
    time: time,
    operation_type: operation_type,
    transaction_id: transaction_id,
    transaction_type: transaction_type,
    sentiment: "none", // fixed string instead of undefined variable
  };

  return commentData;
}

// Helper function to format currency
const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return "₹0.00";
  return `₹${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

class EstimateController {
  // 📌 Create a new estimate
  async createEstimate(req, res) {
    try {
      const { organization_id } = req.query;
      if (!organization_id) {
        return res.status(400).json({
          status: false,
          message: "Organization ID is required",
        });
      }
      let documents = req.body.documents;
      if (req.file) {
        documents = req.file.filename;
      }

      const {
        customer_id,
        customer_name,
        estimate_number,
        date,
        date_formatted,
        expiry_date,
        expiry_date_formatted,
        billing_address,
        shipping_address,
        line_items,
        tax_type,
        tax_percentage,
        tds_option,
        sub_total,
        sub_total_formatted,
        tax_amount,
        tax_amount_formatted,
        total,
        total_formatted,
        adjustment,
        status,
        status_formatted,
        reference_number,
        salesperson_name,
        salesperson_id,
        project_id,
        notes,
        terms,
        tax_id,
        discount_amount,
        discount_amount_formatted,
        discount_percent,
        tax_total,
        tax_total_formatted,
        place_of_supply,
      } = req.body;

      if (!customer_id || !date || !line_items || !line_items.length) {
        return res.status(400).json({
          status: false,
          message: "Missing required fields",
        });
      }

      let quoteUniqueId = await commonHelper.generateUniqueId(
        EstimateCollection,
        "quote_id"
      );

      const processedLineItems = line_items.map((item) => ({
        item_id: item.item_id || null,
        name: item.name,
        description: item.description || "",
        quantity: parseFloat(item.quantity) || 0,
        rate: parseFloat(item.rate) || 0,
        discount: parseFloat(item.discount) || 0,
        tax_percentage: parseFloat(item.tax_percentage) || 0,
        item_total: parseFloat(item.item_total) || 0,
        item_total_formatted: `₹${parseFloat(item.item_total).toFixed(2)}` || 0,
        unit: item.unit || "",
      }));

      // Create system comment for quote creation
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.org_name || "System"; // fallback if user not found
      const description = `Quote created for ${
        total_formatted || `₹${parseFloat(total).toFixed(2)}`
      }`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        quoteUniqueId,
        description,
        "Added", // operation_type
        "", // transaction_id
        "estimate"
      );

      const estimateData = {
        organization_id,
        quote_id: quoteUniqueId,
        customer_id,
        estimate_number,
        customer_name,
        date,
        date_formatted,
        expiry_date,
        expiry_date_formatted,
        billing_address: billing_address || "",
        shipping_address: shipping_address || "",
        reference_number: reference_number || "",
        salesperson_name: salesperson_name || "",
        salesperson_id: salesperson_id || "",
        project_id: project_id || null,
        notes: notes || "",
        terms: terms || "",
        line_items: processedLineItems,
        sub_total: parseFloat(sub_total) || 0,
        sub_total_formatted,
        tax_type: tax_type || "TDS",
        tax_percentage: parseFloat(tax_percentage) || 0,
        tds_option: tds_option || "",
        adjustment: parseFloat(adjustment) || 0,
        total: parseFloat(total) || 0,
        total_formatted,
        status: status || "draft",
        status_formatted: status_formatted || "Draft",
        created_by: commented_by_id,
        created_at: new Date(),
        updated_at: new Date(),
        tax_id,
        discount_amount,
        discount_amount_formatted,
        discount_percent,
        tax_total,
        tax_total_formatted,
        place_of_supply,
        comments: [comment],
        documents, // attach system comment
      };

      const estimate = await queryHelper.insertData(
        EstimateCollection,
        estimateData
      );

      return res.status(201).json({
        status: true,
        message: "Estimate created successfully",
        data: estimate,
      });
    } catch (error) {
      console.error("Error creating estimate:", error);
      return res.status(500).json({
        status: false,
        message: "Failed to create estimate",
        error: error.message,
      });
    }
  }

  // 📌 Get all estimates with pagination
  // async getEstimates(req, res) {
  //   try {
  //     console.log("Fetching Estimates...");
  //     let { limit = 25, page = 1, sort_column = "created_time", sort_order = "D", filter = "Status.All" } = req.query;
  //     const { organization_id } = req.query;

  //     // Validate required parameters
  //     if (!organization_id) {
  //       return res.status(400).json({
  //         status: false,
  //         message: "Missing required parameter: organization_id",
  //       });
  //     }

  //     // Convert limit and page to numbers
  //     limit = parseInt(limit, 10);
  //     page = parseInt(page, 10);

  //     // Define query conditions
  //     const query = {
  //       organization_id: organization_id,
  //       deleted_at: null, // Exclude soft-deleted estimates
  //     };

  //     // Add status filter if provided
  //     if (filter && filter.startsWith("Status.")) {
  //       const status = filter.split(".")[1].toLowerCase();
  //       if (status !== "all") {
  //         query.status = status;
  //       }
  //     }

  //     // Define sorting order
  //     const sort = {};
  //     if (sort_column && sort_order) {
  //       sort[sort_column] = sort_order.toUpperCase() === "D" ? -1 : 1;
  //     } else {
  //       sort["created_time"] = -1; // Default sorting
  //     }

  //     // Fetch specific fields
  //     const gets = {
  //       quote_id: 1,
  //       zcrm_potential_id: 1,
  //       zcrm_potential_name: 1,
  //       customer_name: 1,
  //       customer_id: 1,
  //       status: 1,
  //       status_formatted: 1,
  //       color_code: 1,
  //       current_sub_status_id: 1,
  //       current_sub_status: 1,
  //       current_sub_status_formatted: 1,
  //       estimate_number: 1,
  //       reference_number: 1,
  //       date: 1,
  //       date_formatted: 1,
  //       currency_id: 1,
  //       currency_code: 1,
  //       total: 1,
  //       total_formatted: 1,
  //       created_time: 1,
  //       last_modified_time: 1,
  //       accepted_date: 1,
  //       accepted_date_formatted: 1,
  //       declined_date: 1,
  //       declined_date_formatted: 1,
  //       expiry_date: 1,
  //       expiry_date_formatted: 1,
  //       has_attachment: 1,
  //       is_viewed_by_client: 1,
  //       client_viewed_time: 1,
  //       client_viewed_time_formatted: 1,
  //       is_emailed: 1,
  //       template_type: 1,
  //       template_id: 1,
  //       salesperson_id: 1,
  //       salesperson_name: 1,
  //       cf_company_name: 1,
  //       cf_company_name_unformatted: 1,
  //     };

  //     // Fetch estimates with pagination & sorting
  //     const results = await queryHelper.findData(
  //       EstimateCollection,
  //       query,
  //       gets,
  //       sort,
  //       limit,
  //       page
  //     );

  //     // Check if estimates exist
  //     const estimates = results?.status ? results.msg : [];
  //     const totalEstimates = estimates.length;

  //     // Count total matching documents
  //     const totalCount = await queryHelper.countDocuments(EstimateCollection, query);
  //     const hasMorePage = page * limit < totalCount;

  //     // Construct response
  //     return res.status(200).json({
  //       status: true,
  //       message: "Estimates retrieved successfully.",
  //       estimates: estimates,
  //       page_context: {
  //         page: page,
  //         per_page: limit,
  //         has_more_page: hasMorePage,
  //         report_name: "Quotes",
  //         applied_filter: filter,
  //         custom_fields: [],
  //         sort_column: sort_column,
  //         sort_order: sort_order,
  //       },
  //     });
  //   } catch (error) {
  //     console.error("getEstimates Error:", error.message);
  //     return res.status(500).json({
  //       status: false,
  //       message: "Internal Server Error: Unable to fetch estimates. Please try again later.",
  //     });
  //   }
  // }
  // 📌 Get all estimates with pagination
  async getEstimates(req, res) {
    try {
      let {
        page = 1,
        per_page = 10,
        limit = 10,
        filter = "",
        sort_column = "created_time",
        sort_order = "D",
        organization_id,
        customer_id = null,
      } = req.query;

      const admin_id = res.locals.user_id;

      if (!admin_id || !organization_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }

      // Convert types
      page = parseInt(page, 10);
      limit = parseInt(limit, 10);

      // Base query
      const query = {
        organization_id: organization_id,
        deleted_at: null,
      };

      if (customer_id !== null) {
        query.customer_id = customer_id;
      }

      // Apply status-based filters
      switch (filter) {
        case "Status.Draft":
          query.status = "draft";
          break;
        case "Status.Sent":
          query.status = "sent";
          break;
        case "Status.Viewed":
          query.status = "customer viewed";
          break;
        case "Status.Approved":
          query.status = "approved";
          break;
        case "Status.Pending":
          query.status = "pending approval";
          break;
        case "Status.Accepted":
          query.status = "accepted";
          break;
        case "Status.Invoiced":
          query.status = "invoiced";
          break;
        case "Status.Expired":
          query.status = "expired";
          break;
        case "Status.Declined":
          query.status = "declined";
          break;
        case "Status.All":
        case "":
          // No additional filtering for 'All' or empty filter
          break;
        default:
          // Handle unknown filter or ignore
          break;
      }

      const allowedSortColumns = [
        "customer_name",
        "date",
        "createdAt",
        "created_time",
        "estimate4_number",
        "updatedAt",
        "total",
      ];

      if (sort_column === "created_time") {
        sort_column = "createdAt";
      }

      // Define sorting order
      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      const projection = {
        _id: 1,
        quote_id: 1,
        zcrm_potential_id: 1,
        zcrm_potential_name: 1,
        customer_id: 1,
        customer_name: 1,
        company_name: 1,
        status: 1,
        status_formatted: 1,
        color_code: 1,
        current_sub_status_id: 1,
        current_sub_status: 1,
        current_sub_status_formatted: 1,
        estimate_number: 1,
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

      const results = await queryHelper.findData(
        EstimateCollection,
        query,
        projection,
        sort,
        limit,
        page
      );

      const estimates = results?.status ? results.msg : [];
      const totalCount = await queryHelper.countDocuments(
        EstimateCollection,
        query
      );
      const hasMorePage = page * limit < totalCount;

      const transformedEstimates = await Promise.all(
        estimates.map(async (estimate) => {
          const estimateData = estimate._doc || estimate;
          let customer_name = estimateData.customer_name || "";
          let company_name = "";

          if (estimateData.customer_id) {
            try {
              const contactResponse = await apiHandler.getContactInformation(
                estimateData.customer_id,
                organization_id,
                req.headers.authorization
              );
              if (contactResponse?.data?.data) {
                customer_name =
                  contactResponse.data.data.contact_name || customer_name;
                company_name = contactResponse.data.data.company_name || "";
              }
            } catch (error) {
              console.error("Error fetching customer info:", error.message);
            }
          }

          return {
            _id: estimateData._id,
            quote_id: estimateData.quote_id || "",
            zcrm_potential_id: estimateData.zcrm_potential_id || "",
            zcrm_potential_name: estimateData.zcrm_potential_name || "",
            customer_id: estimateData.customer_id || "",
            customer_name,
            company_name,
            status: estimateData.status || "",
            status_formatted: estimateData.status_formatted || "",
            color_code: estimateData.color_code || "",
            current_sub_status_id: estimateData.current_sub_status_id || "",
            current_sub_status: estimateData.current_sub_status || "",
            current_sub_status_formatted:
              estimateData.current_sub_status_formatted || "",
            estimate_number: estimateData.estimate_number || "",
            reference_number: estimateData.reference_number || "",
            date: estimateData.date || "",
            date_formatted: estimateData.date_formatted || "",
            currency_id: estimateData.currency_id || "",
            currency_code: estimateData.currency_code || "",
            total: estimateData.total || 0,
            total_formatted: formatCurrency(estimateData.total) || "",
            created_time: estimateData.created_time || "",
            last_modified_time: estimateData.last_modified_time || "",
            accepted_date: estimateData.accepted_date || "",
            accepted_date_formatted: estimateData.accepted_date_formatted || "",
            declined_date: estimateData.declined_date || "",
            declined_date_formatted: estimateData.declined_date_formatted || "",
            expiry_date: estimateData.expiry_date || "",
            expiry_date_formatted: estimateData.expiry_date_formatted || "",
            has_attachment: !!estimateData.has_attachment,
            is_viewed_by_client: !!estimateData.is_viewed_by_client,
            client_viewed_time: estimateData.client_viewed_time || "",
            client_viewed_time_formatted:
              estimateData.client_viewed_time_formatted || "",
            is_emailed: !!estimateData.is_emailed,
            template_type: estimateData.template_type || "",
            template_id: estimateData.template_id || "",
            salesperson_id: estimateData.salesperson_id || "",
            salesperson_name: estimateData.salesperson_name || "",
            custom_field_hash: estimateData.custom_field_hash || {},
            tax_total: estimateData.tax_total || 0,
            tax_type: estimateData.tax_type || "",
            adjustment: estimateData.adjustment || 0,
            place_of_supply: estimateData.place_of_supply || "",
            documents: estimateData.documents || null,
          };
        })
      );

      return res.status(200).json({
        code: 0,
        message: "Quotes fetched successfully",
        estimates: transformedEstimates,
        totalCount: totalCount,
        page_context: {
          page,
          per_page,
          has_more_page: hasMorePage,
          report_name: "Quotes",
          applied_filter: filter,
          sort_column,
          sort_order,
        },
      });
    } catch (error) {
      console.error("getQuotes Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to fetch quotes.",
      });
    }
  }

  // 📌 Get single estimate by ID
  async getEstimateById(req, res) {
    try {
      const { organization_id } = req.query;
      const { quote_id } = req.params;

      // Validate required parameters
      if (!organization_id || !quote_id) {
        return res.status(400).json({
          status: false,
          message: "Missing required parameters: organization_id and quote_id",
        });
      }

      // Fetch the estimate
      const estimate = await EstimateCollection.findOne({
        organization_id,
        quote_id,
        deleted_at: null,
      }).lean();

      if (!estimate) {
        return res.status(404).json({
          status: false,
          message: "Estimate not found or unauthorized access",
        });
      }

      // Format totals
      estimate.total_formatted = formatCurrency(estimate.total);
      estimate.sub_total_formatted = formatCurrency(estimate.sub_total);

      // Fetch organization details
      const organization = await OrganizationCollection.findOne({
        organization_id,
        deleted_at: null,
      }).lean();

      if (!organization) {
        return res.status(404).json({
          status: false,
          message: "Organization not found or unauthorized access",
        });
      }

      // Respond with estimate and organization details
      return res.status(200).json({
        status: true,
        message: "Estimate retrieved successfully",
        estimate,
        organization,
      });
    } catch (error) {
      console.error("getEstimateById Error:", error.message);
      return res.status(500).json({
        status: false,
        message:
          "Internal Server Error: Unable to fetch estimate. Please try again later.",
        error: error.message,
      });
    }
  }

  // 📌 Update estimate
  async updateEstimate(req, res) {
    try {
      const { organization_id } = req.query;
      const { quote_id } = req.params;
      let updateData = { ...req.body };

      // Validate required query params
      if (!organization_id || !quote_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      // Find existing estimate
      let estimate = await EstimateCollection.findOne({
        quote_id,
        organization_id,
        // admin_id: res.locals.user_id,
      });
      if (!estimate) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Unauthorized or estimate not found",
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
          updateData.tax_percentage || estimate.tax_percentage || 0;
        const taxAmount = (subTotal * taxRate) / 100;
        updateData["tax_total"] = taxAmount;

        // Calculate discount if applicable
        const discountAmount =
          updateData.discount_amount || estimate.discount_amount || 0;

        // Calculate final total
        updateData["total"] = subTotal + taxAmount - discountAmount;
      }
      // console.log(updateData.place_of_supply, "place_of_supply");

      // Perform the update
      let updatedEstimate = await EstimateCollection.findOneAndUpdate(
        { quote_id, organization_id },
        { $set: updateData },
        { new: true }
      );

      // Success Response
      return res.status(ST_CODES.OK).send({
        status: true,
        message: "Estimate updated successfully",
        data: updatedEstimate,
      });
    } catch (error) {
      console.error("updateEstimate Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }

  // 📌 Delete estimate (soft delete)
  async deleteEstimate(req, res) {
    try {
      const { organization_id } = req.query;
      const admin_id = res.locals.user_id;
      const { quote_id } = req.params;

      // Validate required parameters
      if (!organization_id || !quote_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "organization_id, and admin_id are required",
        });
      }

      // Find the estimate
      let estimate = await EstimateCollection.findOne({
        quote_id: quote_id,
        organization_id: organization_id,
        // admin_id: admin_id,
        deleted_at: null, // Ensure it's not already deleted
      });

      if (!estimate) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Estimate not found for this organization",
        });
      }

      // Perform soft delete by setting deleted_at timestamp
      estimate.deleted_at = new Date();
      await estimate.save();

      res.status(ST_CODES.OK).send({
        status: true,
        message: "Estimate deleted successfully", // soft delete
        data: estimate,
      });
    } catch (error) {
      console.error("deleteEstimate Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong",
      });
    }
  }

  // // 📌 Convert estimate to invoice
  // async convertToInvoice(req, res) {
  //   try {
  //     const { organization_id, quote_id } = req.query;

  //     // Validate required parameters
  //     if (!organization_id || !quote_id) {
  //       return res.status(400).send({
  //         status: false,
  //         message: "Both organization_id and quote_id are required",
  //       });
  //     }

  //     // Find the estimate
  //     let estimate = await EstimateCollection.findOne({
  //       quote_id: quote_id,
  //       organization_id: organization_id,
  //       deleted_at: null,
  //     });

  //     if (!estimate) {
  //       return res.status(404).send({
  //         status: false,
  //         message: "Estimate not found for this organization",
  //       });
  //     }

  //     // Get the updated data from the frontend
  //     const updatedData = req.body;

  //     // Generate a unique invoice_id
  //     const uniqueInvoiceId = await commonHelper.generateUniqueId(
  //       InvoiceCollection,
  //       "invoice_id",
  //       8, // Length of the ID
  //       "" // No prefix
  //     );

  //     // Generate a unique invoice_number
  //     const uniqueInvoiceNumber = await commonHelper.generateUniqueId(
  //       InvoiceCollection,
  //       "invoice_number",
  //       6, // Length of the ID
  //       "INV" // Prefix
  //     );

  //     // Prepare invoice data
  //     const invoiceData = {
  //       ...estimate.toObject(), // Start with the original estimate data
  //       ...updatedData, // Override with updated fields from the frontend
  //       estimate_id: estimate._id, // Link to the estimate
  //       invoice_id: uniqueInvoiceId, // Use the generated unique ID
  //       invoice_number: uniqueInvoiceNumber, // Use the generated unique invoice_number
  //       status: updatedData.status, // Default status for the invoice
  //       date: updatedData.date || new Date().toISOString(), // Use current date if not provided
  //       due_date:
  //         updatedData.due_date ||
  //         estimate.expiry_date ||
  //         new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Use expiry_date or 30 days from now
  //       organization_id: organization_id, // Include organization_id
  //     };

  //     // Remove unnecessary fields
  //     delete invoiceData._id; // Remove MongoDB _id
  //     delete invoiceData.__v; // Remove version key
  //     delete invoiceData.deleted_at; // Remove soft-delete field if present

  //     // Call the createInvoice API to create the invoice
  //     const createInvoiceResponse = await axios.post(
  //       `${constants.SO_BACKEND_URL}/invoices?organization_id=${organization_id}`, // Pass organization_id as a query parameter
  //       invoiceData
  //     );

  //     // Extract the created invoice
  //     const createdInvoice = createInvoiceResponse.data.invoice;
  //     const invoiceMongoId = createdInvoice.invoice_id;

  //     // Update estimate fields
  //     estimate.status = "invoiced"; // Update status to "invoiced"
  //     estimate.status_formatted = "Invoiced"; // Update status to "invoiced"
  //     estimate.invoice_conversion_type = "invoice";

  //     if (!Array.isArray(estimate.invoice_ids)) {
  //       estimate.invoice_ids = [];
  //     }
  //     estimate.invoice_ids.push(createdInvoice.invoice_id);

  //     if (!Array.isArray(estimate.invoices)) {
  //       estimate.invoices = [];
  //     }
  //     estimate.invoices.push({
  //       invoice_id: createdInvoice.invoice_id,
  //       invoice_number: createdInvoice.invoice_number, // Include the generated invoice_number
  //       status: createdInvoice.status,
  //       status_formatted: createdInvoice.status_formatted,
  //       balance: createdInvoice.balance,
  //       balance_formatted: createdInvoice.balance_formatted,
  //       date: createdInvoice.date,
  //       date_formatted: createdInvoice.date_formatted,
  //       due_date: createdInvoice.due_date,
  //       due_date_formatted: createdInvoice.due_date_formatted,
  //       due_days: createdInvoice.due_days,
  //       total: createdInvoice.total,
  //       total_formatted: createdInvoice.total_formatted,
  //     });

  //     estimate.invoiced_amount = estimate.total;
  //     estimate.invoiced_amount_formatted = estimate.total_formatted;

  //     // Save the updated estimate
  //     await estimate.save();

  //     // Send success response
  //     res.status(200).send({
  //       status: true,
  //       message: "Estimate converted to invoice successfully",
  //       data: {
  //         quote_id: estimate.quote_id,
  //         invoice_id: invoiceMongoId, // Return the MongoDB _id of the created invoice
  //       },
  //     });
  //   } catch (error) {
  //     console.error("convertToInvoice Error:", error);
  //     res.status(500).send({
  //       status: false,
  //       message:
  //         error.response?.data?.message ||
  //         "Something went wrong while converting estimate to invoice",
  //     });
  //   }
  // }

  // 📌 Convert estimate to invoice
  async convertToInvoice(req, res) {
    try {
      const { organization_id, quote_id } = req.query;

      // Validate required parameters
      if (!organization_id || !quote_id) {
        return res.status(400).send({
          status: false,
          message: "Both organization_id and quote_id are required",
        });
      }

      // Find the estimate
      let estimate = await EstimateCollection.findOne({
        quote_id: quote_id,
        organization_id: organization_id,
        deleted_at: null,
      });

      if (!estimate) {
        return res.status(404).send({
          status: false,
          message: "Estimate not found for this organization",
        });
      }

      // Check if the estimate is already invoiced
      if (estimate.status !== "invoiced") {
        // Collect the current status and formatted status of the estimate
        estimate.current_sub_status = estimate.status;
        estimate.current_sub_status_formatted = estimate.status_formatted;

        // Save the updated estimate (to store the collected status)
        await estimate.save();
      }

      // Get the updated data from the frontend
      const updatedData = req.body;

      // Generate a unique invoice_id
      const uniqueInvoiceId = await commonHelper.generateUniqueId(
        InvoiceCollection,
        "invoice_id",
        6
      );

      // Generate a unique invoice_number
      let uniqueInvoiceNumber;
      if (!updatedData.invoice_number) {
        uniqueInvoiceNumber = await commonHelper.generateUniqueId(
          InvoiceCollection,
          "invoice_number",
          6, // Length of the ID
          "INV" // Prefix
        );
      } else {
        uniqueInvoiceNumber = updatedData.invoice_number;
      }
      console.log(updatedData,"updatedDataupdatedData");
      // Prepare invoice data
      const invoiceData = {
        ...estimate.toObject(), // Start with the original estimate data
        ...updatedData, // Override with updated fields from the frontend
        estimate_id: estimate._id, // Link to the estimate
        invoice_id: uniqueInvoiceId, // Use the generated unique ID
        invoice_number: uniqueInvoiceNumber, // Use the generated unique invoice_number
        status: updatedData.status, // Default status for the invoice
        status_formatted: updatedData.status_formatted, // Default status for the invoice
        date: updatedData.date || new Date().toISOString(), // Use current date if not provided
        due_date:
          updatedData.due_date ||
          estimate.expiry_date ||
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Use expiry_date or 30 days from now
        organization_id: organization_id, // Include organization_id
        current_sub_status: estimate.current_sub_status, // Add the collected sub-status
        current_sub_status_formatted: estimate.current_sub_status_formatted, // Add the collected formatted sub-status
      };

      // Remove unnecessary fields
      delete invoiceData._id; // Remove MongoDB _id
      delete invoiceData.__v; // Remove version key
      delete invoiceData.deleted_at; // Remove soft-delete field if present
      

      // Call the createInvoice API to create the invoice
      const invoicePayload = await createInvoiceData(req, invoiceData);
      const createdInvoice = await new InvoiceCollection(invoicePayload).save();

      const invoiceMongoId = createdInvoice.invoice_id;

      // Update estimate fields
      estimate.status = "invoiced"; // Update status to "invoiced"
      estimate.status_formatted = "Invoiced"; // Update status to "Invoiced"
      estimate.invoice_conversion_type = "invoice";

      if (!Array.isArray(estimate.invoice_ids)) {
        estimate.invoice_ids = [];
      }
      estimate.invoice_ids.push(createdInvoice.invoice_id);

      if (!Array.isArray(estimate.invoices)) {
        estimate.invoices = [];
      }
      estimate.invoices.push({
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

      estimate.invoiced_amount = estimate.total;
      estimate.invoiced_amount_formatted = estimate.total_formatted;

      // Save the updated estimate
      await estimate.save();

      // Send success response
      res.status(200).send({
        status: true,
        message: "Estimate converted to invoice successfully",
        data: {
          invoice: {
            quote_id: estimate.quote_id,
            invoice_id: invoiceMongoId, // Return the MongoDB _id of the created invoice
          },
        },
      });
    } catch (error) {
      console.error("convertToInvoice Error:", error);
      res.status(500).send({
        status: false,
        message:
          error.response?.data?.message ||
          "Something went wrong while converting estimate to invoice",
      });
    }
  }

  // 📌 Convert estimate to sales order
  async convertToSalesOrder(req, res) {
    try {
      const { organization_id, quote_id } = req.query;

      // Validate required parameters
      if (!organization_id || !quote_id) {
        return res.status(400).send({
          status: false,
          message: "Both organization_id and quote_id are required",
        });
      }

      // Find the estimate
      let estimate = await EstimateCollection.findOne({
        quote_id: quote_id,
        organization_id: organization_id,
        deleted_at: null,
      });

      if (!estimate) {
        return res.status(404).send({
          status: false,
          message: "Estimate not found for this organization",
        });
      }

      // Get the updated data from the frontend
      const updatedData = req.body;

      // Generate a unique salesorder_id
      const uniqueSalesOrderId = await commonHelper.generateUniqueId(
        SalesOrderCollection,
        "salesorder_id",
        8, // Length of the ID
        "" // No prefix
      );

      // Generate a unique salesorder_number
      const uniqueSalesOrderNumber = await commonHelper.generateUniqueId(
        SalesOrderCollection,
        "salesorder_number",
        6, // Length of the ID
        "SO" // Prefix
      );

      console.log(updatedData, "---updatedData---");

      // Prepare sales order data
      const salesorderData = {
        ...estimate.toObject(), // Start with the original estimate data
        ...updatedData, // Override with updated fields from the frontend
        estimate_id: estimate._id, // Link to the estimate
        salesorder_id: uniqueSalesOrderId, // Use the generated unique ID
        salesorder_number: uniqueSalesOrderNumber,
        date: updatedData.date || new Date().toISOString(), // Use current date if not provided
        due_date:
          updatedData.due_date ||
          estimate.expiry_date ||
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // Use expiry_date or 30 days from now
        organization_id: organization_id, // Include organization_id
      };
      salesorderData.status = updatedData.status;
      salesorderData.status_formatted = updatedData.status_formatted;

      // Remove unnecessary fields
      delete salesorderData._id; // Remove MongoDB _id
      delete salesorderData.__v; // Remove version key
      delete salesorderData.deleted_at; // Remove soft-delete field if present

      // Call the createSalesOrder API to create the sales order
      const createSalesOrderResponse = await axios.post(
        `${constants.SO_BACKEND_URL}/salesorders?organization_id=${organization_id}`, // Pass organization_id as a query parameter
        salesorderData,
        {
          headers: {
            Authorization: req.headers.authorization, // Include the authorization token
          },
        }
      );

      // Extract the created sales order
      const createdSalesOrder = createSalesOrderResponse.data.data; // Ensure correct path to the sales order object
      if (!createdSalesOrder || !createdSalesOrder._id) {
        console.error(
          "Invalid sales order response:",
          createSalesOrderResponse.data
        );
        return res.status(500).send({
          status: false,
          message: "Failed to retrieve sales order details from the response",
        });
      }

      const salesOrderMongoId = createdSalesOrder.salesorder_id;

      // Update estimate fields
      // estimate.status = "converted_to_salesorder"; // Update status to indicate conversion
      estimate.salesorder_conversion_type = "salesorder";

      if (!Array.isArray(estimate.salesorder_ids)) {
        estimate.salesorder_ids = [];
      }
      estimate.salesorder_ids.push(createdSalesOrder.salesorder_id);

      if (!Array.isArray(estimate.salesorders)) {
        estimate.salesorders = [];
      }
      estimate.salesorders.push({
        salesorder_id: createdSalesOrder.salesorder_id,
        salesorder_number: createdSalesOrder.salesorder_number, // Include the generated salesorder_number
        status: createdSalesOrder.status,
        status_formatted: createdSalesOrder.status_formatted,
        balance: createdSalesOrder.balance,
        balance_formatted: createdSalesOrder.balance_formatted,
        date: createdSalesOrder.date,
        date_formatted: createdSalesOrder.date_formatted,
        due_date: createdSalesOrder.due_date,
        due_date_formatted: createdSalesOrder.due_date_formatted,
        due_days: createdSalesOrder.due_days,
        total: createdSalesOrder.total,
        total_formatted: createdSalesOrder.total_formatted,
      });

      estimate.salesordered_amount = estimate.total;
      estimate.salesordered_amount_formatted = estimate.total_formatted;

      // Save the updated estimate
      await estimate.save();

      // Send success response
      res.status(200).send({
        status: true,
        message: "Estimate converted to sales order successfully",
        data: {
          quote_id: estimate.quote_id,
          salesorder_id: salesOrderMongoId, // Return the MongoDB _id of the created sales order
        },
      });
    } catch (error) {
      console.error("convertToSalesOrder Error:", error);
      res.status(500).send({
        status: false,
        message:
          error.response?.data?.message ||
          "Something went wrong while converting estimate to sales order",
      });
    }
  }

  // 📌 Change estimate status
  // async updateEstimateStatus(req, res) {
  //   try {
  //     const { organization_id } = req.query;
  //     const { status } = req.body;
  //     // const admin_id = res.locals.user_id;

  //     // Validate required parameters
  //     if (!organization_id || !quote_id || !status) {
  //       return res.status(ST_CODES.BAD_REQUEST).send({
  //         status: false,
  //         message: "Missing required parameters",
  //       });
  //     }

  //     // Validate status value
  //     const validStatuses = [
  //       "draft",
  //       "sent",
  //       "accepted",
  //       "declined",
  //       "expired",
  //     ];
  //     if (!validStatuses.includes(status)) {
  //       return res.status(ST_CODES.BAD_REQUEST).send({
  //         status: false,
  //         message:
  //           "Invalid status value. Must be one of: draft, sent, accepted, declined, expired",
  //       });
  //     }

  //     // Find and update the estimate
  //     const updatedEstimate = await EstimateCollection.findOneAndUpdate(
  //       {
  //         quote_id: quote_id,
  //         organization_id: organization_id,
  //         // admin_id: admin_id,
  //         deleted_at: null,
  //       },
  //       { $set: {
  //         status: status,
  //         status_formatted: status_formatted,
  //         status_updated_at: new Date(),
  //       },
  //     },
  //     { new: true }
  //     );

  //     if (!updatedEstimate) {
  //       return res.status(ST_CODES.NOT_FOUND).send({
  //         status: false,
  //         message: "Estimate not found or unauthorized access",
  //       });
  //     }

  //     res.status(ST_CODES.OK).send({
  //       status: true,
  //       message: `Estimate status updated to ${status} successfully`,
  //       data: {
  //         quote_id: updatedEstimate.quote_id,
  //         status: updatedEstimate.status,
  //       },
  //     });
  //   } catch (error) {
  //     console.error("updateEstimateStatus Error:", error);
  //     res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
  //       status: false,
  //       message: "Something went wrong while updating estimate status",
  //     });
  //   }
  // }
  // get estimate unique Id
  async getUniqueId(req, res) {
    try {
      let estimateId = await commonHelper.generateUniqueId(
        EstimateCollection,
        "estimate_number",
        6,
        "QT"
      );
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Estimate Id has been generated",
        data: estimateId,
      });
    } catch (err) {
      console.error("generatingEstimateId Error:", err);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while generating estimate id",
      });
    }
  }

  // 📌 Get filtered quotes
  async getFilteredQuotes(req, res) {
    try {
      // console.log("Fetching Filtered Quotes...");
      let {
        page = 1,
        per_page = 10,
        limit = 10,
        filter = "",
        sort_column = "createdAt",
        sort_order = "D",
        organization_id,
        customer_id = null,
      } = req.query;

      const admin_id = res.locals.user_id; // Assuming user ID is stored in locals

      // console.log(admin_id, "admin_id");

      // Check required parameters
      if (!admin_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }

      // Convert page & per_page to numbers
      limit = parseInt(limit, 10);
      page = parseInt(page, 10);

      // Base query condition
      const query = {
        organization_id: organization_id,
        deleted_at: null,
      };

      // ✅ Implement your switch-case filter logic
      switch (filter) {
        case "Status.Draft":
          query.status = "draft";
          break;
        case "Status.Sent":
          query.status = "sent";
          break;
        case "Status.Viewed":
          query.status = "customer viewed";
          break;
        case "Status.Approved":
          query.status = "approved";
          break;
        case "Status.Pending":
          query.status = "pending approval";
          break;
        case "Status.Accepted":
          query.status = "accepted";
          break;
        case "Status.Invoiced":
          query.status = "invoiced";
          break;
        case "Status.Expired":
          query.status = "expired";
          break;
        case "Status.Declined":
          query.status = "declined";
          break;
        case "Status.All":
        case "":
          // No additional filtering for 'All' or empty filter
          break;
        default:
          // Handle unknown filter or ignore
          break;
      }

      // Prepare sorting
      const sort = {};
      sort[sort_column] = sort_order === "A" ? 1 : -1;

      // Fetch data
      const results = await queryHelper.findData(
        EstimateCollection,
        query,
        {},
        sort,
        limit,
        page
      );

      // Format quotes for response
      const formattedQuotes = (results.msg || []).map((quote) => ({
        quote_id: quote.quote_id,
        estimate_number: quote.estimate_number || "",
        date_formatted: quote.date
          ? new Date(quote.date).toLocaleDateString("en-GB")
          : "",
        expiry_date_formatted: quote.expiry_date
          ? new Date(quote.expiry_date).toLocaleDateString("en-GB")
          : "",
        reference_number: quote.reference_number || "",
        status: quote.status || "draft",
        status_formatted: quote.status_formatted,
        sub_total: quote.sub_total || 0.0,
        sub_total_formatted: quote.sub_total_formatted,
        total: quote.total || 0.0,
        total_formatted: quote.total_formatted,
        adjustment: quote.adjustment || 0.0,
        adjustment_formatted: quote.adjustment_formatted,
        tax_total: quote.tax_total || 0.0,
        tax_total_formatted: quote.tax_total_formatted,
        place_of_supply: quote.place_of_supply || "",
        billing_address: quote.billing_address,
        shipping_address: quote.shipping_address,
        line_items: quote.line_items,
        created_time: quote.createdAt,
        created_time_formatted: quote.createdAt
          ? new Date(quote.createdAt).toLocaleDateString("en-GB")
          : "",
        last_modified_time: quote.updatedAt,
        last_modified_time_formatted: quote.updatedAt
          ? new Date(quote.updatedAt).toLocaleDateString("en-GB")
          : "",
        has_attachments: quote.has_attachments || false,
      }));

      // Response
      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Quotes fetched successfully",
        data: formattedQuotes,
        page_context: {
          page: page,
          per_page: per_page,
          has_more_page: formattedQuotes.length === per_page, // crude way to check if more data
          report_name: "Quotes",
          applied_filter: filter,
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      console.error("getFilteredQuotes Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        code: 1,
        message:
          "Internal Server Error: Unable to fetch quotes. Please try again later.",
      });
    }
  }

  // Helper function to format status
  getStatusFormatted(status) {
    switch (status) {
      case "draft":
        return "Draft";
      case "sent":
        return "Sent";
      case "accepted":
        return "Accepted";
      case "invoiced":
        return "Invoiced";
      case "expired":
        return "Expired";
      case "declined":
        return "Declined";
      default:
        return "Unknown";
    }
  }
  // Helper function to format address
  formatAddress(address) {
    if (!address) return "";
    return `${address.attention || ""}, ${address.address || ""}, ${
      address.street2 || ""
    }, ${address.city || ""}, ${address.state || ""}, ${address.zip || ""}, ${
      address.country || ""
    }`.trim();
  }

  // Helper function to format line items
  formatLineItems(lineItems) {
    return (lineItems || []).map((item) => ({
      item_id: item.item_id,
      name: item.name || "",
      description: item.description || "",
      quantity: item.quantity || 0,
      rate: item.rate || 0.0,
      rate_formatted: formatCurrency(item.rate),
      item_total: item.item_total || 0.0,
      item_total_formatted: formatCurrency(item.item_total),
    }));
  }
  //email fetch
  async getEstimateEmailDetails(req, res) {
    try {
      const { organization_id } = req.query;
      const { quote_id } = req.params;
      const token = req.headers.authorization;

      // Validate required parameters
      if (!organization_id || !quote_id || !token) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id, quote_id, or token",
        });
      }

      // Fetch Sales Order
      const estimate = await EstimateCollection.findOne({
        organization_id: organization_id,
        quote_id: quote_id,
      });

      if (!estimate) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Quotes not found",
        });
      }

      if (!estimate.customer_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Quotes does not have a valid customer_id",
        });
      }

      let organization = {};
      let contactPerson = {};

      try {
        // Fetch organization and contact person data in parallel
        const [organizationResponse, contactPersonResponse] = await Promise.all(
          [
            apiHandler.getOrganizationDetails(organization_id, token),
            apiHandler.getContactPersonInformation(
              estimate.customer_id,
              organization_id,
              token
            ),
          ]
        );

        if (organizationResponse?.data?.data) {
          organization = organizationResponse.data.data;
          // console.log(
          //   "✅ Organization data retrieved successfully.",
          //   organization
          // );
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
        subject: `Quote - ${estimate.estimate_number} is awaiting your approval`,
        body: `Dear ${estimate.customer_name},\n\nThank you for contacting us. Your quote can be viewed, printed and downloaded as PDF from the link below.`,
        customer_name: estimate.customer_name || "",
        customer_id: estimate.customer_id || "",
        organization_name: organization.organization_name || "",
        organization_id: organization_id,
        estimate_number: estimate.estimate_number || "",
        quote_id: estimate.quote_id,
        total: estimate.total || 0,
        total_formatted: estimate.total_formatted || "",
        date: estimate.date || "",
        date_formatted: estimate.date_formatted || "",
        file_name: estimate.estimate_number,
        file_name_without_extension: `${estimate.estimate_number}.pdf`,
        orgemail_detail: orgemail_name, // Include the correctly formatted orgemail_name array
        to_contact, // Include the contact list with emails
        status: estimate.status || "",
        entity_type: "quotes",
      };

      console.log("✅ Email details successfully prepared:", emailDetails);

      // Return the email details
      res.status(ST_CODES.OK).json({
        status: true,
        message: "Email details retrieved successfully",
        data: emailDetails,
      });
    } catch (error) {
      console.error("❌ getEstimateEmailDetails Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Something went wrong while fetching email details",
        error: error.message,
      });
    }
  }

  async updateEstimateStatus(req, res) {
    try {
      const { organization_id, quote_id } = req.query;
      const { status, status_formatted } = req.body;
      // const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!organization_id || !quote_id || !status || !status_formatted) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      // Validate status value
      const validStatuses = ["draft", "sent", "accepted", "declined"];
      if (
        !validStatuses
          .map((status) => status.toLowerCase())
          .includes(status.toLowerCase())
      ) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message:
            "Invalid status value. Must be one of: draft, sent, accepted, declined",
        });
      }

      // Find and update the sales order
      const updatedEstimate = await EstimateCollection.findOneAndUpdate(
        {
          quote_id: quote_id,
          organization_id: organization_id,
          // admin_id: admin_id,
          deleted_at: null,
        },
        {
          $set: {
            status: status,
            status_formatted: status_formatted,
            status_updated_at: new Date(),
          },
        },
        { new: true }
      );

      if (!updatedEstimate) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Estimate not found or unauthorized access",
        });
      }

      res.status(ST_CODES.OK).send({
        status: true,
        message: `Estimate status updated to ${status} successfully`,
        data: {
          quote_id: updatedEstimate.quote_id,
          status: updatedEstimate.status,
        },
      });
    } catch (error) {
      console.error("updateEstimateStatus  Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while updating quotes status",
      });
    }
  }

  //For Customer Portal get Quotes for particular Customer
  async getCustomerEstimates(req, res) {
    try {
      let {
        page = 1,
        per_page = 10,
        limit = 10,
        filter = "",
        organization_id,
        customer_id,
      } = req.query;

      const admin_id = res.locals.user_id;

      if (!admin_id || !organization_id || !customer_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }

      // Convert types
      page = parseInt(page, 10);
      limit = parseInt(limit, 10);

      // Base query
      const query = {
        organization_id: organization_id,
        deleted_at: null,
        customer_id: customer_id,
      };

      // Apply status-based filters
      switch (filter) {
        case "open":
          query.status = "sent";
          break;
        case "all":
          query.status = { $ne: "draft" };
        case "":
          // No additional filtering for 'All' or empty filter
          break;
        default:
          // Handle unknown filter or ignore
          break;
      }

      const sort = {};

      const projection = {
        _id: 1,
        quote_id: 1,
        customer_id: 1,
        customer_name: 1,
        status: 1,
        status_formatted: 1,
        estimate_number: 1,
        reference_number: 1,
        date: 1,
        date_formatted: 1,
        currency_code: 1,
        total: 1,
        total_formatted: 1,
        created_time: 1,
        accepted_date: 1,
        accepted_date_formatted: 1,
        declined_date: 1,
        declined_date_formatted: 1,
        expiry_date: 1,
        expiry_date_formatted: 1,
      };

      const results = await queryHelper.findData(
        EstimateCollection,
        query,
        projection,
        sort,
        limit,
        page
      );

      const estimates = results?.status ? results.msg : [];
      const totalCount = await queryHelper.countDocuments(
        EstimateCollection,
        query
      );
      const hasMorePage = page * limit < totalCount;

      const transformedEstimates = await Promise.all(
        estimates.map(async (estimate) => {
          const estimateData = estimate._doc || estimate;
          let customer_name = estimateData.customer_name || "";
          let company_name = "";

          if (estimateData.customer_id) {
            try {
              const contactResponse = await apiHandler.getContactInformation(
                estimateData.customer_id,
                organization_id,
                req.headers.authorization
              );
              if (contactResponse?.data?.data) {
                customer_name =
                  contactResponse.data.data.contact_name || customer_name;
                company_name = contactResponse.data.data.company_name || "";
              }
            } catch (error) {
              console.error("Error fetching customer info:", error.message);
            }
          }
          let status = estimateData.status,
            status_formatted = estimateData.status_formatted;
          if (estimateData.status === "sent") {
            status = "open";
            status_formatted = "Open";
          } else if (estimateData.status === "invoiced") {
            status = "accepted";
            status_formatted = "Accepted";
          }

          return {
            _id: estimateData._id,
            quote_id: estimateData.quote_id || "",
            customer_id: estimateData.customer_id || "",
            customer_name,
            status: status || "",
            status_formatted: status_formatted || "",
            estimate_number: estimateData.estimate_number || "",
            reference_number: estimateData.reference_number || "",
            date: estimateData.date || "",
            date_formatted: estimateData.date_formatted || "",
            currency_code: estimateData.currency_code || "",
            total: estimateData.total || 0,
            total_formatted: estimateData.total_formatted || "",
            created_time: estimateData.created_time || "",
            accepted_date: estimateData.accepted_date || "",
            accepted_date_formatted: estimateData.accepted_date_formatted || "",
            declined_date: estimateData.declined_date || "",
            declined_date_formatted: estimateData.declined_date_formatted || "",
            expiry_date: estimateData.expiry_date || "",
            expiry_date_formatted: estimateData.expiry_date_formatted || "",
          };
        })
      );

      return res.status(200).json({
        code: 0,
        message: "Quotes fetched successfully",
        estimates: transformedEstimates,
        totalCount: totalCount,
        page_context: {
          page,
          per_page,
          has_more_page: hasMorePage,
          report_name: "Quotes",
          applied_filter: filter,
        },
      });
    } catch (error) {
      console.error("getQuotes Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to fetch quotes.",
      });
    }
  }

  //For Customer Accept or Declined the quote
  async acceptOrDeclined(req, res) {
    try {
      const { customer_id, quote_id, organization_id } = req.query;
      const { status } = req.params;
      const { description } = req.body;

      if (!organization_id || !quote_id || !status || !customer_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      const lowerStatus = status.toLowerCase();
      const validStatuses = ["accepted", "declined"];

      if (!validStatuses.includes(lowerStatus)) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Invalid status value. Must be one of: accepted, declined",
        });
      }

      if (lowerStatus === "declined" && !description) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing description when status is declined",
        });
      }

      const estimate = await EstimateCollection.findOne({
        quote_id,
        organization_id,
        deleted_at: null,
      });

      if (!estimate) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Estimate not found or unauthorized access",
        });
      }

      if (estimate.status === "invoiced") {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Invoiced Data should not be accept/decline the estimate",
        });
      }

      const now = new Date();
      const date = now.toISOString().split("T")[0];
      const formattedDate = now.toLocaleDateString("en-GB");

      const updateFields = {
        status: lowerStatus,
        status_formatted: lowerStatus === "accepted" ? "Accepted" : "Declined",
        status_updated_at: now,
      };

      if (lowerStatus === "accepted") {
        updateFields.accepted_date = date;
        updateFields.accepted_date_formatted = formattedDate;
      } else {
        updateFields.declined_date = date;
        updateFields.declined_date_formatted = formattedDate;
      }

      const commentsToAdd = [];

      // Add system comment using createComments
      commentsToAdd.push(
        createComments(
          "Arul", // system user name
          "", // no ID
          "system", // system comment
          quote_id,
          `Quote ${lowerStatus}`,
          "Updated", // operation_type
          "", // transaction_id
          "estimate" // transaction_type
        )
      );

      // If declined, add client comment
      if (lowerStatus === "declined") {
        const customerName = estimate.customer_name || "Customer";

        commentsToAdd.push(
          createComments(
            customerName, // commented_by
            customer_id, // commented_by_id
            "client", // comment_type
            quote_id,
            description // user-provided description
          )
        );
      }

      const updatedEstimate = await EstimateCollection.findOneAndUpdate(
        {
          quote_id,
          organization_id,
          deleted_at: null,
        },
        {
          $set: updateFields,
          $push: { comments: { $each: commentsToAdd } },
        },
        { new: true }
      );

      if (!updatedEstimate) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Estimate not found or unauthorized access",
        });
      }

      return res.status(ST_CODES.OK).send({
        status: true,
        message: `Estimate status has been ${lowerStatus}`,
        data: {
          quote_id: updatedEstimate.quote_id,
          status: updatedEstimate.status,
          comments: commentsToAdd,
        },
      });
    } catch (error) {
      console.error("acceptOrDeclined Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to acceptOrDeclined the quote.",
      });
    }
  }

  //For Customer/Admin Comments & History
  async comments(req, res) {
    try {
      const { customer_id, organization_id } = req.query;
      const { quote_id } = req.params;
      const { description } = req.body;

      if (!organization_id || !quote_id || !customer_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Missing required parameters",
        });
      }

      // Fetch estimate to get customer name
      const estimate = await EstimateCollection.findOne({
        quote_id,
        organization_id,
        deleted_at: null,
      });

      if (!estimate) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Estimate not found or unauthorized access",
        });
      }

      const commented_by = estimate.customer_name || "Customer"; // fallback if missing
      const commented_by_id = customer_id;
      const id = quote_id;
      const comment_type = "client";

      const comments = createComments(
        commented_by,
        commented_by_id,
        comment_type,
        id,
        description,
        "",
        "",
        ""
      );

      const updatedEstimateComment = await EstimateCollection.findOneAndUpdate(
        {
          quote_id,
          organization_id,
          deleted_at: null,
        },
        {
          $push: { comments: comments },
        },
        { new: true }
      );

      res.status(ST_CODES.OK).send({
        status: true,
        message: "Comment has been added",
        data: updatedEstimateComment.comments,
      });
    } catch (error) {
      console.error("comments Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to add comment to the quote.",
      });
    }
  }

  async getCustomerEstimate(req, res) {
    try {
      let { organization_id, customer_id } = req.query;
      const { quote_id } = req.params;
      const admin_id = res.locals.user_id;

      if (!admin_id || !organization_id || !customer_id || !quote_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }

      const estimate = await EstimateCollection.findOne({
        organization_id,
        quote_id,
        deleted_at: null,
        customer_id,
      }).lean();

      if (!estimate) {
        return res.status(404).json({
          status: false,
          message: "Estimate not found",
        });
      }

      const now = new Date();
      const date = now.toISOString().split("T")[0]; // yyyy-mm-dd
      const formattedDate = now.toLocaleDateString("en-GB"); // dd/mm/yyyy
      const time = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }); // e.g. 10:30 AM
      const formattedDateTime = `${formattedDate} ${time}`;

      // Update only if not already viewed
      if (!estimate.is_viewed_by_client) {
        await EstimateCollection.updateOne(
          {
            organization_id,
            quote_id,
            deleted_at: null,
            customer_id,
            is_viewed_by_client: false,
          },
          {
            $set: {
              is_viewed_by_client: true,
              client_viewed_time: date,
              client_viewed_time_formatted: formattedDateTime,
            },
          }
        );
      }

      const estimateData = estimate._doc || estimate;
      let customer_name = estimateData.customer_name || "";
      let company_name = "";

      if (estimateData.customer_id) {
        try {
          const contactResponse = await apiHandler.getContactInformation(
            estimateData.customer_id,
            organization_id,
            req.headers.authorization
          );
          if (contactResponse?.data?.data) {
            customer_name =
              contactResponse.data.data.contact_name || customer_name;
            company_name = contactResponse.data.data.company_name || "";
          }
        } catch (error) {
          console.error("Error fetching customer info:", error.message);
        }
      }

      let status = estimateData.status;
      let status_formatted = estimateData.status_formatted;

      if (status === "sent") {
        status = "open";
        status_formatted = "Open";
      } else if (status === "invoiced") {
        status = "accepted";
        status_formatted = "Accepted";
      }

      estimateData.customer_name = customer_name;
      estimateData.status = status;
      estimateData.status_formatted = status_formatted;

      return res.status(200).json({
        status: true,
        message: "Quote fetched successfully",
        data: estimateData,
      });
    } catch (error) {
      console.error("getQuotes Error:", error.message);
      return res.status(500).json({
        code: 1,
        message: "Internal Server Error: Unable to fetch quotes.",
      });
    }
  }
}

module.exports = new EstimateController();
