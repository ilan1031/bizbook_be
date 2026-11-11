// "Only this document": business details (name, address, phone, GSTIN, ...) a
// user changed on one printed document without changing the organisation's own
// details. The preview merges them over the organisation's details.
//   GET    /org/doc-overrides?organization_id=&kind=&doc_id=
//   PUT    /org/doc-overrides   { organization_id, kind, doc_id, fields }
//   DELETE /org/doc-overrides?organization_id=&kind=&doc_id=      (back to the organisation's details)
// Reading is open (a document can't be shown without it); changing needs the
// same "Invoice & Quote Templates" edit permission as the template itself.
// The values pass the same field checks as the organisation's details
// (middleware/fieldValidation.js), so a wrong GSTIN or email is refused here too.
const mongoose = require("mongoose");
const ST_CODES = require("../helpers/statusCodeHelpers");

const KINDS = ["invoice", "quote", "sales_order", "delivery_challan", "credit_note", "purchase_order", "bill", "vendor_credit"];
const FIELDS = ["org_name", "tagline", "first_street", "second_street", "city", "zip", "state", "country", "phone", "email", "website", "gst_in", "pan_no"];
const MAX_LEN = 150;

const DocOverride =
  mongoose.models.doc_org_override ||
  mongoose.model(
    "doc_org_override",
    new mongoose.Schema(
      {
        organization_id: { type: String, required: true },
        kind: { type: String, enum: KINDS, required: true },
        doc_id: { type: String, required: true },
        fields: { type: Object, default: {} },
        updated_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
      },
      { timestamps: true, minimize: false }
    ).index({ organization_id: 1, kind: 1, doc_id: 1 }, { unique: true })
  );

const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, message });
const read = (req) => {
  const src = { ...req.query, ...(req.body || {}) };
  return { org: String(src.organization_id || src.org_id || ""), kind: String(src.kind || ""), doc: String(src.doc_id || "") };
};

class DocOverrideController {
  async get(req, res) {
    try {
      const { org, kind, doc } = read(req);
      if (!org || !KINDS.includes(kind) || !doc) return bad(res, "organization_id, kind and doc_id are required");
      const row = await DocOverride.findOne({ organization_id: org, kind, doc_id: doc }).lean();
      return res.status(ST_CODES.OK).json({ status: true, data: row?.fields || null });
    } catch (error) {
      console.error("doc override get error:", error);
      return bad(res, "Couldn't load the document details", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  async save(req, res) {
    try {
      const { org, kind, doc } = read(req);
      if (!org || !KINDS.includes(kind) || !doc) return bad(res, "organization_id, kind and doc_id are required");
      const input = req.body?.fields;
      if (!input || typeof input !== "object" || Array.isArray(input)) return bad(res, "Send the details to change");
      const fields = {};
      for (const key of FIELDS) {
        if (input[key] === undefined || input[key] === null) continue;
        const v = String(input[key]).trim();
        if (v.length > MAX_LEN) return bad(res, `${key} can be at most ${MAX_LEN} characters`);
        fields[key] = v;
      }
      if (!Object.keys(fields).length) return bad(res, "Nothing to change");
      const row = await DocOverride.findOneAndUpdate(
        { organization_id: org, kind, doc_id: doc },
        { $set: { fields, updated_by: res.locals.user_id } },
        { upsert: true, new: true }
      ).lean();
      return res.status(ST_CODES.OK).json({ status: true, message: "Saved for this document only", data: row.fields });
    } catch (error) {
      console.error("doc override save error:", error);
      return bad(res, "Couldn't save the document details", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  async remove(req, res) {
    try {
      const { org, kind, doc } = read(req);
      if (!org || !KINDS.includes(kind) || !doc) return bad(res, "organization_id, kind and doc_id are required");
      await DocOverride.deleteOne({ organization_id: org, kind, doc_id: doc });
      return res.status(ST_CODES.OK).json({ status: true, message: "This document now uses the organisation's details" });
    } catch (error) {
      console.error("doc override delete error:", error);
      return bad(res, "Couldn't reset the document details", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}

module.exports = new DocOverrideController();
module.exports.KINDS = KINDS;
module.exports.FIELDS = FIELDS;
