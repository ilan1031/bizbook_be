const mongoose = require("mongoose");
const BillsCollection = mongoose.model("PO_bill");
const PurchaseOrderCollection = mongoose.model("Purchase_Order");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const ST_CODES = require("../helpers/statusCodeHelpers");
const MESSAGES = require("../helpers/messageHelpers");

class DashboardController {
  async getReceivables(req, res) {
    try {
      let { org_id } = req.query;
      console.log("org_id", org_id);
      let receivableData = await VendorCollection.aggregate([
        {
          $match: {
            organization_id: `${org_id}`,
            contact_type: "Customer",
          },
        },
        {
          $lookup: {
            from: "invoices",
            localField: "contact_id",
            foreignField: "customer_id",
            as: "invoices",
          },
        },
        {
          $addFields: {
            total_invoice_amount: {
              $sum: "$invoices.total",
            },
          },
        },
        {
          $match: {
            total_invoice_amount: {
              $gt: 0,
            },
          },
        },
        {
          $project: {
            contact_name: 1,
            phone: 1,
            amount_received: {
              $sum: {
                $map: {
                  input: "$invoices",
                  as: "invoice",
                  in: {
                    $subtract: ["$$invoice.total", "$$invoice.balance"],
                  },
                },
              },
            },
            total_invoices: {
              $size: "$invoices",
            },
            invoice_numbers: {
              $map: {
                input: "$invoices",
                as: "invoice",
                in: "$$invoice.invoice_id",
              },
            },
            total_invoice_amount: 1,
          },
        },
      ]);
      if (receivableData) {
        return res
          .status(ST_CODES.OK)
          .send({ Message: "Fetched successfully", data: receivableData });
      }
      return res
        .status(ST_CODES.OK)
        .send({ Message: "There is no data", data: [] });
      // return res.status(ST_CODES.).send({"Message":"Fetched successfully",data:receivableData})
    } catch (error) {
      console.log("error-----133--", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ Message: "Something went wrong", error });
    }
  }
  async getPayables(req, res) {
    try {
      let { org_id } = req.query;
      let payableData = await VendorCollection.aggregate([
        {
          $match: {
            organization_id: org_id,
            contact_type: "Vendor",
          },
        },
        {
          $lookup: {
            from: "po_bills",
            localField: "_id",
            foreignField: "vendor_id",
            as: "bills",
          },
        },
        {
          $addFields: {
            total_bill_amount: {
              $sum: "$bills.total",
            },
          },
        },
        {
          $match: {
            total_bill_amount: {
              $gt: 0,
            },
          },
        },
        {
          $project: {
            contact_name: 1,
            phone: 1,
            amount_paid: {
              $sum: {
                $map: {
                  input: "$bills",
                  as: "bill",
                  in: {
                    $subtract: ["$$bill.total", "$$bill.due_amt"],
                  },
                },
              },
            },
            total_bills: {
              $size: "$bills",
            },
            bill_numbers: {
              $map: {
                input: "$bills",
                as: "bill",
                in: "$$bill.bill_number",
              },
            },
            total_bill_amount: 1,
          },
        },
      ]);
      if (payableData) {
        return res
          .status(ST_CODES.OK)
          .send({ Message: "Fetched successfully", data: payableData });
      }
      return res
        .status(ST_CODES.OK)
        .send({ Message: "There is no data", data: [] });
    } catch (error) {
      console.log("error-----133--", error);
      res
        .status(ST_CODES.INTERNAL_SERVER_ERROR)
        .send({ Message: "Something went wrong", error });
    }
  }
}

module.exports = new DashboardController();
