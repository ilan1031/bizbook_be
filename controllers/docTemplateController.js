// Invoice and quote templates, one of each per organisation.
//   GET /org/templates?organization_id=            -> { invoice, quote }
//   PUT /org/templates/:type?organization_id=      -> save one (needs the
//       "Invoice & Quote Templates" edit permission; see FEATURE_RULES)
// Reading is open to anyone in the organisation, since printing a document
// needs its template.
const mongoose = require("mongoose");
const ST_CODES = require("../helpers/statusCodeHelpers");

const TYPES = ["invoice", "quote"];
const STYLES = ["standard", "terranova"];
const MAX_LOGO = 400 * 1024; // data URL characters

const DocTemplate =
  mongoose.models.doc_template ||
  mongoose.model(
    "doc_template",
    new mongoose.Schema(
      {
        organization_id: { type: String, required: true },
        type: { type: String, enum: TYPES, required: true },
        settings: { type: Object, default: {} },
        updated_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
      },
      { timestamps: true, minimize: false }
    ).index({ organization_id: 1, type: 1 }, { unique: true })
  );

const DEFAULTS = {
  invoice: {
    style: "terranova",
    title: "TAX INVOICE",
    subtitle: "",
    accent: "#1f1f1f",
    tagline: "",
    show_ship_to: true,
    show_supply_details: true,
    show_hsn_summary: true,
    show_amount_in_words: true,
    advance_percent: 0,
    bank: { account_name: "", bank: "", account_no: "", ifsc: "", branch: "", upi: "" },
    terms: "",
    note: "",
    signatory: "",
    footer: "This is a computer-generated invoice. · Thank you for your business.",
    logo: "",
  },
  quote: {
    style: "terranova",
    title: "QUOTATION",
    subtitle: "",
    accent: "#1f1f1f",
    tagline: "",
    show_ship_to: true,
    show_supply_details: true,
    show_hsn_summary: true,
    show_amount_in_words: true,
    advance_percent: 0,
    bank: { account_name: "", bank: "", account_no: "", ifsc: "", branch: "", upi: "" },
    terms: "1. This quotation is valid for 15 days from the date of issue.",
    note: "",
    signatory: "",
    footer: "This is a computer-generated quotation. · Thank you for your business.",
    logo: "",
  },
};

const str = (v, max) => (v === undefined || v === null ? "" : String(v).slice(0, max));
const bool = (v, d) => (v === undefined ? d : Boolean(v));

// Keeps only known fields, with sane lengths.
const clean = (type, input = {}) => {
  const d = DEFAULTS[type];
  const bank = input.bank || {};
  const logo = str(input.logo, MAX_LOGO + 1);
  if (logo && (logo.length > MAX_LOGO || !/^data:image\/(png|jpe?g|svg\+xml|webp);base64,/.test(logo))) {
    return { error: "The logo must be a PNG, JPG, SVG or WebP image under about 300 KB" };
  }
  const advance = Number(input.advance_percent ?? d.advance_percent);
  if (!Number.isFinite(advance) || advance < 0 || advance > 100) return { error: "Advance must be between 0 and 100 percent" };
  const accent = str(input.accent || d.accent, 20);
  if (!/^#[0-9a-fA-F]{3,8}$/.test(accent)) return { error: "Accent colour must be a hex colour like #1f1f1f" };
  return {
    settings: {
      style: STYLES.includes(input.style) ? input.style : d.style,
      title: str(input.title ?? d.title, 60),
      subtitle: str(input.subtitle ?? d.subtitle, 80),
      accent,
      tagline: str(input.tagline ?? d.tagline, 200),
      show_ship_to: bool(input.show_ship_to, d.show_ship_to),
      show_supply_details: bool(input.show_supply_details, d.show_supply_details),
      show_hsn_summary: bool(input.show_hsn_summary, d.show_hsn_summary),
      show_amount_in_words: bool(input.show_amount_in_words, d.show_amount_in_words),
      advance_percent: advance,
      bank: {
        account_name: str(bank.account_name, 100),
        bank: str(bank.bank, 100),
        account_no: str(bank.account_no, 40),
        ifsc: str(bank.ifsc, 20),
        branch: str(bank.branch, 100),
        upi: str(bank.upi, 100),
      },
      terms: str(input.terms ?? d.terms, 3000),
      note: str(input.note ?? d.note, 1000),
      signatory: str(input.signatory ?? d.signatory, 100),
      footer: str(input.footer ?? d.footer, 300),
      logo,
    },
  };
};

const orgOf = (req) => String(req.query.organization_id || req.query.org_id || "");

class DocTemplateController {
  async get(req, res) {
    try {
      const orgId = orgOf(req);
      if (!orgId) return res.status(ST_CODES.BAD_REQUEST).json({ message: "organization_id is required" });
      const rows = await DocTemplate.find({ organization_id: orgId }).lean();
      const data = {};
      for (const type of TYPES) {
        const row = rows.find((r) => r.type === type);
        data[type] = { ...DEFAULTS[type], ...(row?.settings || {}), bank: { ...DEFAULTS[type].bank, ...(row?.settings?.bank || {}) } };
      }
      return res.status(ST_CODES.OK).json({ data, defaults: DEFAULTS });
    } catch (error) {
      console.error("doc templates get error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Couldn't load templates" });
    }
  }

  async save(req, res) {
    try {
      const orgId = orgOf(req);
      const { type } = req.params;
      if (!orgId) return res.status(ST_CODES.BAD_REQUEST).json({ message: "organization_id is required" });
      if (!TYPES.includes(type)) return res.status(ST_CODES.BAD_REQUEST).json({ message: "Template type must be invoice or quote" });
      const checked = clean(type, req.body || {});
      if (checked.error) return res.status(ST_CODES.BAD_REQUEST).json({ message: checked.error });
      const row = await DocTemplate.findOneAndUpdate(
        { organization_id: orgId, type },
        { $set: { settings: checked.settings, updated_by: res.locals.user_id } },
        { upsert: true, new: true }
      ).lean();
      return res.status(ST_CODES.OK).json({ message: "Template saved", data: row.settings });
    } catch (error) {
      console.error("doc templates save error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Couldn't save the template" });
    }
  }
}

module.exports = new DocTemplateController();
module.exports.DEFAULTS = DEFAULTS;
