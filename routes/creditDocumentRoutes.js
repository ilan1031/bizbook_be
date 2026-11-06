const express = require("express");
const { creditNotes, vendorCredits } = require("../controllers/creditDocumentController");
const authMiddleware = require("../middleware/userMiddleware");
const periodLock = require("../helpers/periodLock");
const router = express.Router();

// Same endpoints for both: /credit-notes (customers, applied to invoices)
// and /vendor-credits (vendors, applied to bills). :id is the credit number.
for (const [base, c] of [["/credit-notes", creditNotes], ["/vendor-credits", vendorCredits]]) {
  router.get(`${base}/lookups`, authMiddleware, c.lookups);
  router.get(base, authMiddleware, c.list);
  router.post(base, authMiddleware, periodLock.guard(base === "/credit-notes" ? "creditNote" : "vendorCredit"), c.create);
  router.get(`${base}/:id`, authMiddleware, c.get);
  router.put(`${base}/:id`, authMiddleware, periodLock.guard(base === "/credit-notes" ? "creditNote" : "vendorCredit"), c.update);
  router.delete(`${base}/:id`, authMiddleware, periodLock.guard(base === "/credit-notes" ? "creditNote" : "vendorCredit"), c.remove);
  router.put(`${base}/:id/status`, authMiddleware, periodLock.guard(base === "/credit-notes" ? "creditNote" : "vendorCredit"), c.setStatus);
  router.get(`${base}/:id/open-documents`, authMiddleware, c.openDocuments);
  router.post(`${base}/:id/apply`, authMiddleware, periodLock.guard(base === "/credit-notes" ? "creditNote" : "vendorCredit"), c.apply);
  router.post(`${base}/:id/refund`, authMiddleware, periodLock.guard(base === "/credit-notes" ? "creditNote" : "vendorCredit"), c.refund);
}

module.exports = router;
