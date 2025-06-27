"use strict";
const axios = require("axios");
const constants = require("../config/constant");

class ApiHandler {
  getUserInformation(token) {
    return axios(`${constants.COMMON_BACKEND_URL}user/fetch/${token}`);
  }

  getClientInformation(token) {
    console.log(`${constants.COMMON_BACKEND_URL}client/fetch/${token}`);
    return axios(`${constants.COMMON_BACKEND_URL}client/fetch/${token}`);
  }

  async getContactInformation(contact_id, organization_id, token) {
    if (!contact_id || !organization_id || !token) {
      throw new Error("Missing required parameters for getContactInformation");
    }

    const contactUrl = `${constants.COMMON_BACKEND_URL}contact/${contact_id}?organization_id=${organization_id}`;
    // console.log(`Calling contact API: ${contactUrl}`);

    return axios.get(contactUrl, {
      headers: { Authorization: token },
    });
  }

  async getContactPersonInformation(contact_id, organization_id, token) {
    if (!contact_id || !organization_id || !token) {
      console.error("Missing parameters:", {
        contact_id,
        organization_id,
        tokenExists: !!token,
      });
      throw new Error(
        "Missing required parameters for getContactPersonInformation"
      );
    }

    const contactPersonUrl = `${constants.COMMON_BACKEND_URL}contact-person/${contact_id}`;
    console.log(`Full URL being called: ${contactPersonUrl}`);
    console.log(
      `Headers being sent: Authorization: ${token.substring(0, 90)}...`
    );

    try {
      const response = await axios.get(contactPersonUrl, {
        headers: { Authorization: token },
      });
      console.log("Raw API response:", JSON.stringify(response.data));
      return response;
    } catch (error) {
      console.error("API call failed with:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });
      throw error;
    }
  }
  async getContactPersonInformationById(
    contact_person_id,
    organization_id,
    token
  ) {
    if (!contact_person_id || !organization_id || !token) {
      throw new Error(
        "Missing required parameters for getContactPersonInformation"
      );
    }
    const contactPersonUrl = `${constants.COMMON_BACKEND_URL}individual-contact-person/${contact_person_id}`;
    try {
      const response = await axios.get(contactPersonUrl, {
        headers: { Authorization: token },
      });
      console.log("Raw API response:", JSON.stringify(response.data));
      return response;
    } catch (error) {
      console.error("API call failed with:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });
      throw error;
    }
  }

  async updateContactPerson(contact_person_id, updateData, token) {
    if (!contact_person_id || !updateData || !token) {
      console.error("Missing parameters for updateContactPerson:", {
        contact_person_id,
        updateDataProvided: !!updateData,
        tokenExists: !!token,
      });
      throw new Error("Missing required parameters for updateContactPerson");
    }

    // Endpoint should match the controller route
    const contactPersonUrl = `${constants.COMMON_BACKEND_URL}contact-person/${contact_person_id}`;
    console.log(`Updating contact person: ${contactPersonUrl}`);
    console.log(`Update data:`, JSON.stringify(updateData));

    try {
      const response = await axios.put(contactPersonUrl, updateData, {
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      });
      console.log("Update API response:", JSON.stringify(response.data));
      return response;
    } catch (error) {
      console.error("Update API call failed with:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });
      throw error;
    }
  }

  async getOrganizationDetails(organization_id, token) {
    if (!organization_id || !token) {
      throw new Error("Missing required parameters for getOrganizationDetails");
    }

    const organizationUrl = `${constants.COMMON_BACKEND_URL}organization/${organization_id}`;
    console.log(`Calling organization API: ${organizationUrl}`);

    return axios.get(organizationUrl, {
      headers: { Authorization: token },
    });
  }

  async createInvoice(bData, organization_id, recurring_invoice_id) {
    if (!bData || !organization_id || !recurring_invoice_id) {
      throw new Error("Missing required parameters for createInvoice");
    }
    const invoiceCreate = `${constants.SO_BACKEND_URL}/invoices?organization_id=${organization_id}`;
    console.log(`Calling invoice API: ${invoiceCreate}`);
    return axios.post(invoiceCreate, recurringData, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async updateContact(
    contact_id,
    organization_id,
    updateData,
    token,
    profileImage = null
  ) {
    if (!contact_id || !organization_id || !token) {
      console.error("Missing parameters for updateContact:", {
        contact_id,
        organization_id,
        updateDataProvided: !!updateData,
        tokenExists: !!token,
      });
      throw new Error("Missing required parameters for updateContact");
    }

    const contactUrl = `${constants.COMMON_BACKEND_URL}contact?contact_id=${contact_id}&organization_id=${organization_id}`;
    console.log(`Updating contact: ${contactUrl}`);
    console.log(`Update data:`, JSON.stringify(updateData));

    try {
      let response;

      // If we have a profile image, use FormData
      if (profileImage) {
        const formData = new FormData();

        // Add all updateData fields to form data
        Object.keys(updateData).forEach((key) => {
          // Handle arrays and objects by stringifying them
          if (typeof updateData[key] === "object" && updateData[key] !== null) {
            formData.append(key, JSON.stringify(updateData[key]));
          } else {
            formData.append(key, updateData[key]);
          }
        });

        // Add the profile image
        formData.append(
          "profile_image",
          fs.createReadStream(profileImage.path),
          {
            filename: profileImage.originalname,
            contentType: profileImage.mimetype,
          }
        );

        response = await axios.put(contactUrl, formData, {
          headers: {
            Authorization: token,
            ...formData.getHeaders(),
          },
        });
      } else {
        // Regular JSON API call without image
        response = await axios.put(contactUrl, updateData, {
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        });
      }

      console.log(
        "Update Contact API response:",
        JSON.stringify(response.data)
      );
      return response;
    } catch (error) {
      console.error("Update Contact API call failed with:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });
      throw error;
    }
  }

  async createBill(organization_id, requestData, token) {
    if (!requestData || !organization_id) {
      throw new Error("Missing required parameters for createBill");
    }
    const billCreate = `${constants.PO_BACKEND_URL}bills/create-bills?org_id=${organization_id}`;
    console.log(`Calling invoice API: ${billCreate}`);
    return axios.post(billCreate, requestData, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

module.exports = new ApiHandler();
