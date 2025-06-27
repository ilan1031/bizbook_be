const mongoose = require("mongoose");
const VendorCollection = mongoose.model("Contact");
const BillsCollection = mongoose.model("PO_bill");
const OrganizationCollection = mongoose.model("Organization");
const PurchaseOrderCollection = mongoose.model("Purchase_Order");
const queryHelper = require("../helpers/query");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");

class Vendor {
  async getVendorBills(req, res) {
    try {
      const { org_id, vendor_id } = req.query;
      if (!org_id || !vendor_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Unauthorized route" });
      }
      let vendorData = await VendorCollection.findOne({
        contact_id: vendor_id,
      });
      if (!vendorData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Vendor cannot find" });
      }
      let billData = await BillsCollection.find({
        admin_id: res.locals.user_id,
        organization_id: org_id,
        vendor_id: vendorData._id,
      });
      if (billData) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Bills found",
          data: billData,
        });
      }
      return res.status(ST_CODES.NOT_FOUND).json({
        success: false,
        message: "Bills not found",
        data: [],
      });
    } catch (error) {
      console.log("getVendorBills error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
  async getVendorPurchaseOrder(req, res) {
    try {
      const { org_id, vendor_id } = req.query;
      if (!org_id || !vendor_id) {
        return res
          .status(ST_CODES.BAD_REQUEST)
          .send({ message: "Unauthorized route" });
      }
      let vendorData = await VendorCollection.findOne({
        contact_id: vendor_id,
      });
      if (!vendorData) {
        return res
          .status(ST_CODES.NOT_FOUND)
          .send({ message: "Vendor cannot find" });
      }
      let poData = await PurchaseOrderCollection.find({
        admin_id: res.locals.user_id,
        org_id: org_id,
        vendor_id: vendorData._id,
      });
      if (poData) {
        return res.status(ST_CODES.OK).json({
          success: true,
          message: "Purchase order found",
          data: poData,
        });
      }
      return res.status(ST_CODES.NOT_FOUND).json({
        success: false,
        message: "Purchase order not found",
        data: [],
      });
    } catch (error) {
      console.log("getVendorPurchaseOrder error", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
}

module.exports = new Vendor();
