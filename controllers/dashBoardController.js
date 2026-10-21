const mongoose = require("mongoose");
const BillsCollection = mongoose.model("PO_bill");
const PurchaseOrderCollection = mongoose.model("Purchase_Order");
const VendorCollection = mongoose.model("Contact");
const OrgCollection = mongoose.model("Organization");
const InvoiceCollection = require("../model/invoice");
const ST_CODES = require("../helpers/statusCodeHelpers");
const MESSAGES = require("../helpers/messageHelpers");
const { toPaise, fromPaise } = require("../helpers/accountingHelper");

// Splits open documents into what's still within terms and what's overdue.
// `outstanding(doc)` is the unpaid amount of one document.
const ageDocuments = (docs, outstanding) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let total = 0;
  let overdue = 0;
  for (const doc of docs) {
    const due = toPaise(outstanding(doc));
    if (due <= 0) continue;
    total += due;
    const dueDate = doc.due_date ? new Date(doc.due_date) : null;
    if (dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < today) overdue += due;
  }
  return {
    total: fromPaise(total),
    current: fromPaise(total - overdue),
    overdue: fromPaise(overdue),
    count: docs.length,
  };
};

const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

class DashboardController {
  // Receivables (open invoices) and payables (open bills) for the dashboard
  // cards, computed over every document of the organisation.
  async getSummary(req, res) {
    try {
      const orgId = String(req.query.org_id || req.query.organization_id || "");
      if (!orgId) {
        return res.status(ST_CODES.BAD_REQUEST).send({ message: "org_id is required" });
      }
      const orgIds = [orgId, Number(orgId)].filter((v) => v !== "" && !Number.isNaN(v));
      const [invoices, bills] = await Promise.all([
        InvoiceCollection.find(
          { organization_id: { $in: orgIds }, status: { $nin: ["draft", "Draft", "void", "Void"] } },
          { total: 1, balance: 1, due_date: 1 }
        ).lean(),
        BillsCollection.find(
          { organization_id: { $in: orgIds }, status_type: { $nin: ["DRAFT", "VOID"] } },
          { total: 1, balance: 1, due_amt: 1, payment_made: 1, due_date: 1 }
        ).lean(),
      ]);
      const receivables = ageDocuments(invoices, (inv) => num(inv.balance) ?? num(inv.total) ?? 0);
      const payables = ageDocuments(
        bills,
        (bill) => num(bill.balance) ?? num(bill.due_amt) ?? (num(bill.total) || 0) - (num(bill.payment_made) || 0)
      );
      return res.status(ST_CODES.OK).send({ message: "Fetched successfully", data: { receivables, payables } });
    } catch (error) {
      console.error("dashboard getSummary error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({ message: "Something went wrong" });
    }
  }


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
