const mongoose = require("mongoose");
const ContactUserCollection = require("../model/contactModel");
const ItemCollection = require("../model/Item");
const QuoteCollection = require("../model/quotes");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const queryHelper = require("../helpers/query");

async function getCollectionKeys(model) {
  try {
    const keys = Object.keys(model.schema.paths);
    return keys;
  } catch (error) {
    console.error("Error fetching collection keys:", error);
    throw error;
  }
}

function convertDateFormats(inputDate) {
  if (!inputDate || typeof inputDate !== "string")
    return { iso: "", formatted: "" };

  const [month, day, year] = inputDate.split("/");
  if (!month || !day || !year) return { iso: "", formatted: "" };

  const paddedMonth = month.padStart(2, "0");
  const paddedDay = day.padStart(2, "0");

  return {
    iso: `${year}-${paddedMonth}-${paddedDay}`, // YYYY-MM-DD
    formatted: `${paddedDay}/${paddedMonth}/${year}`, // DD/MM/YYYY
  };
}

class ImportController {
  async sendCollecetionKeys(req, res) {
    try {
      let collectionName;
      let keys = [];
      let restrictedKeys;
      let Qdata = req.query.moduleName;
      if (Qdata == "quote") {
        collectionName = QuoteCollection;
        // keys = await getCollectionKeys(collectionName);
        keys.push("date");
        keys.push("expiry_date");
        keys.push("Customer_Name");
        keys.push("Company_Name");
        keys.push("status");
        keys.push("gst_treatment");
        keys.push("gst_number");
        keys.push("exchange_rate");

        keys.push("tax_type");
        keys.push("tax_percentage");
        keys.push("tds_option");
        keys.push("discount_amount");
        keys.push("discount_percent");
        keys.push("discount_type");
        keys.push("adjustment");
        // keys.push("sub_total");
        keys.push("total");
        // keys.push("tax_total");
        keys.push("place_of_supply");

        keys.push("item_name");
        keys.push("unit");
        keys.push("item_type");
        keys.push("item_description");
        keys.push("item_price");
        // keys.push("item_total");
        keys.push("SKU");
        keys.push("quantity");
        keys.push("HSN/SAC");

        keys.push("terms");
        keys.push("notes");

        keys.push("subject_content");
        // keys.push("Billing_Address");
        // keys.push("Billing_Street2");
        // keys.push("Billing_City");
        // keys.push("Billing_State");
        // keys.push("Billing_Country");
        // keys.push("Billing_Code");
        // keys.push("Billing_Fax");
        // keys.push("Billing_Phone");

        // keys.push("shipping_Address");
        // keys.push("shipping_Street2");
        // keys.push("shipping_City");
        // keys.push("shipping_State");
        // keys.push("shipping_Country");
        // keys.push("shipping_Code");
        // keys.push("shipping_Fax");
        // keys.push("shipping_Phone");
      } else if (Qdata == "sales-order") {
      } else if (Qdata == "expense") {
        // collectionName = ExpenseCollection;
      } else if (Qdata == "quote") {
        collectionName = QuoteCollection;
        // keys = await getCollectionKeys(collectionName);
        keys.push("date");
        keys.push("expiry_date");
        keys.push("Customer_Name");
        keys.push("Company_Name");
        keys.push("status");
        keys.push("gst_treatment");
        keys.push("gst_number");
        keys.push("exchange_rate");

        keys.push("tax_type");
        keys.push("tax_percentage");
        keys.push("tds_option");
        keys.push("discount_amount");
        keys.push("discount_percent");
        keys.push("discount_type");
        keys.push("adjustment");
        // keys.push("sub_total");
        keys.push("total");
        // keys.push("tax_total");
        keys.push("place_of_supply");

        keys.push("item_name");
        keys.push("unit");
        keys.push("item_type");
        keys.push("item_description");
        keys.push("item_price");
        // keys.push("item_total");
        keys.push("SKU");
        keys.push("quantity");
        keys.push("HSN/SAC");

        keys.push("terms");
        keys.push("notes");

        keys.push("subject_content");
        // keys.push("Billing_Address");
        // keys.push("Billing_Street2");
        // keys.push("Billing_City");
        // keys.push("Billing_State");
        // keys.push("Billing_Country");
        // keys.push("Billing_Code");
        // keys.push("Billing_Fax");
        // keys.push("Billing_Phone");

        // keys.push("shipping_Address");
        // keys.push("shipping_Street2");
        // keys.push("shipping_City");
        // keys.push("shipping_State");
        // keys.push("shipping_Country");
        // keys.push("shipping_Code");
        // keys.push("shipping_Fax");
        // keys.push("shipping_Phone");
      }

      const filteredKeys = keys;
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
  async importQuote(req, res) {
    try {
      let bData = req.body;
      let { org_id } = req.query;
      let admin_id = res.locals.user_id;
      for (const indiQuote of bData) {
        let item = await ItemCollection.findOne({
          name: indiQuote.name,
          organization_id: org_id,
          admin_id: admin_id,
        });
        let itemUniqueId = await commonHelper.generateUniqueId(
          ItemCollection,
          "item_id"
        );
        // let itemskuId =await commonHelper.generateUniqueId(ItemCollection,"sku");

        if (!item) {
          item = new ItemCollection({
            admin_id: admin_id,
            item_name: indiQuote.item_name,
            item_id: itemUniqueId,
            name: indiQuote.item_name,
            sku: indiQuote.SKU,
            description: indiQuote.item_description,
            organization_id: org_id,
            rate: Number(indiQuote.item_price),
            can_be_purchased: true,
            unit: indiQuote.unit, // Optional default
            status: "active", // Optional
            hsn_or_sac: indiQuote["HSN/SAC"],
            item_type: indiQuote.item_type,
          });
          await item.save();
        }
        let customer = await ContactUserCollection.findOne({
          contact_name: indiQuote.Customer_Name,
          organization_id: org_id,
          admin_id: admin_id,
        });
        let contactUniqueId = await commonHelper.generateUniqueId(
          ContactUserCollection,
          "contact_id",
          4,
          "CU"
        );

        if (!customer) {
          customer = new ContactUserCollection({
            company_name: indiQuote.company_name || "",
            contact_id: contactUniqueId,
            contact_name: indiQuote.Customer_Name,
            admin_id: admin_id,
            contact_type: "customer",
            organization_id: `${org_id}`,
            gst_no: indiQuote.gst_number,
            is_portal_enabled: false,
            phone: "1234567890",
            status: "active",
          });
          console.log(customer, "---------customer");
          await customer.save();
        }

        let itemTotal =
          Number(indiQuote.item_price) * Number(indiQuote.quantity);
        // console.log(
        //   itemTotal,
        //   indiQuote.item_price,
        //   indiQuote.quantity,
        //   "acbuiasvcuivas"
        // );

        const processedLineItems = {
          item_id: item.item_id || null,
          name: item.name,
          description: item.description || "",
          quantity: parseFloat(indiQuote.quantity) || 0,
          rate: parseFloat(indiQuote.item_price) || 0,
          discount: parseFloat(indiQuote.discount_amount) || 0,
          tax_percentage: parseFloat(item.tax_percentage) || 0,
          item_total: parseFloat(itemTotal).toFixed(2),
          item_total_formatted: `₹${parseFloat(itemTotal).toFixed(2)}` || 0,
          unit: indiQuote.unit || "",
        };
        let quoteUniqueId = await commonHelper.generateUniqueId(
          QuoteCollection,
          "quote_id"
        );
        let estimateId = await commonHelper.generateUniqueId(
          QuoteCollection,
          "estimate_number",
          6,
          "QT"
        );
        let status_formatted;
        if (indiQuote.status == "draft") {
          status_formatted = "Draft";
        } else if (indiQuote.status == "rejected") {
          status_formatted = "Rejected";
        } else if (indiQuote.status == "accepted") {
          status_formatted = "Accepted";
        } else if (indiQuote.status == "sent") {
          status_formatted = "Sent";
        } else {
          status_formatted = "Invoiced";
        }

        let convertDate = convertDateFormats(indiQuote.date);
        let convertExpiryDate = convertDateFormats(indiQuote.expiry_date);
        const estimateData = {
          organization_id: org_id,
          quote_id: quoteUniqueId,
          customer_id: contactUniqueId,
          estimate_number: estimateId,
          customer_name: customer.contact_name,
          date: convertDate.iso,
          date_formatted: convertDate.formatted,
          expiry_date: convertExpiryDate.iso,
          expiry_date_formatted: convertExpiryDate.formatted,
          // billing_address: billing_address || "",
          // shipping_address: shipping_address || "",
          // reference_number: reference_number || "",
          // salesperson_name: salesperson_name || "",
          // project_id: project_id || null,
          notes: indiQuote.notes || "",
          terms: indiQuote.terms || "",
          line_items: processedLineItems,
          sub_total: parseFloat(indiQuote.sub_total) || 0,
          // sub_total_formatted,
          tax_type: indiQuote.tax_type || "TDS",
          tax_percentage: parseFloat(indiQuote.tax_percentage) || 0,
          tds_option: indiQuote.tds_option || "",
          adjustment: parseFloat(indiQuote.adjustment) || 0,
          total: parseFloat(indiQuote.total) || 0,
          total_formatted: `₹${parseFloat(indiQuote.total).toFixed(2)}` || 0,
          status: indiQuote.status || "draft",
          status_formatted: status_formatted,
          created_at: new Date(),
          updated_at: new Date(),
          // tax_id,
          discount_amount: indiQuote.discount_amount,
          // discount_amount_formatted,
          discount_percent: indiQuote.discount_percent,
          // tax_total,
          place_of_supply: indiQuote.place_of_supply,
        };

        // console.log(estimateData, "estimate");
        const estimate = await queryHelper.insertData(
          QuoteCollection,
          estimateData
        );
      }
      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Estimate imported successfully",
      });
    } catch (error) {
      console.log("importQuote error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
}
module.exports = new ImportController();
