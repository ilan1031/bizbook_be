const mongoose = require("mongoose");
const OrgCollection = mongoose.model("Organization");
const ColumnCollection = mongoose.model("Columns");
const COA_Collection = mongoose.model("Chart_of_account");
const queryHelper = require("../helpers/query");
const { LOGO_ERROR, isValidLogo } = require("../helpers/logo");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const { nextOrganizationId } = require("../helpers/orgId");
const UsersCollection = mongoose.model("user");
const columnsJson = require("../helpers/columns.json");
const chartOfAccountsJson = require("../helpers/chartOfAccounts.json");
const fs = require("fs");
const path = require("path");

// GSTIN: 2-digit state code, PAN (5 letters, 4 digits, 1 letter), entity
// number, "Z", check character.
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// Users with an organisation being created right now (stops a double click
// from creating two).
const creatingOrgFor = new Set();

class OrgController {
  async createOrg(req, res) {
    const lockKey = String(res.locals.user_id);
    if (creatingOrgFor.has(lockKey)) {
      return res.status(409).send({ status: false, message: "Your organisation is already being created. Please wait a moment." });
    }
    creatingOrgFor.add(lockKey);
    try {
      let bData = req.body || {};
      const orgName = String(bData.organizationName ?? "").trim();
      if (!orgName) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: "Organisation name is required" });
      }
      if (orgName.length > 100) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: "Organisation name can be at most 100 characters" });
      }
      const gstIn = String(bData.gst_in ?? "").trim().toUpperCase();
      if (gstIn && !GSTIN_RE.test(gstIn)) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: "Enter a valid 15-character GSTIN, e.g. 33ABCDE1234F1Z5" });
      }
      // The setup screen sends the PIN code as "country_code".
      const zip = String(bData.zip ?? bData.country_code ?? "").trim();
      if (zip && !/^\d{6}$/.test(zip)) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: "PIN code must be 6 digits" });
      }
      let orgData = await OrgCollection.find({
        admin_id: res.locals.user_id,
        org_type: "default",
      });
      console.log(orgData, "orgData");
      if (orgData.length <= 0) {
        bData["org_type"] = "default";
      }

      let userData = await UsersCollection.findById(res.locals.user_id);

      let orgUniqueId = await nextOrganizationId(OrgCollection);
      // console.log(orgUniqueId, "orgUniqueId");
      // return;
      let modelData = {
        organization_id: orgUniqueId,
        admin_id: res.locals.user_id,
        phone: userData.mobile,
        org_name: orgName,
        portal_name: "",
        country: bData.country || "India",
        state: bData.state || "Tamilnadu",
        city: bData.city || "",
        first_street: bData.first_street || "",
        second_street: bData.second_street || "",
        // zip is required by the schema; without one the old placeholder is kept.
        zip: zip || "624702",
        fiscal_year_start_month: "APRIL",
        language_code: "EN",
        time_zone: bData.timeZone || "IST",
        tax_basis: "",
        currency_code: bData.currency || "INR",
        industry_type: bData.industry_name || "",
        theme: "primary",
        gst_in: gstIn,
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
    } finally {
      creatingOrgFor.delete(lockKey);
    }
  }

  async getOrganisation(req, res) {
    try {
      // Without paging parameters every one of the user's organisations is
      // returned (the org switcher, org list and templates need them all).
      const { page = 1, limit = 0 } = req.body || {};
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
        logo: 1,
      };
      const limitInt = Math.max(0, parseInt(limit, 10) || 0);
      const pageInt = Math.max(1, parseInt(page, 10) || 1);
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
  async getPublicOrganization(req, res) {
    try {
      const org = await OrgCollection.findOne(
        { organization_id: String(req.params.organization_id) },
        { _id: 0, organization_id: 1, org_name: 1, portal_name: 1 }
      ).lean();
      if (!org) return res.status(ST_CODES.NOT_FOUND).send({ status: false, message: "Organization not found" });
      return res.status(ST_CODES.OK).send({ status: true, data: org });
    } catch (error) {
      console.error("getPublicOrganization error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({ status: false, message: "Something went wrong" });
    }
  }

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
        logo: 1,
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
        "logo",
      ];

      if (updateData.logo !== undefined && !isValidLogo(updateData.logo)) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: LOGO_ERROR });
      }

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
      // The organisation's number (organization_id). The tenant check in
      // userMiddleware has already confirmed it belongs to this user.
      const orgNumber = Number(req.query.organization_id || req.query.org_id || req.body?.organization_id);
      if (!Number.isInteger(orgNumber) || orgNumber <= 0) {
        return res.status(ST_CODES.BAD_REQUEST).send({ status: false, message: "organization_id is required" });
      }
      let orgData = await OrgCollection.findOne({
        organization_id: orgNumber,
        admin_id: admin_id,
      });
      if (!orgData) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Cannot find the organization",
        });
      }
      const org_id = orgData._id;
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
