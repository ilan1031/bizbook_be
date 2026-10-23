const mongoose = require("mongoose");
const ExpenseCollection = mongoose.model("Expense");
const PurchaseOrderCollection = mongoose.model("Purchase_Order");
const VendorCollection = mongoose.model("Contact");
const BillsCollection = mongoose.model("PO_bill");
const ItemCollection = mongoose.model("Item");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");

async function getCollectionKeys(model) {
  try {
    const keys = Object.keys(model.schema.paths);
    return keys;
  } catch (error) {
    console.error("Error fetching collection keys:", error);
    throw error;
  }
}

const uploadForBills = async (data, ORG_ID, ADMIN_ID, COLLECTION) => {
  for (let i = 0; i < data.length; i++) {
    const element = data[i];
    console.log("element", element);
    let billUniqueId = await commonHelper.generateUniqueId(
      BillsCollection,
      "bill_number",
      7,
      "BL"
    );
    let findVendor_id = await VendorCollection.findOne({
      contact_name: element["Vendor Name"],
    });

    let newDocs = await BillsCollection({
      billNumber: element["Bill Number"],
      orderNumber: element["Order Number"],
      bill_number: billUniqueId,
      admin_id: ADMIN_ID,
      organization_id: ORG_ID,
      vendor_id: findVendor_id._id, // nned to updated
      taxCategory: element["Tax Category"],
      status_type: element["Bill Status"],
      billDate: element["Bill Date"],
      due_date: element["Due Date"],
      paymentTerms: element["Payment Terms Label"],
      commission: element["Commission"],
      total: element["Total"],
      subtotal: element["SubTotal"],
      taxAmount: element["Tax Amount"],
      adjustment: element["Adjustment"],
      imported_purchase_order_no: element["Purchase Order Number"],
      balance: element["Balance"],
      currency_id: element["Currency Code"],
      source_of_supply: element["Source of Supply"],
      destination_of_supply: element["Destination of Supply"],
      gst_no: element["GST Identification Number (GSTIN)"],
      exchange_rate: element["Exchange Rate"],
    });
    await newDocs.save();
  }
};

