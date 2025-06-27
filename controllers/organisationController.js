const mongoose = require("mongoose");
const OrgCollection = mongoose.model("Organization");
const ColumnCollection = mongoose.model("Columns");
const COA_Collection = mongoose.model("Chart_of_account");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const UsersCollection = mongoose.model("user");
const columnsJson = require("../helpers/columns.json");
const chartOfAccountsJson = require("../helpers/chartOfAccounts.json");
const fs = require("fs");
const path = require("path");

class OrgController {
  async createOrg(req, res) {
    try {
      let bData = req.body;
      let orgData = await OrgCollection.find({
        admin_id: res.locals.user_id,
        org_type: "default",
      });
      console.log(orgData, "orgData");
      if (orgData.length <= 0) {
        bData["org_type"] = "default";
      }

      let userData = await UsersCollection.findById(res.locals.user_id);

      let orgUniqueId = await commonHelper.generateOrgUniqueId(
        OrgCollection,
        "organization_id"
      );
      // console.log(orgUniqueId, "orgUniqueId");
      // return;
      let modelData = {
        organization_id: orgUniqueId,
        admin_id: res.locals.user_id,
        phone: userData.mobile,
        org_name: bData.organizationName,
        portal_name: "",
        country: bData.country || "India",
        state: bData.state || "Tamilnadu",
        city: bData.city || "",
        first_street: bData.first_street || "",
        second_street: bData.second_street || "",
        zip: bData.country_code || "624702",
        fiscal_year_start_month: "APRIL",
        language_code: "EN",
        time_zone: bData.timeZone || "IST",
        tax_basis: "",
        currency_code: bData.currency || "INR",
        industry_type: bData.industry_name || "",
        theme: "primary",
        gst_in: bData.gst_in || "",
        org_type: bData.org_type || "",
      };
      await COA_Collection.create({
        organization_id: orgUniqueId,
        admin_id: res.locals.user_id,
        chart_of_accounts: chartOfAccountsJson,
      });
      await ColumnCollection.create({
        column_headers: columnsJson,
        organization_id: orgUniqueId,
      });
      let addOrg = await queryHelper.insertData(OrgCollection, modelData);
      if (addOrg.status) {
        res.status(ST_CODES.OK).send({
          status: addOrg.status,
          data: {
            organization_id: orgUniqueId,
            ...addOrg.msg,
          },
          message: "Organization created successfully...",
        });
      } else {
        res.status(ST_CODES.BAD_REQUEST).send({
          status: addOrg.status,
          message: addOrg.msg,
        });
      }
    } catch (error) {
      console.log("createOrg Something went wrong...", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }

  async getOrganisation(req, res) {
    try {
      const { page = 1, limit = 5 } = req.body;
      const query = {};
      query["admin_id"] = res.locals.user_id;
      let sort = { createdAt: 1 };
      const gets = {
        organization_id: 1,
        org_name: 1,
        first_street: 1,
        second_street: 1,
        city: 1,
        country: 1,
        gst_in: 1,
        phone: 1,
        state: 1,
        createdAt: 1,
        account_created_date: 1,
        user_role: 1,
        plan_name: 1,
        org_type: 1,
      };
      const limitInt = parseInt(limit, 10);
      const pageInt = parseInt(page, 10);
      const results = await queryHelper.findData(
        OrgCollection,
        query,
        gets,
        sort,
        limitInt,
        pageInt
      );
      console.log(results, "results");
      res.status(ST_CODES.OK).send({
        status: results.status,
        data: results.msg,
      });
    } catch (error) {
      console.log("getOrganisation Something went wrong...", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }

  /**
   * Get individual organization details by organization_id
   */
  async getOrganizationById(req, res) {
    try {
      const { organization_id } = req.params;

      // Validate if organization_id is provided
      if (!organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Organization ID is required",
        });
      }

      console.log(`Fetching organization details for ID: ${organization_id}`);

      // Define query to find the organization
      const query = { organization_id: organization_id };

      // Define fields to return
      const projection = {
        organization_id: 1,
        org_name: 1,
        organization_name: "$org_name", // Alias for compatibility
        portal_name: 1,
        admin_id: 1,
        phone: 1,
        country: 1,
        state: 1,
        email: 1,
        city: 1,
        first_street: 1,
        second_street: 1,
        zip: 1,
        fiscal_year_start_month: 1,
        language_code: 1,
        time_zone: 1,
        tax_basis: 1,
        currency_code: 1,
        industry_type: 1,
        theme: 1,
        gst_in: 1,
        createdAt: 1,
        // organization_email: 1, // Added for email templates
        account_created_date: 1,
        user_role: 1,
        plan_name: 1,
      };

      // Find the organization
      const organization = await OrgCollection.findOne(query, projection);

      if (!organization) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Organization not found",
        });
      }

      // Format the response
      const organizationData = {
        ...organization.toObject(),
        organization_name: organization.org_name, // Ensure organization_name is set
      };

      // Return the organization details
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Organization details retrieved successfully",
        data: organizationData,
      });
    } catch (error) {
      console.error("getOrganizationById Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while fetching organization details",
      });
    }
  }

  /**
   * Update organization details
   */
  async updateOrganization(req, res) {
    try {
      const { organization_id } = req.params;
      const updateData = req.body;

      // Validate if organization_id is provided
      if (!organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Organization ID is required",
        });
      }

      // Validate if update data is provided
      if (!updateData || Object.keys(updateData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "No update data provided",
        });
      }

      console.log(`Updating organization with ID: ${organization_id}`);

      // Clean up update data to match schema
      const allowedFields = [
        "org_name",
        "portal_name",
        "phone",
        "country",
        "state",
        "city",
        "first_street",
        "second_street",
        "zip",
        "fiscal_year_start_month",
        "language_code",
        "time_zone",
        "tax_basis",
        "currency_code",
        "industry_type",
        "theme",
        "gst_in",
        "organization_email",
      ];

      const cleanUpdateData = {};
      allowedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          cleanUpdateData[field] = updateData[field];
        }
      });

      // Update the organization
      const updatedOrg = await OrgCollection.findOneAndUpdate(
        { organization_id: organization_id },
        { $set: cleanUpdateData },
        { new: true } // Return the updated document
      );

      if (!updatedOrg) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Organization not found",
        });
      }

      // Return the updated organization
      res.status(ST_CODES.OK).send({
        status: true,
        message: "Organization updated successfully",
        data: updatedOrg,
      });
    } catch (error) {
      console.error("updateOrganization Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while updating organization",
      });
    }
  }

  async updateOrgStatus(req, res) {
    try {
      let admin_id = res.locals.user_id;
      let { org_id } = req.query;
      let orgData = await OrgCollection.findOne({
        _id: org_id,
        admin_id: admin_id,
      });
      if (!orgData) {
        res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Canot find the organization",
        });
      }
      let changeDefaultStatus = await OrgCollection.find({
        admin_id: admin_id,
        org_type: "default",
      });
      if (changeDefaultStatus) {
        for (let i = 0; i < changeDefaultStatus.length; i++) {
          await OrgCollection.findOneAndUpdate(
            { _id: changeDefaultStatus[i]._id },
            {
              $set: {
                org_type: "",
              },
            }
          );
        }
      }
      let updateStatus = await OrgCollection.findOneAndUpdate(
        {
          _id: org_id,
          admin_id: admin_id,
        },
        {
          $set: {
            org_type: "default",
          },
        }
      );

      res.status(ST_CODES.OK).send({
        status: true,
        message: "Organization status updated successfully",
        data: orgData.organization_id,
      });
    } catch (error) {
      console.log("updateOrgStatus Error:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Something went wrong while updating organization",
      });
    }
  }
}

module.exports = new OrgController();
