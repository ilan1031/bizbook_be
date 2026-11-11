// One rule set for every input field in BizBooks. Each field is recognised by
// its name (gst_no, email, phone, ...), checked against a format, and, when it
// is wrong, answered with a message that says what the format is and gives an
// example. The browser carries a copy of this file (src/utils/fieldRules.ts);
// keep the two in step.
const STATE_CODES = new Set([...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")), "97", "99"]);
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// The check character GST computes over the first 14 characters of a GSTIN.
const gstinCheckChar = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    if (v < 0) return null;
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
};

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const PAN_ENTITY = "PCHFATBLJG"; // 4th letter: person, company, HUF, firm, AOP, trust, BOI, local authority, juridical person, government
const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const UPI_RE = /^[\w.-]{2,256}@[A-Za-z]{2,64}$/;
const URL_RE = /^(https?:\/\/)?([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(:\d+)?(\/\S*)?$/i;
const MSME_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const VEHICLE_RE = /^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{4}$/;
const PERSON_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const CONTROL_OR_TAG = /[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/;

const msg = (what, format, example) => `${what}. Format: ${format}, for example ${example}.`;

// kind -> { label, normalize?, check(value) -> error message | null }
const KINDS = {
  gstin: {
    label: "GSTIN",
    normalize: (v) => v.replace(/\s+/g, "").toUpperCase(),
    check: (v) => {
      const bad = (why) => msg(`${why}`, "15 characters: 2-digit state code, 10-character PAN, entity number, Z, check letter", "33AAACB2902M1Z0");
      if (v.length !== 15) return bad("A GSTIN has 15 characters");
      if (!GSTIN_RE.test(v)) return bad("This GSTIN isn't in the right format");
      if (!STATE_CODES.has(v.slice(0, 2))) return bad(`${v.slice(0, 2)} is not a valid GST state code`);
      if (!PAN_ENTITY.includes(v[5])) return bad("The PAN inside this GSTIN isn't valid");
      if (gstinCheckChar(v.slice(0, 14)) !== v[14]) return bad("The last character doesn't match, so there's a typing mistake");
      return null;
    },
  },
  pan: {
    label: "PAN",
    normalize: (v) => v.replace(/\s+/g, "").toUpperCase(),
    check: (v) => (PAN_RE.test(v) && PAN_ENTITY.includes(v[3]) ? null : msg("Enter a valid PAN", "5 letters, 4 digits, 1 letter", "ABCPE1234F")),
  },
  tan: { label: "TAN", normalize: (v) => v.replace(/\s+/g, "").toUpperCase(), check: (v) => (TAN_RE.test(v) ? null : msg("Enter a valid TAN", "4 letters, 5 digits, 1 letter", "CHEA12345B")) },
  ifsc: { label: "IFSC code", normalize: (v) => v.replace(/\s+/g, "").toUpperCase(), check: (v) => (IFSC_RE.test(v) ? null : msg("Enter a valid IFSC code", "4 letters, the digit 0, then 6 letters or digits", "HDFC0001234")) },
  account_number: { label: "Account number", normalize: (v) => v.replace(/[\s-]+/g, ""), check: (v) => (/^\d{9,18}$/.test(v) ? null : msg("Enter a valid account number", "9 to 18 digits", "123456789012")) },
  upi: { label: "UPI ID", normalize: (v) => v.trim(), check: (v) => (UPI_RE.test(v) ? null : msg("Enter a valid UPI ID", "name@bank", "shop@okhdfcbank")) },
  email: { label: "Email", normalize: (v) => v.trim(), check: (v) => (v.length <= 254 && EMAIL_RE.test(v) ? null : msg("Enter a valid email address", "name@domain.com", "accounts@example.com")) },
  phone: {
    label: "Phone number",
    normalize: (v) => v.trim(),
    check: (v) => {
      const err = msg("Enter a valid phone number", "7 to 15 digits, optionally starting with + and a country code", "9876543210 or +91 98765 43210");
      if (!/^\+?[\d\s().-]+$/.test(v)) return err;
      const digits = v.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15 ? null : err;
    },
  },
  mobile: {
    label: "Mobile number",
    normalize: (v) => v.trim(),
    check: (v) => {
      const err = msg("Enter a valid 10-digit mobile number", "10 digits starting with 6, 7, 8 or 9 (+91 first is fine)", "9876543210");
      if (!/^\+?[\d\s().-]+$/.test(v)) return err;
      let digits = v.replace(/\D/g, "");
      if (v.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? null : err;
      if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
      if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
      return /^[6-9]\d{9}$/.test(digits) ? null : err;
    },
  },
  pincode: { label: "PIN / postal code", normalize: (v) => v.trim(), check: (v) => (/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(v) ? null : msg("Enter a valid PIN or postal code", "3 to 10 letters or digits (6 digits in India)", "600001")) },
  india_pincode: { label: "PIN code", normalize: (v) => v.trim(), check: (v) => (/^[1-9]\d{5}$/.test(v) ? null : msg("Enter a valid PIN code", "6 digits, not starting with 0", "600001")) },
  hsn: { label: "HSN / SAC code", normalize: (v) => v.replace(/\s+/g, ""), check: (v) => (/^(\d{4}|\d{6}|\d{8})$/.test(v) ? null : msg("Enter a valid HSN or SAC code", "4, 6 or 8 digits", "998314")) },
  url: { label: "Website", normalize: (v) => v.trim(), check: (v) => (v.length <= 300 && URL_RE.test(v) ? null : msg("Enter a valid website address", "www.name.com or https://name.com", "https://example.com")) },
  msme: { label: "Udyam number", normalize: (v) => v.replace(/\s+/g, "").toUpperCase(), check: (v) => (MSME_RE.test(v) ? null : msg("Enter a valid Udyam number", "UDYAM-XX-00-0000000", "UDYAM-TN-02-0012345")) },
  vehicle: { label: "Vehicle number", normalize: (v) => v.trim().toUpperCase(), check: (v) => (VEHICLE_RE.test(v) ? null : msg("Enter a valid vehicle number", "state code, district, series, 4 digits", "TN09AB1234")) },
  person_name: {
    label: "Name",
    normalize: (v) => v.replace(/\s+/g, " ").trim(),
    check: (v) => (v.length <= 60 && PERSON_RE.test(v) ? null : msg("Enter a valid name", "letters, spaces, dots, hyphens and apostrophes only, up to 60 characters", "Priya Sharma")),
  },
  business_name: {
    label: "Name",
    normalize: (v) => v.replace(/\s+/g, " ").trim(),
    check: (v) => (v.length <= 150 && /[\p{L}\p{N}]/u.test(v) && !CONTROL_OR_TAG.test(v) ? null : msg("Enter a valid name", "up to 150 characters with at least one letter or digit, and no < or >", "Sri Lakshmi Traders")),
  },
  place: { label: "Place", normalize: (v) => v.replace(/\s+/g, " ").trim(), check: (v) => (v.length <= 100 && /[\p{L}]/u.test(v) && !CONTROL_OR_TAG.test(v) ? null : msg("Enter a valid place name", "letters, up to 100 characters", "Chennai")) },
  address: { label: "Address", normalize: (v) => v.trim(), check: (v) => (v.length <= 250 && !CONTROL_OR_TAG.test(v) ? null : msg("Enter a valid address", "up to 250 characters, no < or >", "12, Anna Salai")) },
  code: { label: "Reference", normalize: (v) => v.trim(), check: (v) => (v.length <= 100 && !CONTROL_OR_TAG.test(v) ? null : msg("Enter a valid reference", "up to 100 characters, no < or >", "INV-000123")) },
  text: { label: "Text", normalize: (v) => v, check: (v) => (v.length <= 5000 && !CONTROL.test(v.replace(/[\r\n\t]/g, "")) ? null : msg("This text is too long or has characters that aren't allowed", "up to 5000 characters", "Payment due within 15 days")) },
  amount: { label: "Amount", normalize: (v) => v, check: (v) => numeric(v, { min: 0, max: 1e11, decimals: 2, what: "amount", example: "1250.50" }) },
  quantity: { label: "Quantity", normalize: (v) => v, check: (v) => numeric(v, { min: 0, max: 1e9, decimals: 4, what: "quantity", example: "12.5" }) },
  percent: { label: "Percentage", normalize: (v) => v, check: (v) => numeric(v, { min: 0, max: 100, decimals: 4, what: "percentage", example: "18" }) },
  date: { label: "Date", normalize: (v) => v, check: (v) => (validDate(v) ? null : msg("Enter a valid date", "DD-MM-YYYY or YYYY-MM-DD, a real calendar date", "25-12-2026")) },
};

// A number in plain digits (an Indian-style thousands comma is tolerated).
function numeric(v, { min, max, decimals, what, example }) {
  const s = String(v).trim().replace(/^₹\s*/, "").replace(/,/g, "");
  const err = msg(`Enter a valid ${what}`, `a number from ${min} to ${max.toLocaleString("en-IN")}${decimals ? ` with up to ${decimals} decimal places` : ""}`, example);
  if (s === "" || !/^-?\d*\.?\d+$/.test(s)) return err;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max) return err;
  const frac = (s.split(".")[1] || "").length;
  return frac > decimals ? err : null;
}

function validDate(v) {
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  let y, mo, d;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return !Number.isNaN(Date.parse(s)) && /[A-Za-z]/.test(s); // "02 Nov 2026"
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && y <= 2200 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Field names (the last part of a path like billing_address.zip), lower-cased
// with underscores and dashes removed, mapped to a kind.
const squash = (n) => String(n).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
const NAMES = {
  gstin: ["gstno", "gstin", "gstin", "gstnumber", "vendorgstno", "customergstno", "gstinuin"],
  pan: ["panno", "pan", "pannumber"],
  tan: ["tanno", "tan", "tannumber"],
  ifsc: ["ifsc", "ifsccode"],
  account_number: ["accountnumber", "bankaccountnumber", "accountno", "bankaccountno"],
  upi: ["upiid", "upi"],
  email: ["email", "organizationemail", "contactemail", "billingemail", "primaryemail", "emailaddress", "orgemail", "submittedbyemail"],
  phone: ["phone", "workphone", "telephone", "landline", "faxnumber", "fax"],
  mobile: ["mobile", "phonenumber", "mobilenumber", "mobileno", "cellphone"],
  pincode: ["zip", "zipcode", "pincode", "pin", "postalcode", "postcode"],
  hsn: ["hsncode", "hsnorsac", "hsn", "sac", "sacode", "hsnsac"],
  url: ["website", "websiteurl", "url"],
  msme: ["msmenumber", "udyamnumber"],
  vehicle: ["vehiclenumber", "vehicleno"],
  person_name: ["firstname", "lastname", "middlename", "employeename", "contactpersonname"],
  business_name: ["contactname", "customername", "vendorname", "companyname", "orgname", "organizationname", "legalname", "tradername", "businesslegalname", "businesstradename", "displayname", "portalname", "tradename", "accountname", "profilename", "recurrencename", "projectname", "name", "itemname", "taxname"],
  place: ["city", "state", "country", "placeofsupply", "placeofcontact", "sourceofsupply", "destinationofsupply", "district"],
  address: ["address", "street", "street1", "street2", "firststreet", "secondstreet", "addressline1", "addressline2", "addressname", "attention", "landmark"],
  code: ["invoicenumber", "billnumber", "ordernumber", "salesordernumber", "purchasenumber", "paymentnumber", "referencenumber", "challannumber", "sku", "accountcode", "creditnumber", "estimatenumber", "quotenumber", "unit", "designation", "department"],
  text: ["description", "notes", "terms", "subject", "subjectcontent", "remarks", "customernotes", "termsandconditions", "salesdescription", "purchasedescription", "descriptionofsupply", "message", "comment", "reason"],
  amount: ["amount", "totamount", "sellingprice", "costprice", "bankcharges", "openingbalanceamount", "amountwithheld", "openingstockrate", "purchaserate", "salesrate"],
  quantity: ["quantity", "openingstock", "reorderlevel", "reorderquantity", "distance"],
  percent: ["discountpercent", "markuppercent", "gstrate", "igstrate", "commission"],
  date: ["date", "duedate", "startdate", "enddate", "billdate", "deliverydate", "shipmentdate", "paymentdate", "expirydate", "expectedshipmentdate", "purchasedate", "invoicedate", "asof", "maturitydate", "targetdate", "mfgdate", "expirydate", "receivedon", "ason", "lockeduntil"],
};
const BY_NAME = new Map();
for (const [kind, names] of Object.entries(NAMES)) for (const n of names) if (!BY_NAME.has(n)) BY_NAME.set(n, kind);

// Fields whose numbers are legitimately negative, free-form, or checked elsewhere.
const SKIP = new Set(["adjustment", "rate", "total", "balance", "tdsamount"]);

const kindForName = (name) => {
  const last = String(name).split(".").pop().replace(/\[\d*\]/g, "");
  const key = squash(last);
  if (SKIP.has(key)) return null;
  return BY_NAME.get(key) || null;
};

// Cleans a value of this kind (e.g. upper-cases a GSTIN). Non-strings are left alone.
const normalize = (kind, value) => (typeof value === "string" && KINDS[kind] ? KINDS[kind].normalize(value) : value);

// null when the value is fine (or empty: required-ness is each form's business),
// otherwise the message to show.
const validate = (kind, value, { country } = {}) => {
  const rule = KINDS[kind];
  if (!rule || value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (raw.trim() === "") return null;
  let k = kind;
  if (kind === "pincode" && /^(india|in)$/i.test(String(country || "").trim())) k = "india_pincode";
  const clean = normalize(k, raw);
  return KINDS[k].check(clean);
};

module.exports = { KINDS, NAMES, kindForName, normalize, validate, gstinCheckChar, validDate, STATE_CODES };
