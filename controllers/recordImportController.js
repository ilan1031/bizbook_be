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
COLUMNS.chartOfAccounts = ["account_name", "account_code", "account_type", "description"];

const text = (v, max = 300) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));

// Strict number for amounts: blank is 0, anything that isn't a plain number
// (e.g. "abc12") is null so the row is reported instead of guessed.
const strictNumber = (v) => {
  const s = String(v ?? "").trim().replace(/[,\s₹]/g, "");
  if (s === "") return 0;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};
const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
const MAX_RATE = 1e10;

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
      const rate = strictNumber(row.rate);
      const purchaseRate = strictNumber(row.purchase_rate);
      const gst = strictNumber(row.tax_percentage ?? row.gst_rate);
      const rowError =
        rate === null || rate < 0 || rate > MAX_RATE
          ? "Rate must be a number between 0 and 10,000,000,000"
          : purchaseRate === null || purchaseRate < 0 || purchaseRate > MAX_RATE
            ? "Purchase rate must be a number between 0 and 10,000,000,000"
            : gst === null || !GST_RATES.includes(gst)
              ? `GST % must be one of ${GST_RATES.join(", ")}`
              : null;
      if (rowError) {
        errors.push({ row: i + 1, message: rowError });
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
        rate,
        purchase_rate: purchaseRate,
        description: text(row.description, 2000),
        purchase_description: text(row.purchase_description, 2000),
        item_type: type,
        item_type_formatted: type === "service" ? "Service" : "Goods",
        hsn_or_sac: text(row.hsn_or_sac, 20),
        // The item's GST rate lives in gst_rate (model/Item.js).
        gst_rate: gst,
        is_taxable: gst > 0,
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

// Chart of accounts: rows { account_name, account_type, account_code?,
// description? }. The type may be the code ("expense") or its label
// ("Expense"). Names already in the chart (any case) are skipped.
const importAccounts = async (req, res) => {
  try {
    const mongoose = require("mongoose");
    const COA = mongoose.model("Chart_of_account");
    const defaults = require("../helpers/chartOfAccounts.json");
    const orgId = String(req.query.org_id || req.query.organization_id || "");
    if (!orgId) return res.status(ST_CODES.BAD_REQUEST).json({ message: "org_id is required" });
    const { rows, error } = rowsOf(req);
    if (error) return res.status(ST_CODES.BAD_REQUEST).json({ message: error });
    const chart = await COA.findOne({ organization_id: orgId, admin_id: res.locals.user_id });
    if (!chart) return res.status(ST_CODES.BAD_REQUEST).json({ message: "This organisation has no chart of accounts" });

    const labels = {};
    defaults.forEach((a) => {
      if (a.account_type) labels[a.account_type] = a.account_type_formatted;
    });
    const typeOf = (v) => {
      const t = text(v).toLowerCase();
      if (labels[t]) return t;
      const byLabel = Object.keys(labels).find((k) => labels[k].toLowerCase() === t || k.replace(/_/g, " ") === t);
      return byLabel || null;
    };
    const key = (v) => text(v).replace(/\s+/g, " ").toLowerCase();
    const existing = new Set(chart.chart_of_accounts.map((a) => key(a.account_name)));
    let next = chart.chart_of_accounts.reduce((m, a) => Math.max(m, Number(String(a.account_id || "").split("_")[1]) || 0), 0);
    const added = [];
    let skipped = 0;
    const errors = [];
    let room = await remainingCreates(res.user);
    for (const [i, row] of rows.entries()) {
      const name = text(row.account_name, 150).replace(/\s+/g, " ");
      if (!name) {
        errors.push({ row: i + 1, message: "Account name is missing" });
        continue;
      }
      if (existing.has(key(name))) {
        skipped += 1;
        continue;
      }
      const type = typeOf(row.account_type);
      if (!type) {
        errors.push({ row: i + 1, message: `Unknown account type "${text(row.account_type, 40)}"` });
        continue;
      }
      if (room <= 0) {
        errors.push({ row: i + 1, message: "Your create limit has been reached" });
        continue;
      }
      next += 1;
      added.push({
        account_id: `AC_${String(next).padStart(3, "0")}`,
        account_name: name,
        account_code: text(row.account_code, 30),
        account_type: type,
        account_type_formatted: labels[type],
        description: text(row.description, 500),
        is_user_created: true,
        is_system_account: false,
        is_active: true,
      });
      existing.add(key(name));
      room -= 1;
    }
    if (added.length) {
      await COA.updateOne({ _id: chart._id }, { $push: { chart_of_accounts: { $each: added } } });
      await recordCreate(res.user._id, "chartOfAccounts", added.length);
    }
    return res.status(ST_CODES.OK).json(summary(added.length, skipped, errors));
  } catch (err) {
    console.error("importAccounts error:", err);
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Import failed" });
  }
};

module.exports = {
  COLUMNS,
  importAccounts,
  importCustomers: importContacts("Customer"),
  importVendors: importContacts("Vendor"),
  importItems,
};
