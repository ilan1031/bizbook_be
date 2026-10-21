const express = require("express");
const { creditNotes, vendorCredits } = require("../controllers/creditDocumentController");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// Same endpoints for both: /credit-notes (customers, applied to invoices)
// and /vendor-credits (vendors, applied to bills). :id is the credit number.
for (const [base, c] of [["/credit-notes", creditNotes], ["/vendor-credits", vendorCredits]]) {
  router.get(`${base}/lookups`, authMiddleware, c.lookups);
  router.get(base, authMiddleware, c.list);
  router.post(base, authMiddleware, c.create);
  router.get(`${base}/:id`, authMiddleware, c.get);
  router.put(`${base}/:id`, authMiddleware, c.update);
  router.delete(`${base}/:id`, authMiddleware, c.remove);
  router.put(`${base}/:id/status`, authMiddleware, c.setStatus);
  router.get(`${base}/:id/open-documents`, authMiddleware, c.openDocuments);
  router.post(`${base}/:id/apply`, authMiddleware, c.apply);
  router.post(`${base}/:id/refund`, authMiddleware, c.refund);
}

module.exports = router;
