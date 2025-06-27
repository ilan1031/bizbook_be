const mongoose = require("mongoose");
const ContactPersonCollection = mongoose.model("contactDetails");
const ContactCollection = mongoose.model("Contact");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");

class ContactPersonController {
  async createcontactPerson(req, res) {
    try {
      let bData = req.body;
      const admin_id = res.locals.user_id;
      const { organization_id, contact_id } = req.query;
      console.log(contact_id, organization_id, "second/////////////////////");
      console.log(req.body, "first*--------------");

      // return

      if (!organization_id || !contact_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message:
            "Missing required fields: organization_id and contact_id are mandatory.",
        });
      }

      // Generate unique contactPerson ID
      let contactPersonUniqueId = await commonHelper.generateUniqueId(
        ContactPersonCollection,
        "contact_person_id",
      );

      let modelData = {
        contact_person_id: contactPersonUniqueId,
        admin_id: admin_id,
        contact_id: contact_id,
        organization_id: organization_id,
        ...bData, // Spread all other fields from req.body
      };

      let addcontactPerson = await queryHelper.insertData(
        ContactPersonCollection,
        modelData
      );
      if (addcontactPerson.status) {
        res.status(ST_CODES.CREATED).send({
          status: addcontactPerson.status,
          data: addcontactPerson.msg,
          message: "contactPerson created successfully...",
        });
      } else {
        res.status(ST_CODES.BAD_REQUEST).send({
          status: addcontactPerson.status,
          message: addcontactPerson.msg,
        });
      }
    } catch (error) {
      console.error("createcontactPerson Error:", error.message);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async getcontactPersons(req, res) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const query = {};
      let sort = { createdAt: -1 };
      const projection = {
        contact_person_id: 1,
        first_name: 1,
        last_name: 1,
        email: 1,
        phone: 1,
        organization_id: 1,
        createdAt: 1,
      };

      const limitInt = parseInt(limit, 10);
      const pageInt = parseInt(page, 10);
      const results = await queryHelper.findData(
        ContactPersonCollection,
        query,
        projection,
        sort,
        limitInt,
        pageInt
      );

      res.status(ST_CODES.OK).send({
        status: results.status,
        data: results.msg,
      });
    } catch (error) {
      console.error("getcontactPersons Error:", error.message);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async getContactById(req, res) {
    try {
      const { organization_id } = req.query;
      const { contact_id } = req.params;
      const admin_id = res.locals.user_id;
  
      // Validate required parameters
      if (!organization_id || !contact_id || !admin_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Missing required parameters: organization_id, contact_id, or admin_id.",
        });
      }
  
      // Build contact query
      let contactQuery = {
        admin_id,
        organization_id,
      };
  
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
  
      // Find contact persons with proper query
      let contactPersonQuery = { contact_id: contact.contact_id };
      
      const contactPersons = await ContactPersonCollection.find(contactPersonQuery);
  
      // Find organization
      const organization = await OrganizationCollection.findOne({
        organization_id,
        admin_id,
      });
  
      const contactData = contact.toObject();
      contactData.contact_persons = contactPersons || [];
  
      // Add organization details if available
      if (organization) {
        contactData.organization = {
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
        };
      } else {
        contactData.organization = null;
      }
  
      return res.status(ST_CODES.OK).json({ 
        status: true, 
        data: contactData 
      });
    } catch (error) {
      console.error("getContactById Error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Something went wrong while retrieving contact details",
        error: error.message
      });
    }
  }

  // async getcontactPersonsByContactId(req, res) {
  //   try {
  //     const { page = 1, limit = 10 } = req.query;
  //     const { contact_id}=req.params;
  //     // console.log(req.params,"-*-*-*-*-");
  //     // return

  //     if (!contact_id) {
  //       return res.status(ST_CODES.BAD_REQUEST).json({
  //         success: false,
  //         message: "contact_id is required",
  //       });
  //     }

  //     const query = { contact_id: contact_id };
  //     console.log(query);

  //     let sort = { createdAt: -1 };
  //     const projection = {
  //       contact_person_id: 1,
  //       contact_id: 1,
  //       organization_id: 1,
  //       salutation: 1,
  //       first_name: 1,
  //       last_name: 1,
  //       email: 1,
  //       phone: 1,
  //       mobile: 1,
  //       skype: 1,
  //       department: 1,
  //       designation: 1,
  //       is_primary_contact: 1,
  //       is_portal_invitation_accepted: 1,
  //       createdAt: 1,
  //     };

  //     const limitInt = parseInt(limit, 10);
  //     const pageInt = parseInt(page, 10);
  //     const results = await queryHelper.findData(ContactPersonCollection, query, projection, sort, limitInt, pageInt);

  //     if (!results.status || !results.msg || results.msg.length === 0) {
  //       return res.status(ST_CODES.NOT_FOUND).json({
  //         success: false,
  //         message: "No contact persons found for the given contact_id",
  //       });
  //     }

  //     const formattedData = results.msg.map(contactPerson => ({
  //       contact_person_id: contactPerson.contact_person_id || "",
  //       contact_id: contactPerson.contact_id || "",
  //       organization_id: contactPerson.organization_id || "",
  //       salutation: contactPerson.salutation || "",
  //       first_name: contactPerson.first_name || "",
  //       last_name: contactPerson.last_name || "",
  //       email: contactPerson.email || "",
  //       phone: contactPerson.phone || "",
  //       mobile: contactPerson.mobile || "",
  //       skype: contactPerson.skype || "",
  //       department: contactPerson.department || "",
  //       designation: contactPerson.designation || "",
  //       is_primary_contact: contactPerson.is_primary_contact || false,
  //       is_portal_invitation_accepted: contactPerson.is_portal_invitation_accepted || false
  //     }));

  //     res.status(ST_CODES.OK).json({
  //       success: true,
  //       data: formattedData,
  //       pagination: {
  //         page: pageInt,
  //         limit: limitInt,
  //         total: results.total || 0
  //       }
  //     });
  //   } catch (error) {
  //     console.error("getcontactPersonsByContactId Error:", error.message);
  //     res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
  //       success: false,
  //       message: "Something went wrong"
  //     });
  //   }
  // }

  async getcontactPersonsByContactId(req, res) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const { contact_id } = req.params;

      if (!contact_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "contact_id is required",
        });
      }

      let actualContactId = contact_id;
      let vendorDetails = null;

      // Check if the ID is a MongoDB ObjectId format (24 hex chars)
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(contact_id);

      // If it's an ObjectId format, fetch the contact details first
      if (isObjectId) {

        try {
          console.log("gettingggg");
          
          // Get the contact details using the ObjectId, including vendor information
          const contactDetails = await ContactCollection.findOne(
            { _id: Object(contact_id) },
            {
              contact_id: 1,
              first_name: 1,
              last_name: 1, // Add vendor name
              vendor_id: 1, // Add vendor ID
            }
          );

          console.log(contactDetails,"contactDetails")

          if (!contactDetails || !contactDetails.contact_id) {
            return res.status(ST_CODES.NOT_FOUND).json({
              success: false,
              message: "Contact not found with the given ID",
            });
          }

          // Use the contact_id from the contact details
          actualContactId = contactDetails.contact_id;

          console.log(actualContactId,"actualContactId")

          // Store vendor details for later use in the response
          vendorDetails = {
            vendor_name: contactDetails.first_name || "",
            vendor_id: contactDetails.vendor_id || "",
          };
        } catch (error) {
          console.error("Error fetching contact details:", error);
          return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: "Error fetching contact details",
            error: error.message,
          });
        }
      }
      // If it's not an ObjectId format, use the contact_id directly (like "100021")

      const query = { contact_id: actualContactId };
      let sort = { createdAt: -1 };
      const projection = {
        contact_person_id: 1,
        contact_id: 1,
        organization_id: 1,
        salutation: 1,
        first_name: 1,
        last_name: 1,
        email: 1,
        phone: 1,
        mobile: 1,
        skype: 1,
        department: 1,
        designation: 1,
        is_primary_contact: 1,
        is_portal_invitation_accepted: 1,
        can_invite:1,
        is_added_in_portal:1,
        createdAt: 1,
      };

      const limitInt = parseInt(limit, 10);
      const pageInt = parseInt(page, 10);

      // Query the database
      const results = await queryHelper.findData(
        ContactPersonCollection,
        query,
        projection,
        sort,
        limitInt,
        pageInt
      );

      // Handle case when no results are found
      if (
        !results ||
        !results.status ||
        !results.msg ||
        results.msg.length === 0
      ) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "No contact persons found for the given contact_id",
        });
      }

      // Format the response data
      const formattedData = results.msg.map((contactPerson) => ({
        contact_person_id: contactPerson.contact_person_id || "",
        contact_id: contactPerson.contact_id || "",
        organization_id: contactPerson.organization_id || "",
        salutation: contactPerson.salutation || "",
        first_name: contactPerson.first_name || "",
        last_name: contactPerson.last_name || "",
        email: contactPerson.email || "",
        phone: contactPerson.phone || "",
        mobile: contactPerson.mobile || "",
        skype: contactPerson.skype || "",
        department: contactPerson.department || "",
        designation: contactPerson.designation || "",
        is_primary_contact: contactPerson.is_primary_contact || false,
        is_portal_invitation_accepted: contactPerson.is_portal_invitation_accepted || false,
        is_added_in_portal: contactPerson.is_added_in_portal || false,
        can_invite: contactPerson.can_invite || false,
      }));

      // Create response object with vendor details if available
      const responseData = {
        success: true,
        data: formattedData,
        pagination: {
          page: pageInt,
          limit: limitInt,
          total: results.total || 0,
        },
      };

      // If we have vendor details, add them to the response
      if (vendorDetails) {
        responseData.vendor_details = vendorDetails;
      }

      // Send response
      res.status(ST_CODES.OK).json(responseData);
    } catch (error) {
      console.error("Error in getcontactPersonsByContactId:", error);

      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }

  async updatecontactPerson(req, res) {
    try {
      const { contact_person_id } = req.params;
      const updateData = req.body;

      if (!contact_person_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "contactPerson ID is required for update.",
        });
      }

      let updatedcontactPerson = await ContactPersonCollection.findOneAndUpdate(
        { contact_person_id: contact_person_id },
        updateData,
        { new: true }
      );

      if (!updatedcontactPerson) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "contactPerson not found.",
        });
      }

      res.status(ST_CODES.OK).send({
        status: true,
        message: "contactPerson updated successfully.",
        data: updatedcontactPerson,
      });
    } catch (error) {
      console.error("updatecontactPerson Error:", error.message);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async deletecontactPerson(req, res) {
    try {
      const { contact_person_id } = req.params;

      if (!contact_person_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "contactPerson ID is required for deletion.",
        });
      }

      let deletedcontactPerson = await ContactPersonCollection.findOneAndDelete(
        { contact_person_id: contact_person_id }
      );

      if (!deletedcontactPerson) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "contactPerson not found.",
        });
      }

      res.status(ST_CODES.OK).send({
        status: true,
        message: "contactPerson deleted successfully.",
      });
    } catch (error) {
      console.error("deletecontactPerson Error:", error.message);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async getContactPersonById(req, res) {
    console.log("coming------------");
    
    try {
      const { contact_person_id } = req.params;
      
      if (!contact_person_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "contact_person_id is required"
        });
      }
      
      // Find the contact person by ID
      const contactPerson = await ContactPersonCollection.findOne(
        { contact_person_id: contact_person_id }
      );
      
      console.log(contactPerson, "-*-*-*-*");
      
      if (!contactPerson) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Contact person not found with the given ID"
        });
      }
      
      // If the contactPerson has a contact_id, try to get the associated contact information
      let contactInfo = null;
      if (contactPerson.contact_id) {
        contactInfo = await ContactCollection.findOne(
          { contact_id: contactPerson.contact_id },
          {
            contact_id: 1,
            first_name: 1,
            last_name: 1,
            company_name: 1,
            email: 1,
            phone: 1
          }
        );
      }
      
      // Format the contact person data
      const formattedData = {
        contact_person_id: contactPerson.contact_person_id || "",
        contact_id: contactPerson.contact_id || "",
        organization_id: contactPerson.organization_id || "",
        salutation: contactPerson.salutation || "",
        first_name: contactPerson.first_name || "",
        last_name: contactPerson.last_name || "",
        email: contactPerson.email || "",
        phone: contactPerson.phone || "",
        mobile: contactPerson.mobile || "",
        skype: contactPerson.skype || "",
        department: contactPerson.department || "",
        designation: contactPerson.designation || "",
        is_primary_contact: contactPerson.is_primary_contact || false,
        is_portal_invitation_accepted: contactPerson.is_portal_invitation_accepted || false,
        can_invite: contactPerson.can_invite || false,
        is_added_in_portal: contactPerson.is_added_in_portal || false,
        created_at: contactPerson.createdAt
      };
      
      // Create response object
      const responseData = {
        success: true,
        data: formattedData
      };
      
      // Add contact info if available
      if (contactInfo) {
        responseData.contact_details = {
          contact_id: contactInfo.contact_id || "",
          name: `${contactInfo.first_name || ""} ${contactInfo.last_name || ""}`.trim(),
          company_name: contactInfo.company_name || "",
          email: contactInfo.email || "",
          phone: contactInfo.phone || ""
        };
      }
      
      res.status(ST_CODES.OK).json(responseData);
    } catch (error) {
      console.error("Error in getContactPersonById:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Something went wrong",
        error: error.message
      });
    }
}
}

module.exports = new ContactPersonController();
