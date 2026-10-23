const mongoose = require("mongoose");
const ContactCollection = mongoose.model("Contact");
const OrganizationCollection = mongoose.model("Organization");
const ContactPersonCollection = mongoose.model("contactDetails");
const BillsCollection = mongoose.model("PO_bill");
const UserCollection = mongoose.model("user");
const queryHelper = require("../helpers/query");
const commonHelper = require("../helpers/commonHelpers");
const ST_CODES = require("../helpers/statusCodeHelpers");
const MESSAGES = require("../helpers/messageHelpers");
const imagekit = require("../helpers/imageKit");
const TaxExemptionCollection = require("../model/taxExemptionSchema");
const crypto = require("crypto");
const InvoiceCollection = require("../model/invoice");

// Generate Address ID method (add this to your controller)
const generateAddressId = async (prefix, field) => {
  const id = await commonHelper.generateUniqueId(
    ContactCollection,
    field
  );
  return `${prefix}${id.toString().padStart(6, "0")}`; // e.g., A000001
};

class ContactController {
  // 📌 Create a new contact
  async createContact(req, res) {
    try {
      let bData = req.body;

      // Generate unique ID for contact
      let contactUniqueId = await commonHelper.generateUniqueId(
        ContactCollection,
        "contact_id",
        4,
        "CU"
      );
      bData["contact_id"] = contactUniqueId;
      bData["admin_id"] = res.locals.user_id;

      // Set empty object if billing_address or shipping_address not provided
      bData["billing_address"] = bData.billing_address || {};
      bData["shipping_address"] = bData.shipping_address || {};

      // If billing_address provided, generate unique address_id
      if (Object.keys(bData.billing_address).length > 0) {
        let billingAddressId = await commonHelper.generateUniqueId(
          ContactCollection,
          "billing_address.address_id",
          6,
          "B"
        );
        bData.billing_address["address_id"] = billingAddressId;
      }

      // If shipping_address provided, generate unique address_id
      if (Object.keys(bData.shipping_address).length > 0) {
        let shippingAddressId = await commonHelper.generateUniqueId(
          ContactCollection,
          "shipping_address.address_id",
          6,
          "S"
        );
        bData.shipping_address["address_id"] = shippingAddressId;
      }

      // Handle Image Upload if file is provided
      if (req.file) {
        bData["documents"] = req.file.filename;
      } else if (req.body.documents) {
        bData["documents"] = req.body.documents;
      }

      // Handle tax exemption for Customers
      if (bData.contact_type === "Customer") {
        if (bData.tax_exemption_code && !bData.is_taxable) {
          try {
            let getTax = await TaxExemptionCollection.findOne({
              type: "customer",
              tax_exemption_code: bData.tax_exemption_code,
            });

            if (getTax) {
              bData["tax_exemption_id"] = getTax.tax_exemption_id;
            } else {
              let taxUniqueId = await commonHelper.generateUniqueId(
                TaxExemptionCollection,
                "tax_exemption_id"
              );
              let taxBody = {
                type: "customer",
                tax_exemption_id: taxUniqueId,
                tax_exemption_code: bData.tax_exemption_code,
                organization_id: bData.organization_id,
              };
              let newTax = await queryHelper.insertData(
                TaxExemptionCollection,
                taxBody
              );

              if (newTax.status && newTax.msg && newTax.msg.tax_exemption_id) {
                bData["tax_exemption_id"] = newTax.msg.tax_exemption_id;
              }
            }
          } catch (taxError) {
            console.error("Tax exemption error:", taxError);
            // Continue without tax exemption if it fails
          }
        }
      }
      let newContact = await queryHelper.insertData(ContactCollection, bData);
      if (!newContact.status) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ status: newContact.status, message: newContact.msg });
      }

      // Save contact persons if provided
      if (
        Array.isArray(bData.contact_persons) &&
        bData.contact_persons.length > 0
      ) {
        try {
          let contactPersonsData = [];

          for (let person of bData.contact_persons) {
            let contactPersonId = await commonHelper.generateUniqueId(
              ContactPersonCollection,
              "contact_person_id"
            );

            let modelData = {
              contact_person_id: contactPersonId, // This value should not be empty
              admin_id: res.locals.user_id,
              contact_id: contactUniqueId,
              ...person,
            };
            modelData.contact_person_id = contactPersonId;
            modelData.contact_id = contactUniqueId;
            modelData.organization_id = bData.organization_id;

            let newContactPerson = await queryHelper.insertData(
              ContactPersonCollection,
              modelData
            );
            contactPersonsData.push(newContactPerson);
          }
        } catch (personError) {
          console.error("Contact persons error:", personError);
        }
      }
      res
        .status(ST_CODES.OK)
        .send({ status: newContact.status, data: newContact.msg });
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }

  // 📌 Get all contacts with pagination
  async getContacts(req, res) {
    try {
      let { limit = 10, page = 1 } = req.query; // Allow dynamic pagination
      const { organization_id } = req.query;
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      // Validate required parameters
      if (!admin_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }
      // Convert limit and page to numbers
      limit = parseInt(limit, 10);
      page = parseInt(page, 10);
      const skip = (page - 1) * limit;
      // Define query conditions
      const query = {
        admin_id: admin_id,
        organization_id: organization_id,
        deleted_at: null, // Exclude soft-deleted contacts
      };

      // Define sorting order
      const sort = { createdAt: -1 };

      const gets = {};
      // Fetch contacts with pagination & sorting
      const results = await queryHelper.findData(
        ContactCollection,
        query,
        gets,
        sort,
        limit,
        page
      );
      // Check if contacts exist
      if (results?.status && results?.msg?.length > 0) {
        return res.status(ST_CODES.OK).json({
          status: true,
          message: `Contacts retrieved successfully. Total: ${results.msg.length}`,
          total_contacts: results.msg.length,
          data: results.msg,
        });
      } else {
        return res.status(ST_CODES.OK).json({
          status: true,
          message: `No contacts found for organization ID: ${organization_id}.`,
          total_contacts: 0,
          data: [],
        });
      }
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Unable to fetch contacts. Please try again later.",
      });
    }
  }

  // 📌 Get single contact by ID
  async getContactById(req, res) {
    try {
      const { organization_id } = req.query;
      const { contact_id } = req.params;
      const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!organization_id || !contact_id || !admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id, contact_id, or admin_id.",
        });
      }

      // Build contact query. A customer-portal sign-in reads its own
      // contact (the middleware only lets it ask for that one), which
      // belongs to the business user rather than to the client.
      let contactQuery = res.locals.role === "client" ? { organization_id } : { admin_id, organization_id };

      // Handle both ObjectId and string IDs
      if (mongoose.Types.ObjectId.isValid(contact_id)) {
        contactQuery.$or = [
          { contact_id: contact_id },
          { _id: new mongoose.Types.ObjectId(contact_id) },
        ];
      } else {
        contactQuery.contact_id = contact_id;
      }
      const contact = await ContactCollection.findOne(contactQuery);

      if (!contact) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Contact not found for the given organization",
        });
      }

      // Find contact persons
      const contactPersons = await ContactPersonCollection.find({
        contact_id: contact.contact_id,
      });

      // Find organization
      const organization = await OrganizationCollection.findOne({
        organization_id,
        admin_id,
      });

      // Calculate receivable/payable amount based on contact type
      let totalAmount = 0;
      let amountLabel = "";

      try {
        const contactType = contact.type || contact.contact_type; // Adjust field name as needed

        if (contactType === "Customer") {
          // For customers: Calculate receivable amount from unpaid invoices
          amountLabel = "receivable";
          const customerIds = [contact.contact_id];

          const customerAggregationPipeline = [
            {
              $match: {
                $or: [
                  { customer_id: { $in: customerIds } },
                  { contact_id: { $in: customerIds } }, // Fallback if field name differs
                ],
                deleted_at: null,
                status: { $ne: "paid" },
              },
            },
            {
              $group: {
                _id: null,
                total_balance: { $sum: "$balance" },
              },
            },
          ];

          const receivableResult = await InvoiceCollection.aggregate(
            customerAggregationPipeline
          );

          totalAmount =
            receivableResult.length > 0
              ? receivableResult[0].total_balance || 0
              : 0;
        } else if (contactType === "Vendor") {
          // For vendors: Calculate payable amount from unpaid PO bills using aggregation
          amountLabel = "payable";

          const vendorAggregationPipeline = [
            {
              $match: {
                _id: contact._id, // Match the specific contact
              },
            },
            // Lookup for bills (outstanding payables)
            {
              $lookup: {
                from: "po_bills",
                localField: "_id",
                foreignField: "vendor_id",
                as: "vendor_bills",
                pipeline: [
                  {
                    $match: {
                      deleted_at: null,
                      status: { $ne: "paid" }, // Only unpaid bills
                    },
                  },
                ],
              },
            },
            // Calculate total payable amount
            {
              $project: {
                total_payable: {
                  $sum: "$vendor_bills.due_amt",
                },
              },
            },
          ];

          const payableResult = await ContactCollection.aggregate(
            vendorAggregationPipeline
          );

          totalAmount =
            payableResult.length > 0 ? payableResult[0].total_payable || 0 : 0;
        }
      } catch (amountError) {
        console.error(`Error calculating ${amountLabel} amount:`, amountError);
      }

      const contactData = contact.toObject();
      contactData.contact_persons = contactPersons || [];

      // Add organization details if available
      contactData.organization = organization
        ? {
            organization_id: organization.organization_id,
            org_name: organization.org_name,
            first_street: organization.first_street,
            second_street: organization.second_street,
            city: organization.city,
            country: organization.country,
            gst_in: organization.gst_in,
            phone: organization.phone,
            zip: organization.zip,
            state: organization.state,
            tax_basis: organization.tax_basis,
            time_zone: organization.time_zone,
            date_format: organization.date_format,
            currency_code: organization.currency_code,
            currency_symbol: organization.currency_symbol,
            plan_type: organization.plan_type,
            plan_name: organization.plan_name,
            portal_name: organization.portal_name,
            user_status: organization.user_status,
          }
        : null;
      // Add admin email based on admin_id
      const admin = await UserCollection.findOne(
        { _id: admin_id },
        { email: 1 }
      );
      contactData.admin_email = admin ? admin.email : null;

      // Add amount fields based on contact type
      const contactType = contact.type || contact.contact_type;
      const currencySymbol = organization?.currency_symbol || "$";
      const currencyCode = organization?.currency_code || "USD";

      if (contactType === "Customer") {
        contactData.total_receivable_amount = totalAmount;
        contactData.total_receivable_amount_formatted = `${currencySymbol}${totalAmount.toFixed(
          2
        )}`;
      } else if (contactType === "Vendor") {
        contactData.total_payable_amount = totalAmount;
        contactData.total_payable_amount_formatted = `${currencySymbol}${totalAmount.toFixed(
          2
        )}`;
      } else {
        contactData.total_receivable_amount = totalAmount;
        contactData.total_receivable_amount_formatted = `${currencySymbol}${totalAmount.toFixed(
          2
        )}`;
      }
      return res.status(ST_CODES.OK).json({
        status: true,
        data: contactData,
      });
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Something went wrong while retrieving contact details",
        error: error.message,
      });
    }
  }

  // 📌 Update contact
  async updateContact(req, res) {
    try {
      const contactId = req.query.contact_id;
      const adminId = res.locals.user_id;
      const body = req.body;

      if (!contactId) {
        return res.status(400).send({
          status: false,
          message: "contact_id is required",
        });
      }

      // Set image if uploaded
      if (req.file) {
        body.documents = req.file.filename;
      }

      // Ensure addresses are defined
      body.billing_address = body.billing_address || {};
      body.shipping_address = body.shipping_address || {};

      // Update Contact
      const updated = await ContactCollection.findOneAndUpdate(
        { contact_id: contactId },
        { ...body, admin_id: adminId },
        { new: true }
      );

      if (!updated) {
        return res.status(404).send({
          status: false,
          message: "Contact not found",
        });
      }

      // Handle contact persons
      if (Array.isArray(body.contact_persons)) {
        for (const person of body.contact_persons) {
          if (person.contact_person_id) {
            // Update existing contact person
            await ContactPersonCollection.findOneAndUpdate(
              { contact_person_id: person.contact_person_id },
              {
                ...person,
                contact_id: contactId,
                admin_id: adminId,
                organization_id: body.organization_id,
              },
              { new: true }
            );
          } else {
            // Create new contact person
            const newId = await commonHelper.generateUniqueId(
              ContactPersonCollection,
              "contact_person_id"
            );

            await ContactPersonCollection.create({
              ...person,
              contact_person_id: newId,
              contact_id: contactId,
              admin_id: adminId,
              organization_id: body.organization_id,
            });
          }
        }
      }

      return res.status(200).send({
        status: true,
        message: "Contact updated successfully",
        data: updated,
      });
    } catch (error) {
      return res.status(500).send({
        status: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }

  // 📌 Delete contact
  async deleteContact(req, res) {
    try {
      const { organization_id, contact_id } = req.query;
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      // Validate required parameters
      if (!organization_id || !contact_id || !admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "organization_id, contact_id, and admin_id are required",
        });
      }

      // Find the contact using string-based contact_id
      let contact = await ContactCollection.findOne({
        contact_id: contact_id, // No ObjectId conversion
        organization_id: organization_id,
        admin_id: admin_id, // Ensure only admin can delete contacts
        deleted_at: null, // Ensure it's not already deleted
      });

      if (!contact) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Contact not found for this organization",
        });
      }

      // Perform soft delete by setting deleted_at timestamp
      contact.deleted_at = new Date();
      await contact.save();

      res.status(ST_CODES.OK).send({
        status: true,
        message: "Contact deleted successfully", //soft delete
        data: contact,
      });
    } catch (error) {
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong",
      });
    }
  }

  // 📌 vendor overview based on the org_is and admin_id
  async getVendors(req, res) {
    try {
      const { organization_id } = req.query;
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      // Validate required parameters
      if (!organization_id || !admin_id) {
        return res.status(400).json({
          status: false,
          message: "Missing required parameters: organization_id and admin_id",
        });
      }

      // Define query conditions
      const where = {
        admin_id: admin_id,
        organization_id: organization_id,
        status: "Active",
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }], // Handle cases where deleted_at is missing
      };

      // Define fields to return
      const gets = {
        first_name: 1,
        last_name: 1,
        company_name: 1,
        email: 1,
        contact_type: 1,
        createdAt: 1, // Include created date for sorting
      };

      // Define sorting order
      const sorts = { createdAt: -1, contact_name: 1 };
      // Fetch vendors using direct MongoDB query instead of queryHelper
      const vendors = await ContactCollection.find(where, gets)
        .sort(sorts)
        .limit(10);
      // Check if vendors exist
      if (vendors.length > 0) {
        return res.status(ST_CODES.OK).json({
          status: true,
          message: "Vendors retrieved successfully",
          total_vendors: vendors.length,
          data: vendors,
        });
      } else {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "No vendors found for the given organization",
        });
      }
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "An error occurred while fetching vendors. Please try again later.",
      });
    }
  }

  // 📌 customer overview based on the org_is and admin_id
  async getCustomers(req, res) {
    try {
      const { organization_id } = req.query;
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      // Validate required parameters
      if (!organization_id || !admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Missing required parameters: organization_id and admin_id",
        });
      }
      // Define query conditions
      const where = {
        admin_id: admin_id,
        organization_id: organization_id,
        contact_type: "Customer",
        deleted_at: null, // Exclude soft-deleted contacts
      };

      // Define fields to return
      const gets = {
        contact_id: 1,
        contact_name: 1,
        company_name: 1,
        phone: 1,
        contact_type: 1,
      };

      // Define sorting order
      const sorts = { createdAt: -1, contact_name: 1 };

      // Fetch customers
      const customers = await queryHelper.findData(
        ContactCollection,
        where,
        gets,
        sorts,
        10, // Limit
        1 // Page
      );

      if (customers.status && customers.msg.length > 0) {
        return res.status(ST_CODES.OK).json({
          status: true,
          message: "Customers retrieved successfully",
          total_customers: customers.msg.length,
          data: customers.msg,
        });
      } else {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "No customers found for the given organization",
        });
      }
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "An error occurred while fetching customers. Please try again later.",
      });
    }
  }

  // 📌 customer overview based on the org_is and admin_id
  async contactStatus(req, res) {
    try {
      const { organization_id, contact_id } = req.query; // Only these two query params allowed
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      if (!organization_id || !admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "organization_id and contact is required",
        });
      }

      // Find the contact based on organization_id and admin_id
      const contact = await ContactCollection.findOne({
        organization_id: organization_id,
        contact_id: contact_id,
        admin_id: admin_id,
      });

      if (!contact) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Contact not found",
        });
      }

      // Toggle status (if "Active" -> "Inactive", else "Active")
      const newStatus = contact.status === "active" ? "inactive" : "active";

      // Update contact status in database
      await ContactCollection.updateOne(
        { _id: contact._id },
        { $set: { status: newStatus } }
      );

      res.status(ST_CODES.OK).json({
        status: true,
        message: `The Contact has been marked as ${newStatus}.`,
        updated_status: newStatus,
        contact_id: contact.contact_id,
      });
    } catch (error) {
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Something went wrong",
      });
    }
  }

  async addAddress(req, res) {
  try {
    const { organization_id, contact_id } = req.query;
    const addressData = req.body;

    // Check for required parameters
    if (!organization_id || !contact_id) {
      return res.status(400).json({ 
        status: false, 
        message: "Missing required parameters" 
      });
    }

    // Find contact to validate existence
    const contact = await ContactCollection.findOne({
      organization_id,
      contact_id,
    });
    
    if (!contact) {
      return res.status(404).json({ 
        status: false, 
        message: "Contact not found" 
      });
    }

    let updateQuery = {};
    let addressType = "";

    // Generate address_id based on address type
    if (addressData.billing_address) {
      const address_id = await generateAddressId("BA", "billing_address.address_id");
      addressData.billing_address.address_id = address_id;
      updateQuery["billing_address"] = addressData.billing_address;
      addressType = "billing_address";
    } else if (addressData.shipping_address) {
      const address_id = await generateAddressId("SA", "shipping_address.address_id");
      addressData.shipping_address.address_id = address_id;
      updateQuery["shipping_address"] = addressData.shipping_address;
      addressType = "shipping_address";
    } else if (addressData.additional_address) {
      const address_id = await generateAddressId("AA", "additional_address.address_id");
      addressData.additional_address.address_id = address_id;
      updateQuery["$push"] = { additional_address: addressData.additional_address };
      addressType = "additional_address";
    }

    if (!addressType) {
      return res.status(400).json({
        status: false,
        message: "Invalid address data format",
      });
    }

    // Perform update
    const updateResult = await ContactCollection.updateOne(
      { organization_id, contact_id },
      updateQuery
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({
        status: false,
        message: "Failed to add address",
      });
    }

    res.status(200).json({
      status: true,
      message: `${addressType.replace("_", " ")} added successfully`,
      address_id: addressType === "additional_address" 
        ? addressData.additional_address.address_id 
        : addressType === "billing_address"
        ? addressData.billing_address.address_id
        : addressData.shipping_address.address_id
    });
  } catch (error) {
    console.error("Error in addAddress:", error);
    res.status(500).json({ 
      status: false, 
      message: "Something went wrong", 
      error: error.message 
    });
  }
}
  // 📌 update the customer additional details
  async updateAddress(req, res) {
  try {
    const { organization_id, contact_id, address_id } = req.query;
    const updatedAddressData = req.body;

    // Debug logs
    console.log("Query parameters:", req.query);
    console.log("Request body:", req.body);

    // Check for required parameters
    if (!organization_id || !contact_id || !address_id) {
      return res.status(400).json({ 
        status: false, 
        message: "Missing required parameters" 
      });
    }

    // Find contact to validate existence
    const contact = await ContactCollection.findOne({
      organization_id,
      contact_id,
    });
    
    if (!contact) {
      return res.status(404).json({ 
        status: false, 
        message: "Contact not found" 
      });
    }

    let updateQuery = {};
    let addressType = "";

    // Check and update Billing Address
    if (
      contact.billing_address &&
      contact.billing_address.address_id === address_id
    ) {
      addressType = "billing_address";
      updateQuery = Object.keys(updatedAddressData).reduce((acc, key) => {
        if (updatedAddressData[key] !== undefined) {
          acc[`billing_address.${key}`] = updatedAddressData[key];
        }
        return acc;
      }, {});
    }
    // Check and update Shipping Address
    else if (
      contact.shipping_address &&
      contact.shipping_address.address_id === address_id
    ) {
      addressType = "shipping_address";
      updateQuery = Object.keys(updatedAddressData).reduce((acc, key) => {
        if (updatedAddressData[key] !== undefined) {
          acc[`shipping_address.${key}`] = updatedAddressData[key];
        }
        return acc;
      }, {});
    }
    // Check and update Additional Address
    else {
      const additionalAddressMatch = (contact.additional_address || []).find(
        (addr) => addr.address_id === address_id
      );
      if (additionalAddressMatch) {
        addressType = "additional_address";
        updateQuery = Object.keys(updatedAddressData).reduce((acc, key) => {
          if (updatedAddressData[key] !== undefined) {
            acc[`additional_address.$[elem].${key}`] = updatedAddressData[key];
          }
          return acc;
        }, {});
      }
    }

    // If no matching address found
    if (!addressType) {
      return res.status(404).json({
        status: false,
        message: "Address with given address_id not found",
      });
    }

    let updateOptions = {};
    if (addressType === "additional_address") {
      updateOptions = {
        arrayFilters: [{ "elem.address_id": address_id }],
      };
    }

    // Perform update
    const updateResult = await ContactCollection.updateOne(
      { organization_id, contact_id },
      { $set: updateQuery },
      updateOptions
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({
        status: false,
        message: "No changes were made to the address",
      });
    }

    res.status(200).json({
      status: true,
      message: `${addressType.replace("_", " ")} updated successfully`,
    });
  } catch (error) {
    console.error("Error in updateAddress:", error);
    res.status(500).json({ 
      status: false, 
      message: "Something went wrong", 
      error: error.message 
    });
  }
}

  // 📌 Delete the customer additional details
  async deleteAdditionalAddress(req, res) {
    try {
      const { organization_id, contact_id, address_id } = req.query;

      // Check for required parameters
      if (!organization_id || !contact_id || !address_id) {
        return res
          .status(400)
          .json({ status: false, message: "Missing required parameters" });
      }

      // Check if contact exists (optional but good practice)
      const contact = await ContactCollection.findOne({
        organization_id,
        contact_id,
      });
      if (!contact) {
        return res
          .status(404)
          .json({ status: false, message: "Contact not found" });
      }

      // Perform delete (pull the address from array)
      const updateResult = await ContactCollection.updateOne(
        { organization_id, contact_id },
        { $pull: { additional_address: { address_id } } } // Pull matching address_id
      );

      if (updateResult.modifiedCount === 0) {
        return res.status(404).json({
          status: false,
          message: "Additional address not found or already deleted",
        });
      }

      res.status(200).json({
        status: true,
        message: "Additional address deleted successfully",
      });
    } catch (error) {
      res
        .status(500)
        .json({ status: false, message: "Something went wrong", error });
    }
  }

  // 📌 CREATE Additional Address
  async createAddresses(req, res) {
    try {
      const { organization_id, contact_id } = req.query;
      const { billing_address, shipping_address, additional_address } =
        req.body;

      // Validate required parameters
      if (!organization_id || !contact_id) {
        return res
          .status(400)
          .json({ status: false, message: "Missing required parameters" });
      }

      // Find contact
      const contact = await ContactCollection.findOne({
        organization_id,
        contact_id,
      });
      if (!contact) {
        return res
          .status(404)
          .json({ status: false, message: "Contact not found" });
      }

      let updateFields = {};

      // ===== Helper function to generate address ID with prefix and padding =====
      const generateAddressId = async (prefix, field) => {
        const id = await commonHelper.generateUniqueId(
          ContactCollection,
          field
        );
        return `${prefix}${id.toString().padStart(6, "0")}`; // e.g., A000001
      };

      // ===== Process Billing and Shipping Address =====
      const processAddress = async (address, prefix, fieldName) => {
        if (
          address &&
          typeof address === "object" &&
          Object.keys(address).length
        ) {
          if (!address.address_id) {
            address.address_id = await generateAddressId(
              prefix,
              `${fieldName}.address_id`
            );
          }
          updateFields[fieldName] = address;
        }
      };

      await processAddress(billing_address, "B", "billing_address");
      await processAddress(shipping_address, "S", "shipping_address");

      // ===== Process Additional Address =====
      if (
        additional_address &&
        typeof additional_address === "object" &&
        Object.keys(additional_address).length
      ) {
        const existingAddresses = contact.additional_address || [];

        // Find max numeric part of existing additional address_ids
        const maxId = existingAddresses.reduce((max, addr) => {
          const num = parseInt((addr.address_id || "").replace("A", "")) || 0;
          return Math.max(max, num);
        }, 0);

        // Generate next address_id
        additional_address.address_id = `A${(maxId + 1)
          .toString()
          .padStart(6, "0")}`;

        // Append to additional_address array
        updateFields.additional_address = [
          ...existingAddresses,
          additional_address,
        ];
      }

      // ===== Final Update Check =====
      if (!Object.keys(updateFields).length) {
        return res.status(400).json({
          status: false,
          message: "No address data provided to update",
        });
      }

      // ===== Perform Update =====
      await ContactCollection.updateOne(
        { organization_id, contact_id },
        { $set: updateFields }
      );

      // ===== Success Response =====
      res.status(201).json({
        status: true,
        message: "Address added successfully",
        data: updateFields,
      });
    } catch (error) {
      res
        .status(500)
        .json({ status: false, message: "Something went wrong", error });
    }
  }

  // 📌Get Customers with filter
  async getFilteredCustomers(req, res) {
    try {
      let {
        limit = 10,
        page = 1,
        filter_by = "",
        sort_column = "createdAt",
        sort_order = "D",
        usestate = "false",
        organization_id,
      } = req.query;

      const admin_id = res.locals.user_id;

      // Check required parameters
      if (!admin_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }

      // Convert page & limit to numbers
      limit = parseInt(limit, 10);
      page = parseInt(page, 10);
      const skip = (page - 1) * limit;

      const allowedSortColumns = [
        "contact_name",
        "email",
        "createdAt",
        "updatedAt",
        "company_name",
        "outstanding_receivable_amount_bcy",
        "unused_credits_receivable_amount_bcy",
      ];

      if (!allowedSortColumns.includes(sort_column)) {
        sort_column = "createdAt"; // fallback default
      }

      // Fetch organization details
      const organization = await OrganizationCollection.findOne({
        organization_id: organization_id,
        admin_id: admin_id,
      });

      if (!organization) {
        return res.status(ST_CODES.ORG_NOT_FOUND).json({
          success: true,
          message: MESSAGES.ORG_NOT_FOUND,
        });
      }

      // Organization details for response
      const orgDetails = {
        organization_id: organization.organization_id,
        org_name: organization.org_name,
        currency_code: organization.currency_code,
        currency_symbol: organization.currency_symbol || "₹",
      };

      // Base match query
      const matchQuery = {
        admin_id: admin_id,
        organization_id: organization_id,
        deleted_at: null,
        contact_type: "Customer",
      };

      // Apply filters
      switch (filter_by) {
        case "Status.Active":
          matchQuery.status = "active";
          break;
        case "Status.PortalEnabled":
          matchQuery.is_portal_enabled = true;
          break;
        case "Status.PortalDisabled":
          matchQuery.is_portal_enabled = false;
          break;
        case "Status.Inactive":
          matchQuery.status = "inactive";
          break;
        case "Invoice.Unpaid":
          // This will be handled in aggregation
          break;
        case "Status.All":
        case "":
          break;
        default:
          break;
      }

      // First try direct query for basic customer data
      const sortOrder = sort_order === "A" ? 1 : -1;
      const sortObj = {};
      sortObj[sort_column] = sortOrder;
      let query = ContactCollection.find(matchQuery)
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean();

      if (["contact_name", "email", "company_name"].includes(sort_column)) {
        query = query.collation({ locale: "en", strength: 2 });
      }

      const directQueryResults = await query;

      const totalCount = await ContactCollection.countDocuments(matchQuery);

      // If we have results, proceed to enhance with aggregation data
      let enhancedCustomers = [];

      if (directQueryResults.length > 0) {
        // Get all customer IDs from the direct query results
        const customerIds = directQueryResults.map(
          (c) => c.customer_id || c.contact_id
        );

        // Aggregation pipeline to get financial data for these customers
        const aggregationPipeline = [
          {
            $match: {
              $or: [
                { customer_id: { $in: customerIds } },
                { contact_id: { $in: customerIds } }, // Fallback if field name differs
              ],
            },
          },
          // Lookup for invoices (outstanding receivables)
          {
            $lookup: {
              from: "invoices",
              let: { contactId: "$contact_id" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$customer_id", "$$contactId"] },
                    deleted_at: null,
                    status: { $ne: "paid" },
                  },
                },
                { $project: { balance: 1 } },
              ],
              as: "unpaid_invoices",
            },
          },
          // Lookup for payments (unused credits)
          {
            $lookup: {
              from: "customerpayments",
              let: { contactId: "$contact_id" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$customer_id", "$$contactId"] },
                    deleted_at: null,
                    is_advance_payment: true,
                  },
                },
                { $project: { amount: 1 } },
              ],
              as: "unused_payments",
            },
          },
          // Add calculated fields
          {
            $addFields: {
              outstanding_receivable_amount: {
                $sum: "$unpaid_invoices.balance",
              },
              unused_credits_receivable_amount: {
                $sum: "$unused_payments.amount",
              },
              invoice_count: { $size: "$unpaid_invoices" },
              payment_count: { $size: "$unused_payments" },
            },
          },
          // Project only the fields we need
          {
            $project: {
              customer_id: 1,
              contact_id: 1,
              outstanding_receivable_amount: 1,
              unused_credits_receivable_amount: 1,
              invoice_count: 1,
              payment_count: 1,
            },
          },
        ];

        // Execute aggregation
        const financialData = await ContactCollection.aggregate(
          aggregationPipeline
        );

        // Create a map of financial data by customer ID
        const financialDataMap = {};
        financialData.forEach((item) => {
          const key = item.customer_id || item.contact_id;
          financialDataMap[key] = item;
        });

        // Merge direct query results with aggregation data
        enhancedCustomers = directQueryResults.map((customer) => {
          const customerKey = customer.customer_id || customer.contact_id;
          const financials = financialDataMap[customerKey] || {};

          return {
            ...customer,
            outstanding_receivable_amount:
              financials.outstanding_receivable_amount || 0,
            unused_credits_receivable_amount:
              financials.unused_credits_receivable_amount || 0,
            invoice_count: financials.invoice_count || 0,
            payment_count: financials.payment_count || 0,
          };
        });

        if (
          sort_column === "outstanding_receivable_amount_bcy" ||
          sort_column === "unused_credits_receivable_amount_bcy"
        ) {
          enhancedCustomers.sort((a, b) => {
            const aAmount =
              sort_column === "outstanding_receivable_amount_bcy"
                ? a.outstanding_receivable_amount || 0
                : a.unused_credits_receivable_amount || 0;

            const bAmount =
              sort_column === "outstanding_receivable_amount_bcy"
                ? b.outstanding_receivable_amount || 0
                : b.unused_credits_receivable_amount || 0;

            return sortOrder === 1 ? aAmount - bAmount : bAmount - aAmount;
          });
        }

        // Apply additional filtering if needed (like Invoice.Unpaid)
        if (filter_by === "Invoice.Unpaid") {
          enhancedCustomers = enhancedCustomers.filter(
            (customer) => customer.outstanding_receivable_amount > 0
          );
        }
      }

      // Helper function for currency formatting
      const formatCurrency = (amount) => {
        return `${orgDetails.currency_symbol}${(amount || 0).toLocaleString(
          "en-IN",
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }
        )}`;
      };
      const paginatedCustomers =
        sort_column === "outstanding_receivable_amount_bcy" ||
        sort_column === "unused_credits_receivable_amount_bcy"
          ? enhancedCustomers.slice(skip, skip + limit)
          : enhancedCustomers;

      // Format contacts for response
      const formattedContacts = paginatedCustomers.map((contact) => {
        const outstanding = contact.outstanding_receivable_amount || 0;
        const unusedCredits = contact.unused_credits_receivable_amount || 0;

        return {
          _id: contact._id,
          contact_id: contact.contact_id,
          contact_name: contact.contact_name || "",
          customer_name: contact.customer_name || "",
          company_name: contact.company_name || "",
          website: contact.website || "",
          language_code: contact.language_code || "en",
          language_code_formatted:
            contact.language_code === "en" ? "English" : "",
          contact_type: "customer",
          contact_type_formatted: "Customer",
          status: contact.status || "inactive",
          status_formatted: contact.status === "active" ? "Active" : "Inactive",
          customer_sub_type: contact.customer_sub_type || "",
          customer_sub_type_formatted: contact.customer_sub_type
            ? contact.customer_sub_type.charAt(0).toUpperCase() +
              contact.customer_sub_type.slice(1)
            : "",
          source: contact.source || "",
          source_formatted: contact.source || "",
          is_linked_with_zohocrm: contact.is_linked_with_zohocrm || false,
          payment_terms: contact.payment_terms || 0,
          payment_terms_label: `Net ${contact.payment_terms || 0}`,
          currency_id: contact.currency_id || "",
          twitter: contact.twitter || "",
          facebook: contact.facebook || "",
          currency_code: contact.currency_code || "",
          outstanding_receivable_amount: outstanding,
          outstanding_receivable_amount_formatted: formatCurrency(outstanding),
          outstanding_receivable_amount_bcy: outstanding,
          outstanding_receivable_amount_bcy_formatted:
            formatCurrency(outstanding),
          unused_credits_receivable_amount: unusedCredits,
          unused_credits_receivable_amount_formatted:
            formatCurrency(unusedCredits),
          unused_credits_receivable_amount_bcy: unusedCredits,
          unused_credits_receivable_amount_bcy_formatted:
            formatCurrency(unusedCredits),
          invoice_count: contact.invoice_count || 0,
          payment_count: contact.payment_count || 0,
          first_name: contact.first_name || "",
          last_name: contact.last_name || "",
          email: contact.email || "",
          phone: contact.phone || "",
          phone_formatted: contact.phone || "",
          mobile: contact.mobile || "",
          mobile_formatted: contact.mobile || "",
          is_portal_enabled: contact.is_portal_enabled || false,
          portal_status: contact.portal_status || "",
          portal_status_formatted: contact.portal_status || "",
          created_time: contact.createdAt,
          created_time_formatted: contact.createdAt
            ? new Date(contact.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            : "",
          last_modified_time: contact.updatedAt,
          last_modified_time_formatted: contact.updatedAt
            ? new Date(contact.updatedAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            : "",
          custom_fields: contact.custom_fields || [],
          custom_field_hash: contact.custom_field_hash || {},
          tags: contact.tags || [],
          ach_supported: contact.ach_supported || false,
          gst_no: contact.gst_no || "",
          gst_treatment: contact.gst_treatment || "",
          gst_treatment_formatted: contact.gst_treatment_formatted || "",
          place_of_contact: contact.place_of_contact || "",
          place_of_contact_formatted: contact.place_of_contact_formatted || "",
          has_attachment: contact.has_attachment || false,
          pan_no: contact.pan_no || "",
          documents: contact.documents || null,
        };
      });

      const hasMorePage = page * limit < totalCount;

      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Customers fetched successfully",
        data: formattedContacts,
        organization: orgDetails,
        page_context: {
          page: page,
          per_page: limit,
          has_more_page: hasMorePage,
          total_count: totalCount,
          report_name: "Contacts",
          applied_filter: filter_by,
          custom_fields: [],
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        code: 1,
        message: "Internal server error while fetching customers",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // 📌Get vendors with filter
  async getFilteredVendors(req, res) {
    try {
      let {
        page = 1,
        per_page = 25,
        filter = "",
        sort_column = "createdAt",
        sort_order = "D",
        usestate = "false",
        organization_id,
      } = req.query;

      const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!admin_id || !organization_id) {
        return res.status(400).json({
          code: 1,
          message:
            "Missing required parameters: organization_id and admin_id are mandatory.",
        });
      }

      // Convert to proper types
      page = parseInt(page, 10);
      per_page = parseInt(per_page, 10);
      const skip = (page - 1) * per_page;

      const allowedSortColumns = [
        "contact_name",
        "email",
        "createdAt",
        "updatedAt",
        "company_name",
        "outstanding_payable_amount_bcy",
        "unused_credits_payable_amount_bcy",
      ];

      if (!allowedSortColumns.includes(sort_column)) {
        sort_column = "createdAt"; // fallback default
      }

      // Fetch organization details
      const organization = await OrganizationCollection.findOne({
        organization_id: organization_id,
        admin_id: admin_id,
      });

      if (!organization) {
        return res.status(404).json({
          code: 1,
          message: "Organization not found.",
        });
      }

      // Extract organization details
      const orgDetails = {
        organization_id: organization.organization_id,
        org_name: organization.org_name,
        currency_code: organization.currency_code,
        currency_symbol: organization.currency_symbol,
        // ... include other org details as needed
      };

      // Base match query
      const matchQuery = {
        admin_id: new mongoose.Types.ObjectId(admin_id),
        organization_id: organization_id,
        deleted_at: null,
        contact_type: "Vendor",
      };

      // Apply filters
      switch (filter) {
        case "Status.Active":
          matchQuery.status = "active";
          break;
        case "Status.InActive":
          matchQuery.status = "inactive";
          break;
        case "Status.Overdue":
          matchQuery.status_type = "duplicate";
          break;
        case "Status.Enabled":
          matchQuery.is_portal_enabled = true;
          break;
        case "Status.Disable":
          matchQuery.is_portal_enabled = false;
          break;
      }

      const sortOrder = sort_order === "A" ? 1 : -1;
      const sortObj = {};
      sortObj[sort_column] = sortOrder;

      // Main aggregation pipeline
      const aggregationPipeline = [
        {
          $match: matchQuery,
        },
        // Lookup for bills (outstanding payables)
        {
          $lookup: {
            from: "po_bills",
            localField: "_id",
            foreignField: "vendor_id",
            as: "vendor_bills",
            pipeline: [
              {
                $match: {
                  deleted_at: null,
                  status: { $ne: "paid" }, // Only unpaid bills
                },
              },
            ],
          },
        },
        // Lookup for payments (unused credits)
        {
          $lookup: {
            from: "payments",
            localField: "_id",
            foreignField: "contact_id",
            as: "vendor_payments",
            pipeline: [
              {
                $match: {
                  deleted_at: null,
                  payment_type: "VendorAdvance", // Only unused payments
                },
              },
            ],
          },
        },
        // Add calculated fields
        {
          $addFields: {
            outstanding_payable_amount: { $sum: "$vendor_bills.due_amt" },
            unused_credits_payable_amount: { $sum: "$vendor_payments.amount" },
            bill_count: { $size: "$vendor_bills" },
            payment_count: { $size: "$vendor_payments" },
          },
        },
        // Sorting
        {
          $sort: sortObj,
        },
        // Pagination
        {
          $facet: {
            paginatedResults: [{ $skip: skip }, { $limit: per_page }],
            totalCount: [{ $count: "count" }],
          },
        },
      ];

      // Execute aggregation
      const [aggregationResult] = await ContactCollection.aggregate(
        aggregationPipeline
      );
      let vendors = aggregationResult.paginatedResults || [];
      const totalCount = aggregationResult.totalCount[0]?.count || 0;

      if (
        sort_column === "outstanding_payable_amount_bcy" ||
        sort_column === "unused_credits_payable_amount_bcy"
      ) {
        vendors.sort((a, b) => {
          const aAmount =
            sort_column === "outstanding_payable_amount_bcy"
              ? a.outstanding_payable_amount || 0
              : a.unused_credits_payable_amount || 0;

          const bAmount =
            sort_column === "outstanding_payable_amount_bcy"
              ? b.outstanding_payable_amount || 0
              : b.unused_credits_payable_amount || 0;

          return sortOrder === 1 ? aAmount - bAmount : bAmount - aAmount;
        });

        // Manual pagination since we sorted post aggregation
        vendors = vendors.slice((page - 1) * per_page, page * per_page);
      }

      // Format vendors with all fields
      const formattedVendors = vendors.map((vendor) => {
        const outstanding_payable = vendor.outstanding_payable_amount || 0;
        const unused_credits = vendor.unused_credits_payable_amount || 0;
        // Helper function for currency formatting
        const formatCurrency = (amount) => {
          return `${orgDetails.currency_symbol}${amount.toLocaleString(
            "en-IN",
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          )}`;
        };

        return {
          // Core vendor information
          _id: vendor._id,
          contact_id: vendor.contact_id,
          contact_name: vendor.contact_name || "",
          company_name: vendor.company_name || "",

          // Financial information - Payables
          outstanding_payable_amount: outstanding_payable,
          outstanding_payable_amount_formatted:
            formatCurrency(outstanding_payable),
          outstanding_payable_amount_bcy: outstanding_payable,
          outstanding_payable_amount_bcy_formatted:
            formatCurrency(outstanding_payable),

          // Financial information - Unused Credits
          unused_credits_payable_amount: unused_credits,
          unused_credits_payable_amount_formatted:
            formatCurrency(unused_credits),
          unused_credits_payable_amount_bcy: unused_credits,
          unused_credits_payable_amount_bcy_formatted:
            formatCurrency(unused_credits),

          // Financial information - Receivables (from contact document)
          outstanding_receivable_amount:
            vendor.outstanding_receivable_amount || 0,
          outstanding_receivable_amount_formatted: formatCurrency(
            vendor.outstanding_receivable_amount || 0
          ),
          outstanding_receivable_amount_bcy:
            vendor.outstanding_receivable_amount_bcy || 0,
          outstanding_receivable_amount_bcy_formatted: formatCurrency(
            vendor.outstanding_receivable_amount_bcy || 0
          ),

          unused_credits_receivable_amount:
            vendor.unused_credits_receivable_amount || 0,
          unused_credits_receivable_amount_formatted: formatCurrency(
            vendor.unused_credits_receivable_amount || 0
          ),
          unused_credits_receivable_amount_bcy:
            vendor.unused_credits_receivable_amount_bcy || 0,
          unused_credits_receivable_amount_bcy_formatted: formatCurrency(
            vendor.unused_credits_receivable_amount_bcy || 0
          ),

          // Opening balances
          opening_balance_amount: vendor.opening_balance_amount || 0,
          opening_balance_amount_formatted: formatCurrency(
            vendor.opening_balance_amount || 0
          ),
          opening_balance_amount_bcy: vendor.opening_balance_amount_bcy || 0,
          opening_balance_amount_bcy_formatted: formatCurrency(
            vendor.opening_balance_amount_bcy || 0
          ),

          // Contact details
          first_name: vendor.first_name || "",
          last_name: vendor.last_name || "",
          email: vendor.email || "",
          phone: vendor.phone || "",

          // Status information
          status: vendor.status || "inactive",
          status_formatted: vendor.status === "active" ? "Active" : "Inactive",

          // Portal information
          is_portal_enabled: vendor.is_portal_enabled || false,

          // Timestamps
          created_time: vendor.createdAt,
          created_time_formatted: vendor.createdAt
            ? new Date(vendor.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            : "",

          // Counts for debugging
          bill_count: vendor.bill_count || 0,
          payment_count: vendor.payment_count || 0,

          // Include all other fields from the original implementation
          // ... add any additional fields needed
        };
      });

      return res.status(200).json({
        status: true,
        message: "Vendors fetched successfully",
        data: formattedVendors,
        organization: orgDetails,
        page_context: {
          page: page,
          per_page: per_page,
          has_more_page: page * per_page < totalCount,
          total_count: totalCount,
          report_name: "Vendors",
          applied_filter: filter,
          sort_column: sort_column,
          sort_order: sort_order,
        },
      });
    } catch (error) {
      return res.status(500).json({
        code: 1,
        message: "Internal server error while fetching vendors",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // 📌 Add this method to your contact controller
  async getContactComments(req, res) {
    try {
      const { contact_id, organization_id } = req.query;
      const admin_id = res.locals.user_id; // Fetch admin_id from session

      // Validate required parameters
      if (!admin_id || !organization_id || !contact_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: organization_id, contact_id, and admin_id are mandatory.",
        });
      }
      // Define query conditions
      const query = {
        admin_id: admin_id,
        organization_id: organization_id,
        contact_id: contact_id,
        // commented_by:commented_by,
        deleted_at: null, // Exclude soft-deleted contacts
      };
      // Find the contact
      const contact = await ContactCollection.findOne(query);

      if (!contact) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: `Contact not found for ID: ${contact_id}`,
        });
      }

      // Get comments from the contact document
      const comments = contact.comments || [];

      // Sort comments by date (newest first)
      const sortedComments = comments.sort((a, b) => {
        return new Date(b.date) - new Date(a.date);
      });

      return res.status(ST_CODES.OK).json({
        status: true,
        message: `Comments retrieved successfully. Total: ${sortedComments.length}`,
        total_comments: sortedComments.length,
        data: sortedComments,
      });
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Unable to fetch comments. Please try again later.",
        error: error.message,
      });
    }
  }

  async makePrimary(req, res) {
    try {
      const { id } = req.params; // contact_person_id from URL
      const { organization_id, contact_id } = req.body;
      const admin_id = res.locals.user_id;

      // Validate required parameters
      if (!id || !organization_id || !contact_id || !admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message:
            "Missing required parameters: contact person ID, organization_id, contact_id, and admin_id are mandatory.",
        });
      }

      // Step 1: Find the current primary contact person for this contact
      const existingPrimary = await ContactPersonCollection.findOne({
        contact_id: contact_id,
        is_primary_contact: true,
      });

      // Step 2: If a primary contact person exists, unset it
      if (existingPrimary && existingPrimary.contact_person_id !== id) {
        await ContactPersonCollection.updateOne(
          { contact_person_id: existingPrimary.contact_person_id },
          { $set: { is_primary_contact: false } }
        );
      }

      // Step 3: Set the provided contact person as primary
      const updatedPrimary = await ContactPersonCollection.findOneAndUpdate(
        { contact_person_id: id },
        { $set: { is_primary_contact: true } },
        { new: true }
      );

      // Step 4: Update the main contact details with the primary contact person's data
      if (updatedPrimary) {
        const contactPersonData = {
          first_name: updatedPrimary.first_name,
          last_name: updatedPrimary.last_name,
          email: updatedPrimary.email,
          mobile: updatedPrimary.mobile,
          phone: updatedPrimary.work_phone,
          designation: updatedPrimary.designation,
          department: updatedPrimary.department,
          salutation: updatedPrimary.salutation,
        };

        await ContactCollection.findOneAndUpdate(
          { contact_id: contact_id },
          { $set: contactPersonData }
        );
      }

      // Return success response
      return res.status(ST_CODES.OK).json({
        status: true,
        message:
          "This contact person has been marked as your primary contact person.",
      });
    } catch (error) {
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message:
          "Internal Server Error: Failed to set contact as primary. Please try again later.",
        error: error.message,
      });
    }
  }
}

module.exports = new ContactController();
