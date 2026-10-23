// Imports customers, vendors and items from rows the import screen has
// already parsed and mapped (POST body: array of { field: value }).
// Rows whose name already exists in the organisation are skipped, so
// running the same file twice doesn't create duplicates.
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const Contact = require("../model/contactModel");
const Item = require("../model/Item");
const { remainingCreates, recordCreate } = require("../helpers/usageLimits");

const MAX_ROWS = 5000;

// Columns offered on the "Map fields" step, per module.
const COLUMNS = {
  customers: [
    "contact_name", "company_name", "first_name", "last_name", "email", "phone", "mobile",
    "website", "gst_no", "gst_treatment", "place_of_contact", "pan_no", "payment_terms", "notes",
  ],
  items: [
    "name", "sku", "unit", "rate", "purchase_rate", "description", "purchase_description",
    "item_type", "hsn_or_sac", "tax_percentage",
  ],
};
COLUMNS.vendors = COLUMNS.customers;

const text = (v, max = 300) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));
const number = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const rowsOf = (req) => {
  const body = req.body;
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;
  if (!rows) return { error: "Send the rows to import as an array" };
  if (rows.length > MAX_ROWS) return { error: `Import at most ${MAX_ROWS} rows at a time` };
  return { rows };
};

const summary = (inserted, skipped, errors) => ({
  success: true,
  message: `Imported ${inserted}, skipped ${skipped}${errors.length ? `, ${errors.length} with errors` : ""}`,
  data: { inserted, skipped, errors: errors.slice(0, 50) },
});

const importContacts = (contactType) => async (req, res) => {
  try {
    const orgId = String(req.query.org_id || req.query.organization_id || "");
    if (!orgId) return res.status(ST_CODES.BAD_REQUEST).json({ message: "org_id is required" });
    const { rows, error } = rowsOf(req);
    if (error) return res.status(ST_CODES.BAD_REQUEST).json({ message: error });

    const existing = new Set(
      (await Contact.find({ organization_id: orgId, contact_type: contactType }, { contact_name: 1 }).lean()).map((c) =>
        text(c.contact_name).toLowerCase()
      )
    );
    let inserted = 0;
    let skipped = 0;
    const errors = [];
    let room = await remainingCreates(res.user);
    for (const [i, row] of rows.entries()) {
      const name =
        text(row.contact_name) || text(row.company_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");
      if (!name) {
        errors.push({ row: i + 1, message: "Name is missing" });
        continue;
      }
      if (existing.has(name.toLowerCase())) {
        skipped += 1;
        continue;
      }
      const email = text(row.email, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ row: i + 1, message: `Invalid email "${email}"` });
        continue;
      }
      if (room <= 0) {
        errors.push({ row: i + 1, message: "Your create limit has been reached" });
        continue;
      }
      const contactId = await commonHelper.generateUniqueId(Contact, "contact_id", 4, "CU");
      await Contact.create({
        contact_id: contactId,
        admin_id: res.locals.user_id,
        organization_id: orgId,
        contact_type: contactType,
        contact_name: name,
        company_name: text(row.company_name) || name,
        first_name: text(row.first_name),
        last_name: text(row.last_name),
        email,
        phone: text(row.phone, 30),
        mobile: text(row.mobile, 30),
        website: text(row.website),
        gst_no: text(row.gst_no, 20),
        gst_treatment: text(row.gst_treatment, 60),
        place_of_contact: text(row.place_of_contact, 60),
        pan_no: text(row.pan_no, 20),
        payment_terms: text(row.payment_terms, 60),
        notes: text(row.notes, 2000),
        status: "active",
        source: "import",
      });
      existing.add(name.toLowerCase());
      inserted += 1;
      room -= 1;
    }
    if (inserted) await recordCreate(res.user._id, contactType === "Customer" ? "customers" : "vendors", inserted);
    return res.status(ST_CODES.OK).json(summary(inserted, skipped, errors));
  } catch (err) {
    console.error("importContacts error:", err);
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Import failed" });
  }
};

const importItems = async (req, res) => {
  try {
    const orgId = String(req.query.org_id || req.query.organization_id || "");
    if (!orgId) return res.status(ST_CODES.BAD_REQUEST).json({ message: "org_id is required" });
    const { rows, error } = rowsOf(req);
    if (error) return res.status(ST_CODES.BAD_REQUEST).json({ message: error });

    const existing = new Set(
      (await Item.find({ organization_id: orgId }, { name: 1 }).lean()).map((it) => text(it.name).toLowerCase())
    );
    let inserted = 0;
    let skipped = 0;
    const errors = [];
    let room = await remainingCreates(res.user);
    for (const [i, row] of rows.entries()) {
      const name = text(row.name) || text(row.item_name);
      if (!name) {
        errors.push({ row: i + 1, message: "Name is missing" });
        continue;
      }
      if (existing.has(name.toLowerCase())) {
        skipped += 1;
        continue;
      }
      if (room <= 0) {
        errors.push({ row: i + 1, message: "Your create limit has been reached" });
        continue;
      }
      const type = /service/i.test(text(row.item_type)) ? "service" : "goods";
      const itemId = await commonHelper.generateUniqueId(Item, "item_id");
      await Item.create({
        item_id: itemId,
        admin_id: res.locals.user_id,
        organization_id: orgId,
        name,
        item_name: name,
        sku: text(row.sku, 60),
        unit: text(row.unit, 30) || "Nos",
        rate: number(row.rate),
        purchase_rate: number(row.purchase_rate),
        description: text(row.description, 2000),
        purchase_description: text(row.purchase_description, 2000),
        item_type: type,
        item_type_formatted: type === "service" ? "Service" : "Goods",
        hsn_or_sac: text(row.hsn_or_sac, 20),
        tax_percentage: number(row.tax_percentage),
        status: "active",
        source: "import",
      });
      existing.add(name.toLowerCase());
      inserted += 1;
      room -= 1;
    }
    if (inserted) await recordCreate(res.user._id, "items", inserted);
    return res.status(ST_CODES.OK).json(summary(inserted, skipped, errors));
  } catch (err) {
    console.error("importItems error:", err);
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Import failed" });
  }
};

module.exports = {
  COLUMNS,
  importCustomers: importContacts("Customer"),
  importVendors: importContacts("Vendor"),
  importItems,
};
