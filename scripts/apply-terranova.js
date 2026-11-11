// Gives the Terranova Finishes account its logo, business details and invoice /
// quote template (taken from Terranova_Tax_Invoice.docx), and nobody else's.
//
//   DB_Coll="<mongodb connection string>" node scripts/apply-terranova.js            (shows what would change)
//   DB_Coll="<mongodb connection string>" node scripts/apply-terranova.js --apply    (makes the change)
//   add  --email someone@example.com  to use a different account
//
// It only touches organisations owned by the account with that email. The logo
// is always set; business details and template text are only filled in where
// they are still empty, so nothing the owner typed is overwritten. The GSTIN
// and PAN are left alone: the sample numbers in the Word file are not real, so
// the owner enters theirs under Organisation details.
const fs = require("fs");
const path = require("path");

const DEFAULT_EMAIL = "create@terranovafinishes.com";
const LOGO_FILE = path.join(__dirname, "assets", "terranova-logo.png");

const ORG_DETAILS = {
  tagline: "Microconcrete & Decorative Surface Finishes · Manufacturer & Distributor",
  first_street: "491, 7th Street Extension",
  second_street: "Gandhipuram",
  city: "Coimbatore",
  zip: "641012",
  state: "Tamil Nadu",
  country: "India",
  phone: "+91 91596 40239",
  email: "create@terranovafinishes.com",
  website: "www.terranovafinishes.com",
};

const TERMS = [
  "1. Payment due within 15 days of invoice date; interest @ 18% p.a. on overdue amounts.",
  "2. Slight shade variation between batches is natural to microconcrete. Order the full project quantity from one batch.",
  "3. Store bags sealed in a dry place. Shelf life is 12 months from the manufacturing date.",
  "4. Performance warranty is valid only when applied as per the Terranova Technical Data Sheet.",
  "5. Goods once sold will not be taken back. Subject to Coimbatore jurisdiction.",
].join("\n");

const TEMPLATE = {
  style: "detailed",
  accent: "#2b2b2b",
  subtitle: "ORIGINAL FOR RECIPIENT",
  signatory: "T. Vijay Thirumalairajan",
  terms: TERMS,
  declaration: "We declare that this invoice shows the actual price of the goods / services described and that all particulars are true and correct.",
  footer: "This is a computer-generated invoice.  ·  Thank you for your business.",
  bank: { account_name: "Terranova Finishes", branch: "Gandhipuram, Coimbatore" },
};

const blank = (v) => v === undefined || v === null || String(v).trim() === "";

const logoDataUrl = () => `data:image/png;base64,${fs.readFileSync(LOGO_FILE).toString("base64")}`;

// db: a mongoose connection (or the mongoose module). Returns a report of what was (or would be) changed.
const applyTerranova = async ({ db, email = DEFAULT_EMAIL, apply = false }) => {
  const users = db.collection("users");
  const orgs = db.collection("organizations");
  const templates = db.collection("doc_templates");
  const user = await users.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  if (!user) return { found: false, email, organisations: [] };
  const owned = await orgs.find({ admin_id: user._id }).toArray();
  const report = { found: true, email, apply, organisations: [] };
  const logo = logoDataUrl();
  for (const org of owned) {
    const set = { logo };
    const filled = [];
    for (const [key, value] of Object.entries(ORG_DETAILS)) {
      if (blank(org[key])) {
        set[key] = value;
        filled.push(key);
      }
    }
    const row = { organization_id: org.organization_id, org_name: org.org_name, logo: "set", filled_details: filled, templates: [] };
    if (apply) await orgs.updateOne({ _id: org._id }, { $set: set });
    for (const type of ["invoice", "quote"]) {
      const existing = await templates.findOne({ organization_id: String(org.organization_id), type });
      const saved = existing?.settings || {};
      const next = { ...saved };
      const added = [];
      for (const [key, value] of Object.entries(TEMPLATE)) {
        if (key === "bank") {
          const bank = { ...(saved.bank || {}) };
          for (const [k, v] of Object.entries(value)) if (blank(bank[k])) { bank[k] = v; added.push(`bank.${k}`); }
          next.bank = bank;
        } else if (blank(saved[key])) {
          // A quote keeps its own wording for the parts that say "invoice".
          if (type === "quote" && (key === "footer" || key === "declaration" || key === "subtitle")) continue;
          next[key] = value;
          added.push(key);
        }
      }
      if (type === "quote" && blank(saved.terms)) next.terms = "1. This quotation is valid for 15 days from the date of issue.\n" + TERMS.split("\n").slice(1).join("\n");
      row.templates.push({ type, filled: added });
      if (apply && added.length) {
        await templates.updateOne({ organization_id: String(org.organization_id), type }, { $set: { settings: next, updated_by: user._id }, $setOnInsert: { organization_id: String(org.organization_id), type } }, { upsert: true });
      }
    }
    report.organisations.push(row);
  }
  return report;
};

module.exports = { applyTerranova, ORG_DETAILS, TEMPLATE, DEFAULT_EMAIL };

if (require.main === module) {
  const mongoose = require("mongoose");
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const at = args.indexOf("--email");
  const email = at >= 0 ? args[at + 1] : DEFAULT_EMAIL;
  const url = process.env.DB_Coll || process.env.MONGO_URL;
  if (!url) {
    console.error('Set DB_Coll to the MongoDB connection string first, e.g. DB_Coll="mongodb+srv://..." node scripts/apply-terranova.js');
    process.exit(1);
  }
  mongoose
    .connect(url)
    .then(async () => {
      const report = await applyTerranova({ db: mongoose.connection, email, apply });
      if (!report.found) console.log(`No account with the email ${email} in this database. Nothing changed.`);
      else {
        console.log(`${apply ? "APPLIED" : "DRY RUN (nothing written; add --apply to make the change)"} for ${email}`);
        for (const o of report.organisations) {
          console.log(`- ${o.org_name} (#${o.organization_id}): logo set; details filled: ${o.filled_details.join(", ") || "none (already filled)"}`);
          for (const t of o.templates) console.log(`    ${t.type} template filled: ${t.filled.join(", ") || "none (already filled)"}`);
        }
        if (!report.organisations.length) console.log("This account owns no organisation yet.");
        console.log("Enter the GSTIN and PAN under Organisation details; the sample numbers in the Word file are not real.");
      }
      await mongoose.disconnect();
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
