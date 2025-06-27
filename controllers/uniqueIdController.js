const mongoose = require("mongoose");
const BillsCollection = mongoose.model("PO_bill");
const OrganizationCollection = mongoose.model("Organization");
const PurchaseOrderCollection = mongoose.model("Purchase_Order");
const PaymentCollection = mongoose.model("Payment");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");

class UniqueIdController {
  async getUniqueID(req, res) {
    try {
      let bData = req.body;
      let collection;
      let uniqueField;
      let prefix;
      let digits = 0;

      if (bData.module == "purchaseOrder") {
        collection = PurchaseOrderCollection;
        uniqueField = "purchase_number";
        prefix = "PO";
        digits = 7;
      } else if (bData.module === "bill"){
        collection = BillsCollection;
        uniqueField = "bill_number";
        prefix = "BL";
        digits = 7;
      } else if (bData.module === "payment_made"){
        collection = PaymentCollection;
        uniqueField = "payment_id";
        prefix = "PM";
        digits = 5;
      }
      let uniqueID = await commonHelper.generateUniqueId(
        collection,
        uniqueField,
        digits,
        prefix
      );
      res.status(ST_CODES.OK).send({ data: uniqueID });
    } catch (error) {
      console.log("getPurchaseOrderID error: " + error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ message: "Something went wrong" });
    }
  }
}

module.exports = new UniqueIdController();
