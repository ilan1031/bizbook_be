const mongoose = require("mongoose");
const ContactUserCollection = mongoose.model("Contact");
const ItemCollection = mongoose.model("Item");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");

async function getCollectionKeys(model) {
  try {
    const keys = Object.keys(model.schema.paths);
    return keys;
  } catch (error) {
    console.error("Error fetching collection keys:", error);
    throw error;
  }
}

class ImportFilesController {
  async sendCollecetionKeys(req, res) {
    try {
      let collectionName;
      let keys;
      let restrictedKeys;
      let Qdata = req.query.moduleName;
      if (Qdata == "customers") {
        console.log(Qdata, "Qdata");
        collectionName = ContactUserCollection;
        keys = await getCollectionKeys(collectionName);
        keys.push("Company_name");
        keys.push("Billing_Address");
        keys.push("Billing_Street2");
        keys.push("Billing_City");
        keys.push("Billing_State");
        keys.push("Billing_Country");
        keys.push("Billing_Code");
        keys.push("Billing_Fax");
        keys.push("Billing_Phone");

        keys.push("shipping_Address");
        keys.push("shipping_Street2");
        keys.push("shipping_City");
        keys.push("shipping_State");
        keys.push("shipping_Country");
        keys.push("shipping_Code");
        keys.push("shipping_Fax");
        keys.push("shipping_Phone");

        restrictedKeys = [
          "__v",
          "_id",
          "contact_id",
          "createdAt",
          "updatedAt",
          "admin_id",
          "organization_id",
          "created_by_id",
          "profile_image",
          "is_bulk_export_exist",
          "contact_tax_information",
          "is_bcy_only_contact",
          "is_credit_limit_migration_completed",
          "language_code",
          "language_code_formatted",
          "portal_status",
          "portal_status_formatted",
          "is_client_review_asked",
          "has_transaction",
          "contact_type",
          "customer_sub_type",
          "customer_sub_type_formatted",
          "owner_id",
          "owner_name",
          "source_formatted",
          "is_crm_customer",
          "is_linked_with_zohocrm",
          "is_gapps_customer",
          "primary_contact_id",
          "zcrm_account_id",
          "zcrm_contact_id",
          "crm_owner_id",
          "payment_terms_id",
          "credit_limit_exceeded_amount",
          "credit_limit_exceeded_amount_formatted",
          "can_show_customer_ob",
          "can_show_customer_ob_formatted",
          "can_show_vendor_ob",
          "can_show_vendor_ob_formatted",
          "opening_balance_amount_formatted",
          "opening_balance_amount_bcy",
          "opening_balance_amount_bcy_formatted",
          "outstanding_ob_receivable_amount",
          "outstanding_ob_receivable_amount_formatted",
          "outstanding_ob_payable_amount",
          "outstanding_ob_payable_amount_formatted",
          "outstanding_receivable_amount",
          "outstanding_receivable_amount_formatted",
          "outstanding_receivable_amount_bcy",
          "outstanding_receivable_amount_bcy_formatted",
          "outstanding_payable_amount",
          "outstanding_payable_amount_formatted",
          "outstanding_payable_amount_bcy",
          "outstanding_payable_amount_bcy_formatted",
          "unused_credits_receivable_amount",
          "unused_credits_receivable_amount_formatted",
          "unused_credits_receivable_amount_bcy",
          "unused_credits_receivable_amount_bcy_formatted",
          "unused_credits_payable_amount",
          "unused_credits_payable_amount_formatted",
          "unused_credits_payable_amount_bcy",
          "unused_credits_payable_amount_bcy_formatted",
          "unused_retainer_payments",
          "unused_retainer_payments_formatted",
          "status_formatted",
          "payment_reminder_enabled",
          "is_sms_enabled",
          "is_portal_enabled",
          "is_consent_agreed",
          "consent_date",
          "is_client_review_settings_enabled",
          "is_linked_with_contact",
          "sales_channel",
          "ach_supported",
          "place_of_contact",
          "place_of_contact_formatted",
          "contact_category",
          "contact_category_formatted",
          "gst_treatment",
          "gst_treatment_formatted",
          "is_linked_with_contact",
          "sales_channel",
          "ach_supported",
          "portal_receipt_count",
          "entity_address_id",
          "notes",
          "created_date",
          "created_date_formatted",
          "created_by_name",
          "associated_with_square",
          "can_add_card",
          "can_add_bank_account",
          "zohopeople_client_id",
          "submitted_date",
          "submitted_date_formatted",
          "submitted_by",
          "submitted_by_name",
          "submitted_by_email",
          "submitted_by_photo_url",
          "submitter_id",
          "remark",
          "approver_id",
          "integration_references",
          "tags",
          "custom_fields",
          "shipping_address.is_verifiable",
          "shipping_address.is_valid",
          "additional_address",
          "source",
          "billing_address.address_id",
          "billing_address.attention",
          "billing_address.address",
          "billing_address.street1",
          "billing_address.street2",
          "billing_address.city",
          "billing_address.state_code",
          "billing_address.state",
          "billing_address.zip",
          "billing_address.country",
          "billing_address.county",
          "billing_address.country_code",
          "billing_address.phone",
          "billing_address.phone_formatted",
          "billing_address.fax",
          "billing_address.tax_info_id",
          "shipping_address.address_id",
          "shipping_address.attention",
          "shipping_address.address",
          "shipping_address.street1",
          "shipping_address.street2",
          "shipping_address.city",
          "shipping_address.state_code",
          "shipping_address.state",
          "shipping_address.zip",
          "shipping_address.country",
          "shipping_address.county",
          "shipping_address.country_code",
          "shipping_address.phone",
          "shipping_address.phone_formatted",
          "shipping_address.fax",
          "shipping_address.latitude",
          "shipping_address.longitude",
          "shipping_address.is_shipping_address_verified",
          "contact_persons",
          "deleted_at",
          "trader_name",
          "legal_name",
          "vat_reg_no",
          "tax_reg_label",
          "udyam_reg_no",
          "msme_type",
          "msme_type_formatted",
          "tax_treatment_formatted",
          "tax_reg_no",
          "created_time",
          "last_modified_time",
          "custom_field_hash",
          "tax_info_list",
          "comments",
        ];
      } else if (Qdata == "purchase-order") {
      } else if (Qdata == "expense") {
        // collectionName = ExpenseCollection;
      }

      const filteredKeys = keys.filter((key) => !restrictedKeys.includes(key));
      //   console.log("filteredKeys-------", filteredKeys);
      if (filteredKeys.length > 0) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Columns fetched",
          data: filteredKeys,
        });
      }

      return res.status(ST_CODES.BAD_REQUEST).json({
        success: false,
        message: "Couldn't find columns",
      });
    } catch (error) {
      console.log("sendCollecetionKeys error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async importCustomers(req, res) {
    try {
      let bData = req.body;
      let { org_id } = req.query;
      let admin_id = res.locals.user_id;
      for (const indiCustomer of bData) {
        if (indiCustomer.contact_name != "") {
          console.log("indiCustomer---------", indiCustomer);
          let contactUniqueId = await commonHelper.generateUniqueId(
            ContactUserCollection,
            "contact_id",
            4,
            "CU"
          );
          //   bData["contact_id"] = contactUniqueId;
          const newContact = new ContactUserCollection({
            contact_id: contactUniqueId,
            admin_id: admin_id,
            organization_id: org_id,
            contact_name: indiCustomer.contact_name,
            company_name: indiCustomer.company_name,
            contact_salutation: indiCustomer.contact_salutation,
            first_name: indiCustomer.first_name,
            last_name: indiCustomer.last_name,
            email: indiCustomer.email,
            phone: indiCustomer.phone,
            mobile: indiCustomer.mobile,
            facebook: indiCustomer.facebook,
            twitter: indiCustomer.twitter,
            department: indiCustomer.department,
            designation: indiCustomer.designation,
            website: indiCustomer.website,
            gst_no: indiCustomer.gst_no,
            pan_no: indiCustomer.pan_no,
            currency_code: indiCustomer.currency_code,
            payment_terms: Number(indiCustomer.payment_terms),
            payment_terms_label: indiCustomer.payment_terms_label,
            opening_balance_amount: Number(indiCustomer.opening_balance_amount),
            exchange_rate: Number(indiCustomer.exchange_rate),
            status: "active",
            contact_type: "Customer",
            source: "import",
            tds_name: indiCustomer.tds_name,
            billing_address: {
              address: indiCustomer.Billing_Address,
              street2: indiCustomer.Billing_Street2,
              city: indiCustomer.Billing_City,
              state: indiCustomer.Billing_State,
              zip: indiCustomer.Billing_Code,
              country: indiCustomer.Billing_Country,
              fax: indiCustomer.Billing_Fax,
              phone: indiCustomer.Billing_Phone,
            },

            shipping_address: {
              address: indiCustomer.shipping_Address,
              street2: indiCustomer.shipping_Street2,
              city: indiCustomer.shipping_City,
              state: indiCustomer.shipping_State,
              zip: indiCustomer.shipping_Code,
              country: indiCustomer.shipping_Country,
              fax: indiCustomer.shipping_Fax,
              phone: indiCustomer.shipping_Phone,
            },
          });
          await newContact.save();
        }
      }
      return res.status(200).send({ message: "Customer import successfully" });
    } catch (error) {
      console.log("importCustomers error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
}

module.exports = new ImportFilesController();
