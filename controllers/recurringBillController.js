const mongoose = require("mongoose");
const RecurringBillsCollection = mongoose.model("recurringBill");
const BillCollection = mongoose.model("PO_bill");
const OrganizationCollection = mongoose.model("Organization");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const userActivityHelper = require("../helpers/userActivityHelper");
const moment = require("moment");
const apiHandler = require("../handler/api-handler");
const MESSAGES = require("../helpers/messageHelpers");

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
  const formattedDate = now.toLocaleDateString("en-GB"); // DD/MM/YYYY
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

class recurringBillsController {
  // create recurring bills
  async createRecurring(req, res) {
    try {
      let bData = req.body;
      let orgId = req.query.org_id;
      let bill_id = req.query.bill_id;
      const admin_id = res.locals.user_id; // Fetch admin_id from session
      if (req.file) {
        bData["documents"] = req.file.filename;
      }
      // Validate required parameters
      if (!orgId || !bData || Object.keys(bData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and bill data are mandatory.",
        });
      }

      // Mapping status numbers to their respective string values
      const statusMap = {
        0: "active",
        1: "stopped",
        2: "expired",
      };

      // Validate and map status
      if (!statusMap.hasOwnProperty(bData.status)) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Invalid status value. Allowed values: 0 (active), 1 (stopped),",
        });
      }

      // Convert numeric status to string before storing
      bData.status_type = statusMap[bData.status];

      // calculate next_invoice_date
      const validFrequencies = ["days", "weeks", "months", "years"];
      if (!validFrequencies.includes(bData["recurrence_frequency"])) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Invalid recurrence_frequency. Allowed: days, weeks, months, years.",
        });
      }

      const repeatEvery = parseInt(bData["repeat_every"], 10);
      const frequency = bData["recurrence_frequency"];
      const startDate = moment(bData.start_date, "YYYY-MM-DD");

      if (!startDate.isValid()) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Invalid start_date format. Use YYYY-MM-DD.",
        });
      }

      // Generate unique Bill ID
      let billUniqueId = await commonHelper.generateUniqueId(
        RecurringBillsCollection,
        "recurring_bill_id",
        7
      );

      //history
      const commented_by_id = res.locals.user_id || ""; // from request context
      const commented_by = res.user?.company_name || "System"; // fallback if user not found
      const description = `Recurring Bill created for ₹${parseFloat(
        bData.total
      ).toFixed(2)}`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        billUniqueId,
        description,
        "Added", // operation_type
        "", // transaction_id
        "recurring_bill"
      );

      // Calculate next_bill_date
      const nextBillDate = startDate.clone().add(repeatEvery, frequency);
      bData.next_bill_date = nextBillDate.format("YYYY-MM-DD");
      bData.last_sent_date = bData.start_date;
      bData.comments = comment;

      // Assign additional fields
      bData["recurring_bill_id"] = billUniqueId;
      bData["admin_id"] = admin_id;
      // Fetch Organization Data
      let orgData = await OrgCollection.findOne({ organization_id: orgId });
      if (!orgData) {
        return res.status(ST_CODES.ORG_NOT_FOUND).json({
          success: true,
          message: MESSAGES.ORG_NOT_FOUND,
        });
      }
      bData["organization_id"] = orgData.organization_id;
      // Insert new Bill into the database
      let createBill = await queryHelper.insertData(
        RecurringBillsCollection,
        bData
      );
      if (!bill_id) {
        let requestData = {
          vendor_id: bData.vendor_id,
          billNumber: "",
          order_number: "",
          billDate: bData.start_date,
          dueDate: bData.end_Date,
          paymentTerms: bData.payment_terms_label,
          items: bData.line_items.map((item) => ({
            item_id: item.item_id || "",
            amount: item.amount || 0,
            details: item.details || "",
            rate: item.rate || 0,
            quantity: item.quantity || 1,
            discount: item.discount || 0,
            sku: item.sku || "",
            tax: item.tax || "",
          })),
          taxCategory: bData.tds_option,
          taxAmount: bData.tax_amount,
          tdsOrTcs: bData.tax_type,
          total: bData.total,
          subtotal: bData.sub_total,
          status: 0,
          status_type: "OPEN",
          source_of_supply: bData.source_of_supply,
          destination_of_supply: bData.destination_of_supply,
          adjustment: bData.adjustment,
          billing_address: bData.billing_address,
          recurring_bill_id: billUniqueId,
        };
        const token =
          req.headers.authorization?.split("Bearer ")[1] || res.locals.token;
        // Now create a regular bill using the same data
        let responseData;
        let organization_id = orgId;
        try {
          const billCreate = await apiHandler.createBill(
            organization_id,
            requestData,
            token
          );
          responseData = billCreate.data.data;
        } catch (error) {
          console.error("Failed to create regular bill:", error.message);
        }
        console.log(responseData);
      }

      await userActivityHelper(
        admin_id,
        orgId,
        bData.vendor_id,
        `Recurring Bill created for ₹${parseFloat(bData.total).toFixed(2)}`,
        "Recurring Bill created",
        createBill.msg._id,
        "po_bill"
      );

      if (!createBill.status) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: createBill.msg,
        });
      }

      return res.status(ST_CODES.CREATED).json({
        status: true,
        message: "Recurring Bill has been added",
        data: createBill.msg,
        recurring_bill_id: billUniqueId,
      });
    } catch (error) {
      console.error("createBills Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Unable to create bill. Please try again later.",
      });
    }
  }

  // Get recurring bill by id
  async getRecurringById(req, res) {
    try {
      const { org_id, filter_status = "all", page = 1, limit = 1 } = req.query;
      const admin_id = res.locals.user_id; // Fetch admin_id from session
      const recurring_bill_id = req.params.recurring_id;
      // Validate required parameters
      if (!org_id || !recurring_bill_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and recurring id are mandatory.",
        });
      }

      // Parse pagination values
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      const skip = (pageNum - 1) * limitNum;

      let recurringData = await RecurringBillsCollection.findOne({
        admin_id,
        recurring_bill_id,
        organization_id: org_id,
        deleted_at: null,
      }).lean();

      if (!recurringData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Bill not found..." });
      }

      // Fetch organization data
      let organization;
      try {
        organization = await OrganizationCollection.findOne(
          { org_id },
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
          }
        ).lean();
      } catch (dbError) {
        console.error("Organization Fetch Error:", dbError);
        organization = null;
      }

      // Get vendor bills with optional filter and pagination
      let billsForVendor = [];
      let manualBillCount = 0;
      let manualBillTotal = 0;
      let hasMorePage = false;
      if (recurringData.recurring_bill_id) {
        try {
          const billQuery = {
            organization_id: org_id,
            recurring_bill_id: recurringData.recurring_bill_id,
            deleted_at: null,
          };
          // Apply status filter if provided
          if (filter_status === "paid") {
            billQuery.status_type = { $in: ["PAID"] };
          } else if (filter_status === "unpaid") {
            billQuery.status_type = {
              $in: ["OPEN", "PARTIALLY PAID", "PAID", "DRAFT"],
            };
          }
          // Count total matching bills
          const totalCount = await BillCollection.countDocuments(billQuery);
          // Fetch paginated bills
          billsForVendor = await BillCollection.find(billQuery, {
            bill_number: 1,
            billDate: 1,
            billNumber: 1,
            status_type: 1,
            total: 1,
            _id: 0,
          })
            .populate({
              path: "vendor_id",
              select: "contact_id contact_name", // Only include these fields
            })
            .skip(skip)
            .limit(limitNum)
            .lean();
          manualBillCount = totalCount;
          // Aggregate total sum of filtered bills
          const aggregationResult = await BillCollection.aggregate([
            { $match: billQuery },
            { $group: { _id: null, totalSum: { $sum: "$total" } } },
          ]);
          manualBillTotal = aggregationResult[0]?.totalSum || 0;
          // Pagination metadata
          hasMorePage = pageNum * limitNum < totalCount;
        } catch (dbError) {
          console.error("Customer bills Fetch Error:", dbError);
        }
      }

      // Get customer details
      let vendorDetails;
      if (recurringData.vendor_id) {
        try {
          vendorDetails = await VendorCollection.findOne(
            {
              organization_id: org_id,
              _id: recurringData.vendor_id,
              deleted_at: null,
            },
            {
              vendor_name: 1,
              contact_name: 1,
              email: 1,
              company_name: 1,
              status_formatted: 1,
              billing_address: 1,
            }
          ).lean();
        } catch (dbError) {
          console.error("vendor Details Fetch Error:", dbError);
        }
      }

      // Combine bill data with organization data
      const responseData = {
        ...recurringData,
        vendor_data: vendorDetails,
        bills_for_vendor: billsForVendor,
        organization_details: organization || {},
        applied_filter: filter_status || "all",
        bill_pagination: {
          page: pageNum,
          per_page: limitNum,
          total: manualBillCount,
          has_more_page: hasMorePage,
        },
      };

      return res
        .status(ST_CODES.OK)
        .send({ message: "Successfully fetched", data: responseData });
    } catch (error) {
      console.log("getIndividualBill error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong", error: error.message });
    }
  }

  // Update recurring bill
  async updateRecurring(req, res) {
    try {
      let bData = req.body;
      let orgId = req.query.org_id;
      let recurring_bill_id = req.params.recurring_id;
      const admin_id = res.locals.user_id;

      if (req.file) {
        bData["documents"] = req.file.filename;
      }

      if (!orgId || !bData || Object.keys(bData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and bill data are mandatory.",
        });
      }

      // Validate recurrence_frequency
      const validFrequencies = ["days", "weeks", "months", "years"];
      if (!validFrequencies.includes(bData["recurrence_frequency"])) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Invalid recurrence_frequency. Allowed: days, weeks, months, years.",
        });
      }

      const repeatEvery = parseInt(bData["repeat_every"], 10);
      const frequency = bData["recurrence_frequency"];
      const startDate = moment(bData.start_date, "YYYY-MM-DD");

      if (!startDate.isValid()) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Invalid start_date format. Use YYYY-MM-DD.",
        });
      }

      const nextBillDate = startDate.clone().add(repeatEvery, frequency);
      bData.next_bill_date = nextBillDate.format("YYYY-MM-DD");
      bData.last_sent_date = bData.start_date;

      // Fetch organization
      const orgData = await OrgCollection.findOne({ organization_id: orgId });
      if (!orgData) {
        return res.status(ST_CODES.ORG_NOT_FOUND).json({
          success: true,
          message: MESSAGES.ORG_NOT_FOUND,
        });
      }

      // Add metadata
      bData.organization_id = orgData.organization_id;
      bData.admin_id = admin_id;

      // Append comment history
      const commented_by_id = res.locals.user_id || "";
      const commented_by = res.user?.company_name || "System";
      const description = `Recurring Bill updated for ₹${parseFloat(
        bData.total
      ).toFixed(2)}`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurring_bill_id,
        description,
        "Updated",
        "",
        "recurring_bill"
      );

      bData.$push = { comments: { $each: comment } }; // push comment into existing array

      // Perform update
      const updatedBill = await RecurringBillsCollection.findOneAndUpdate(
        { recurring_bill_id }, // match by recurring_bill_id
        {
          $set: bData,
          $push: { comments: comment },
        },
        { new: true }
      );

      if (!updatedBill) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Recurring bill not found.",
        });
      }

      // Log user activity
      await userActivityHelper(
        admin_id,
        orgId,
        bData.vendor_id,
        `Bill updated for ₹${parseFloat(bData.total).toFixed(2)}`,
        "Bill updated",
        updatedBill._id,
        "po_bill"
      );

      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Recurring Bill has been updated",
        data: updatedBill,
      });
    } catch (error) {
      console.error("updateRecurring Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Unable to update bill. Please try again later.",
      });
    }
  }

  async getRecurringBill(req, res) {
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
        deleted_at: null, // Exclude soft-deleted recurring invoices
      };

      switch (filter) {
        case "Status.Active":
          query.status_type = "active";
          break;
        case "Status.Stopped":
          query.status_type = "stopped";
          break;
        case "Status.Expired":
          query.status_type = "expired";
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
        query.customer_id = customer_id;
      }

      const allowedSortColumns = [
        "vendor_name",
        "recurrence_name",
        "next_bill_date",
        "createdAt",
        "total",
      ];

      // Define sorting order
      let sortField = allowedSortColumns.includes(sort_column)
        ? sort_column
        : "createdAt";
      const sortDirection = sort_order === "A" ? 1 : -1;

      const sort = {};
      sort[sortField] = sortDirection;

      // Fetch recurring bills with pagination & sorting
      let results = await queryHelper.findDataWithPopulate(
        RecurringBillsCollection,
        query,
        {},
        {}, // no sort here
        limit,
        page,
        ["vendor_id"]
      );

      // Post-sort if sort_column is 'contact_name'
      if (sort_column === "vendor_name") {
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

      const totalCount = await RecurringBillsCollection.countDocuments(query);

      const transformedRecurringBills = (results.msg || []).map(
        (recurringBill) => {
          let recurrenceStatus = "Active";
          const now = new Date();
          const endDate = recurringBill.end_date
            ? new Date(recurringBill.end_date)
            : null;

          if (recurringBill.status_type === "stopped") {
            recurrenceStatus = "Stopped";
          } else if (endDate && endDate < now) {
            recurrenceStatus = "Expired";
          }

          const formatRupee = (value) =>
            new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(value || 0);
          let frequency = "";
          const freqMap = {
            days: "Day",
            weeks: "Week",
            months: "Month",
            years: "Year",
          };

          const unit = freqMap[recurringBill.recurrence_frequency];

          if (recurringBill.repeat_every === 1) {
            // Singular form
            frequency = `${unit}ly`; // e.g., Daily, Weekly, Monthly
          } else {
            // Plural form with count
            frequency = `Every ${recurringBill.repeat_every} ${unit}s`; // e.g., Every 2 Weeks
          }

          return {
            recurring_bill_id: recurringBill.recurring_bill_id,
            _id: recurringBill._id,
            recurrence_name: recurringBill.recurrence_name,
            createdAt:
              moment(recurringBill.createdAt).format("DD/MM/YYYY") || "",
            created_time:
              moment(recurringBill.created_time).format("DD/MM/YYYY") || "",
            start_date:
              moment(recurringBill.start_date).format("DD/MM/YYYY") || "",
            next_bill_date:
              (recurringBill?.next_bill_date &&
                moment(recurringBill?.next_bill_date)?.format("DD/MM/YYYY")) ||
              "--",
            end_date:
              moment(recurringBill?.end_date)?.format("DD/MM/YYYY") || "--",
            last_sent_date:
              moment(recurringBill.last_sent_date).format("DD/MM/YYYY") || "",
            recurrence_frequency: frequency,
            organization_id: recurringBill.org_id,
            status: recurrenceStatus,
            total: formatRupee(recurringBill.total),
            sub_total: formatRupee(recurringBill.sub_total),
            tax_total: formatRupee(recurringBill.tax_total),
            discount_total: recurringBill.discount_total || 0,
            discount_total_formatted: formatRupee(recurringBill.discount_total),
            vendor_id: recurringBill.vendor_id?._id || null,
            vendor_name:
              recurringBill.vendor_id?.contact_name || "Unknown Vendor",
            company_name: recurringBill.vendor_id?.company_name || "",
          };
        }
      );
      const hasMorePage = page * limit < totalCount;

      // Construct response
      return res.status(200).json({
        code: 0,
        message: "success",
        recurring_bills: transformedRecurringBills,
        totalCount: totalCount,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage,
          report_name: "Recurring Bills",
          applied_filter: filter,
          custom_fields: [],
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      console.error("getRecurringInvoices Error:", error.message);
      return res.status(500).json({
        code: 1,
        message:
          "Internal Server Error: Unable to fetch recurring invoices. Please try again later.",
      });
    }
  }

  async createBillFromRecurring(req, res) {
    try {
      let bData = req.body;
      let organization_id = req.query.org_id;
      let { recurring_bill_id } = req.params;
      if (req.file) {
        bData["documents"] = req.file.filename;
      }
      // Validate required parameters
      if (
        !organization_id ||
        !bData ||
        Object.keys(bData).length === 0 ||
        !recurring_bill_id
      ) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required parameters: organization_id and bill data are mandatory.",
        });
      }

      let requestData = {
        ...bData,
        status: 0,
        recurring_bill_id: recurring_bill_id,
      };
      const token =
        req.headers.authorization?.split("Bearer ")[1] || res.locals.token;
      // Now create a regular bill using the same data
      let responseData;
      try {
        const billCreate = await apiHandler.createBill(
          organization_id,
          requestData,
          token
        );
        responseData = billCreate.data.data;
      } catch (error) {
        console.error("Failed to create regular bill:", error.message);
      }

      const commented_by_id = res.locals.user_id || "";
      const commented_by = res.user?.company_name || "System";
      const description = "Bill created.";

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurring_bill_id,
        description,
        "Updated",
        "",
        "recurring_bill"
      );

      // Only push comment into existing comments array
      const updatedBill = await RecurringBillsCollection.findOneAndUpdate(
        { recurring_bill_id }, // match by recurring_bill_id
        {
          $push: { comments: { $each: [comment] } }, // if comment is a single object
        },
        { new: true }
      );

      // Decide whether to rollback recurring invoice creation or proceed
      return res.status(200).json({
        code: 0,
        message: "Bill has been created",
        data: responseData,
      });
    } catch (error) {
      console.error("createBillFromRecurring Error:", error.message);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Unable to create bill from recurring. Please try again later.",
      });
    }
  }

  //status handling
  async updateRecurringStatus(req, res) {
    try {
      const { recurring_bill_id, organization_id } = req.query;
      const { status } = req.params;

      if (!recurring_bill_id || !organization_id || !status) {
        return res.status(400).json({ message: "Missing Required Parameters" });
      }

      const validStatus = ["resume", "stop"];
      if (!validStatus.includes(status.toLowerCase())) {
        return res.status(400).json({ message: "The status is not valid" });
      }

      let new_status;
      let status_type;

      if (status.toLowerCase() === "resume") {
        new_status = 0;
        status_type = "active";
      } else if (status.toLowerCase() === "stop") {
        new_status = 1;
        status_type = "stopped";
      }

      const updateRecurringBillStatus =
        await RecurringBillsCollection.findOneAndUpdate(
          {
            recurring_bill_id: recurring_bill_id,
            organization_id: organization_id,
            deleted_at: null,
          },
          {
            $set: {
              status: new_status,
              status_type: status_type,
              last_modified_time: new Date(),
            },
          },
          { new: true }
        );

      if (!updateRecurringBillStatus) {
        return res
          .status(400)
          .json({ message: "Bill or Organization not found" });
      }

      const commented_by_id = res.locals.user_id || "";
      const commented_by = res.user?.company_name || "System";
      const description = `Recurring Bill ${status_type}`;

      const comment = createComments(
        commented_by,
        commented_by_id,
        "system",
        recurring_bill_id,
        description,
        "Updated",
        "",
        "recurring_bill"
      );

      // Perform update
      const updatedBill = await RecurringBillsCollection.findOneAndUpdate(
        { recurring_bill_id }, // match by recurring_bill_id
        {
          $push: { comments: comment },
        },
        { new: true }
      );

      if (!updatedBill) {
        return res.status(400).json({
          success: false,
          message: "Recurring bill not found for updating status comment.",
        });
      }

      res.status(200).send({
        data: updatedBill,
      });
    } catch (error) {
      return res.status(404).json({
        message: "Catch function working in recurring bill status change",
        error: error.message,
      });
    }
  }

  async deleteRecurring(req, res) {
    try {
      const { organization_id } = req.query;
      const { recurring_bill_id } = req.params;

      if (!organization_id || !recurring_bill_id) {
        return res.status(400).json({ message: "Paramaters are not given" });
      }

      const deleteRecurringBill =
        await RecurringBillsCollection.findOneAndUpdate(
          {
            recurring_bill_id: recurring_bill_id,
            organization_id: organization_id,
            deleted_at: null,
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

      if (!deleteRecurringBill) {
        return res
          .status(400)
          .json({ message: "the recurring bill doesn't exist" });
      }

      res.status(200).send({
        data: deleteRecurringBill,
        message: "Recurring bill has been deleted",
      });
    } catch (error) {
      return res.status(404).json({
        message: "Catch function working in recurring bill delete",
        error: error.message,
      });
    }
  }
}

module.exports = new recurringBillsController();