class ImportFilesController {
  async uploadFiles(req, res) {
    try {
      let files = req.file;
      let { org_id } = req.query;
      console.log("files", files);
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      let results = [];
      fs.createReadStream(files.path)
        .pipe(csv())
        .on("data", (data) => {
          // console.log(data, "data.organization_id");
          // if (data.organization_id == "" || !data.organization_id) {
          //   console.log("throw an error...");
          // }
          results.push(data);
        })
        .on("end", () => {
          uploadForBills(results, org_id, res.locals.user_id, BillsCollection);
          res.status(200).json({
            message: "CSV uploaded and parsed successfully",
            rows: results.length,
            data: results,
          });
        })
        .on("error", (err) => {
          console.error("CSV Parsing Error:", err);
          res.status(500).json({ error: "Failed to parse CSV file" });
        });
    } catch (error) {
      console.log("uploadFiles error", error);
    }
  }
  async sendCollecetionKeys(req, res) {
    try {
      let collectionName;
      let keys;
      let restrictedKeys;
      let Qdata = req.query.moduleName;
      const fixed = require("./recordImportController").COLUMNS[Qdata];
      if (fixed) {
        return res.status(ST_CODES.OK).json({ success: true, message: "Columns fetched", data: fixed });
      }
      console.log(Qdata, "Qdata");
      if (Qdata == "bills") {
        collectionName = BillsCollection;
        keys = await getCollectionKeys(collectionName);
        keys.push("vendor_name");
        keys.push("item_name");
        keys.push("item_description");
        keys.push("item_total");
        keys.push("SKU");
        keys.push("quantity");

        restrictedKeys = [
          "__v",
          "_id",
          "createdAt",
          "updatedAt",
          "admin_id",
          "organization_id",
          "created_by_id",
          "last_modified_id",
          "last_modified_time",
          "created_time",
          "items",
          "purchase_orders",
          "comments",
          "billing_address",
          "bill_number",
          "status",
          "status_type",
          "taxes",
          "vendor_id",
          "documents",
          "source",
        ];
      } else if (Qdata == "purchase-order") {
        collectionName = PurchaseOrderCollection;
        keys = await getCollectionKeys(collectionName);
        keys.push("vendor_name");
        keys.push("item_name");
        keys.push("item_description");
        keys.push("item_total");
        keys.push("SKU");
        keys.push("quantity");

        restrictedKeys = [
          "__v",
          "_id",
          "createdAt",
          "updatedAt",
          "admin_id",
          "organization_id",
          "created_by_id",
          "last_modified_id",
          "last_modified_time",
          "created_time",
          "items",
          "purchase_orders",
          "comments",
          "billing_address",
          "shipping_address",
          "purchase_number",
          "status",
          "status_type",
          "taxes",
          "vendor_id",
          "documents",
          "source",
          "received_status",
          "received_status_formatted",
          "status_formatted",
          "order_status_formatted",
          "deleted_at",
          "billNumber",
          "bill_number",
        ];
      } else if (Qdata == "expense") {
        collectionName = ExpenseCollection;
      }

      const filteredKeys = keys.filter((key) => !restrictedKeys.includes(key));
      console.log("filteredKeys-------", filteredKeys);
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
  async uploadBills(req, res) {
    try {
      let bData = req.body;
      let { org_id } = req.query;
      let admin_id = res.locals.user_id;
      for (const indiBill of bData) {
        // console.log(org_id, admin_id, "indiBill----->", indiBill);

        // Step 1: Ensure item exists
        let item = await ItemCollection.findOne({
          name: indiBill.name,
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
            item_name: indiBill.item_name,
            item_id: itemUniqueId,
            name: indiBill.item_name,
            sku: indiBill.SKU,
            description: indiBill.item_description,
            organization_id: org_id,
            rate: Number(indiBill.item_total),
            can_be_purchased: true,
            unit: "Nos", // Optional default
            status: "active", // Optional
          });
          await item.save();
        }

        // Step 2: Ensure vendor exists
        let vendor = await VendorCollection.findOne({
          contact_name: indiBill.vendor_name,
          org_id: org_id,
        });
        let contactUniqueId = await commonHelper.generateUniqueId(
          VendorCollection,
          "contact_id",
          4,
          "CU"
        );

        if (!vendor) {
          vendor = new VendorCollection({
            company_name: indiBill.vendor_name,
            contact_id: contactUniqueId,
            contact_name: indiBill.vendor_name,
            admin_id: admin_id,
            contact_type: "Vendor",
            organization_id: `${org_id}`,
            gst_no: indiBill.gst_no,
            is_portal_enabled: false,
            phone: "1234567890",
            status: "active",
          });
          await vendor.save();
        }

        // console.log(vendor, "vendor");
        // console.log(item, "item");
        // Step 3: Generate unique bill number
        let billUniqueId = await commonHelper.generateUniqueId(
          BillsCollection,
          "estimate_number",
          7,
          "BL"
        );
        // return;
        // Step 4: Build Bill Document
        const billDoc = new BillsCollection({
          bill_number: billUniqueId,
          billNumber: indiBill.billNumber,
          orderNumber: indiBill.orderNumber,
          admin_id: admin_id,
          organization_id: Number(org_id),
          vendor_id: vendor._id,
          taxCategory: indiBill.taxCategory,
          source: "Manual", // or other source
          notes: indiBill.notes,
          source_of_supply: indiBill.source_of_supply,
          destination_of_supply: indiBill.destination_of_supply,
          gst_no: indiBill.gst_no,
          reference_number: indiBill.reference_number?.trim(),
          billDate: new Date(indiBill.billDate),
          due_date: new Date(indiBill.due_date),
          currency_id: "INR", // Default, or from indiBill
          paymentTerms: indiBill.paymentTerms,
          exchange_rate: 1,
          commission: Number(indiBill.commission),
          subtotal: Number(indiBill.subtotal),
          total: Number(indiBill.total),
          taxAmount: Number(indiBill.taxAmount),
          adjustment: Number(indiBill.adjustment),
          payment_made: Number(indiBill.payment_made),
          status: 0,
          status_type: "OPEN",
          balance: Number(indiBill.due_amt),
          due_amt: Number(indiBill.due_amt),
          items: [
            {
              item_id: item.item_id,
              sku: item.sku,
              item_name: item.item_name,
              quantity: Number(indiBill.quantity),
              rate: Number(indiBill.item_total),
              item_total: Number(indiBill.item_total),
              unit: item.unit || "Nos",
              account_id: item.account_id || "",
              details: item.description || "",
            },
          ],
        });

        await billDoc.save();
      }

      return res.status(200).send({ message: "Bills uploaded successfully" });
    } catch (error) {
      console.log("sendCollecetionKeys error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async uploadPurchaseOrder(req, res) {
    try {
      let bData = req.body;
      let { org_id } = req.query;
      let admin_id = res.locals.user_id;
      for (const indiPurchase of bData) {
        // console.log(org_id, admin_id, "indiPurchase----->", indiPurchase);

        // Step 1: Ensure item exists
        let item = await ItemCollection.findOne({
          name: indiPurchase.name,
          // sku: indiPurchase.SKU,
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
            item_name: indiPurchase.item_name,
            item_id: itemUniqueId,
            name: indiPurchase.item_name,
            sku: indiPurchase.SKU,
            description: indiPurchase.item_description,
            organization_id: org_id,
            rate: Number(indiPurchase.item_total),
            can_be_purchased: true,
            unit: "Nos", // Optional default
            status: "active", // Optional
          });
          await item.save();
        }

        // Step 2: Ensure vendor exists
        let vendor = await VendorCollection.findOne({
          contact_name: indiPurchase.vendor_name,
          org_id: org_id,
        });
        let contactUniqueId = await commonHelper.generateUniqueId(
          VendorCollection,
          "contact_id",
          4,
          "CU"
        );

        if (!vendor) {
          vendor = new VendorCollection({
            company_name: indiPurchase.vendor_name,
            contact_id: contactUniqueId,
            contact_name: indiPurchase.vendor_name,
            admin_id: admin_id,
            contact_type: "Vendor",
            organization_id: `${org_id}`,
            gst_no: indiPurchase.gst_no,
            is_portal_enabled: false,
            phone: "1234567890",
            status: "active",
          });
          await vendor.save();
        }

        // console.log(vendor, "vendor");
        // console.log(item, "item");
        // Step 3: Generate unique bill number
        let poUniqueId = await commonHelper.generateUniqueId(
          PurchaseOrderCollection,
          "purchase_number",
          7,
          "PO"
        );
        // return;
        // Step 4: Build Bill Document
        const purchaseDoc = new PurchaseOrderCollection({
          purchase_number: poUniqueId,
          purchase_order_number: indiPurchase.purchase_order_number,
          reference_number: indiPurchase.reference_number,
          admin_id: admin_id,
          org_id: Number(org_id),
          vendor_id: vendor._id,
          tax_category: indiPurchase.tax_category,
          source: "file upload", // or other source
          notes: indiPurchase.notes,
          source_of_supply: indiPurchase.source_of_supply,
          destination_of_supply: indiPurchase.destination_of_supply,
          date: new Date(indiPurchase.date),
          due_date: new Date(indiPurchase.due_date),
          currency_id: "INR", // Default, or from indiPurchase
          payment_terms: indiPurchase.payment_terms,
          exchange_rate: 1,
          commission: Number(indiPurchase.commission),
          subtotal: Number(indiPurchase.subtotal),
          total: Number(indiPurchase.total),
          taxAmount: Number(indiPurchase.taxAmount),
          adjustment: Number(indiPurchase.adjustment),
          payment_made: 10,
          taxAmount: 10,
          status: indiPurchase.status,
          status_type: indiPurchase.status_type,
          items: [
            {
              item_id: item.item_id,
              sku: item.sku,
              item_name: item.item_name,
              quantity: Number(indiPurchase.quantity),
              rate: Number(indiPurchase.item_total),
              item_total: Number(indiPurchase.item_total),
              unit: item.unit || "Nos",
              account_id: item.account_id || "",
              details: item.description || "",
            },
          ],
        });

        await purchaseDoc.save();
      }

      return res.status(200).send({ message: "Bills uploaded successfully" });
    } catch (error) {
      console.log("sendCollecetionKeys error", error);
      return res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
}

module.exports = new ImportFilesController();
