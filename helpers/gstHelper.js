// GST for sales documents (quotes, sales orders, invoices, recurring
// invoices, delivery challans).
//
// Each line carries a GST rate. Within the seller's own state the tax is
// split equally into CGST + SGST; to another state (or a union territory
// other than the seller's) it is IGST. Exports (overseas customers) and
// supplies to SEZ units are zero-rated here. TDS / TCS stay document-level
// and are worked out on the value before GST, as before.
//
// priceSalesDocument() recomputes every money field from the lines, so the
// stored totals and the journal built from them always agree. Amounts are
// summed in paise.
const mongoose = require("mongoose");

// GST state codes.
const STATES = [
  ["01", "JK", "Jammu and Kashmir"], ["02", "HP", "Himachal Pradesh"], ["03", "PB", "Punjab"],
  ["04", "CH", "Chandigarh"], ["05", "UK", "Uttarakhand"], ["06", "HR", "Haryana"],
  ["07", "DL", "Delhi"], ["08", "RJ", "Rajasthan"], ["09", "UP", "Uttar Pradesh"],
  ["10", "BR", "Bihar"], ["11", "SK", "Sikkim"], ["12", "AR", "Arunachal Pradesh"],
  ["13", "NL", "Nagaland"], ["14", "MN", "Manipur"], ["15", "MZ", "Mizoram"],
  ["16", "TR", "Tripura"], ["17", "ML", "Meghalaya"], ["18", "AS", "Assam"],
  ["19", "WB", "West Bengal"], ["20", "JH", "Jharkhand"], ["21", "OD", "Odisha"],
  ["22", "CG", "Chhattisgarh"], ["23", "MP", "Madhya Pradesh"], ["24", "GJ", "Gujarat"],
  ["26", "DN", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "MH", "Maharashtra"],
  ["29", "KA", "Karnataka"], ["30", "GA", "Goa"], ["31", "LD", "Lakshadweep"],
  ["32", "KL", "Kerala"], ["33", "TN", "Tamil Nadu"], ["34", "PY", "Puducherry"],
  ["35", "AN", "Andaman and Nicobar Islands"], ["36", "TS", "Telangana"],
  ["37", "AP", "Andhra Pradesh"], ["38", "LA", "Ladakh"], ["97", "OT", "Other Territory"],
];
const norm = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const BY_KEY = new Map();
for (const [code, short, name] of STATES) {
  for (const k of [code, short, name]) BY_KEY.set(norm(k), code);
}
// Common alternative spellings.
for (const [alias, code] of [
  ["tamilnadu", "33"], ["orissa", "21"], ["uttaranchal", "05"], ["pondicherry", "34"],
  ["delhinct", "07"], ["nctofdelhi", "07"], ["newdelhi", "07"], ["telengana", "36"],
  ["damananddiu", "26"], ["dadraandnagarhaveli", "26"], ["andamanandnicobar", "35"],
  ["chattisgarh", "22"], ["ts", "36"], ["tg", "36"], ["od", "21"], ["or", "21"], ["ct", "22"],
]) {
  BY_KEY.set(alias, code);
}

// GST state code ("33") for a name, short code, "[TN] - Tamil Nadu",
// numeric code or GSTIN; null when it can't be recognised.
const stateCode = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{2}[A-Z0-9]{13}$/i.test(raw)) return raw.slice(0, 2); // GSTIN
  const bracket = /^\[([A-Za-z]{2})\]/.exec(raw);
  if (bracket && BY_KEY.has(norm(bracket[1]))) return BY_KEY.get(norm(bracket[1]));
  const dash = raw.split(" - ").pop();
  return BY_KEY.get(norm(raw)) || BY_KEY.get(norm(dash)) || null;
};

const ZERO_RATED = /overseas|special economic zone|\bsez\b/i;

const toPaise = (v) => Math.round(Number(v || 0) * 100);
const fromPaise = (p) => Math.round(p) / 100;
const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Schema fields, spread into each sales model.
const GST_LINE_FIELDS = {
  gst_rate: { type: Number, default: 0 },
  taxable_amount: { type: Number, default: 0 },
  gst_amount: { type: Number, default: 0 },
  cgst_amount: { type: Number, default: 0 },
  sgst_amount: { type: Number, default: 0 },
  igst_amount: { type: Number, default: 0 },
};
const GST_DOC_FIELDS = {
  supply_type: { type: String, default: "" }, // "intra" | "inter" | "zero_rated"
  gst_total: { type: Number, default: 0 },
  cgst_total: { type: Number, default: 0 },
  sgst_total: { type: Number, default: 0 },
  igst_total: { type: Number, default: 0 },
};

// Seller state and the customer's place of supply / GST treatment, from the
// document first, then the customer's record.
const loadTaxContext = async (organization_id, doc) => {
  const Org = mongoose.model("Organization");
  const Contact = mongoose.model("Contact");
  const org = await Org.findOne({ organization_id: { $in: [String(organization_id), Number(organization_id)] } }, { state: 1, gst_in: 1 }).lean();
  let contact = null;
  if (doc.customer_id && (!doc.place_of_supply || !doc.gst_treatment)) {
    contact = await Contact.findOne(
      { organization_id: String(organization_id), contact_id: doc.customer_id },
      { place_of_contact: 1, gst_treatment: 1 }
    ).lean();
  }
  return {
    sellerState: stateCode(org?.gst_in) || stateCode(org?.state),
    placeOfSupply: doc.place_of_supply || contact?.place_of_contact || "",
    gstTreatment: doc.gst_treatment || contact?.gst_treatment || "",
  };
};

// Recomputes line amounts, discount, GST, TDS/TCS and the total in place.
// Returns the document.
const priceSalesDocument = (doc, { sellerState, placeOfSupply, gstTreatment } = {}) => {
  const lines = Array.isArray(doc.line_items) ? doc.line_items : [];
  const zeroRated = ZERO_RATED.test(String(gstTreatment || ""));
  const buyerState = stateCode(placeOfSupply);
  // Unknown place of supply is treated as within the seller's state.
  const inter = !zeroRated && Boolean(sellerState && buyerState && sellerState !== buyerState);

  // Line values after line discounts.
  const amounts = lines.map((l) => {
    const qty = Number(l.quantity || 0);
    const rate = Number(l.rate || 0);
    const disc = Math.min(Math.max(Number(l.discount || 0), 0), 100);
    return Math.round(qty * toPaise(rate) * (1 - disc / 100));
  });
  const subTotal = amounts.reduce((s, a) => s + a, 0);

  // Document discount: a percentage when given, else a flat amount.
  const pct = Number(doc.discount_percent || 0);
  let discount = pct > 0 ? Math.round((subTotal * Math.min(pct, 100)) / 100) : toPaise(doc.discount_amount);
  discount = Math.min(Math.max(discount, 0), subTotal);

  // Spread the discount over the lines so GST is charged on what's billed.
  let discountLeft = discount;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  lines.forEach((line, i) => {
    const share = i === lines.length - 1 ? discountLeft : subTotal ? Math.round((discount * amounts[i]) / subTotal) : 0;
    discountLeft -= share;
    const taxable = amounts[i] - share;
    let rate = Number(line.gst_rate ?? 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) rate = 0;
    if (zeroRated) rate = 0;
    const gst = Math.round((taxable * rate) / 100);
    const lc = inter ? 0 : Math.floor(gst / 2);
    const ls = inter ? 0 : gst - lc;
    const li = inter ? gst : 0;
    cgst += lc;
    sgst += ls;
    igst += li;
    Object.assign(line, {
      item_total: fromPaise(amounts[i]),
      item_total_formatted: money(fromPaise(amounts[i])),
      amount: fromPaise(amounts[i]),
      gst_rate: rate,
      taxable_amount: fromPaise(taxable),
      gst_amount: fromPaise(gst),
      cgst_amount: fromPaise(lc),
      sgst_amount: fromPaise(ls),
      igst_amount: fromPaise(li),
    });
  });
  const gstTotal = cgst + sgst + igst;

  // TDS (customer withholds) / TCS (we collect) on the value before GST.
  const afterDiscount = subTotal - discount;
  const withholdingRate = Number(doc.tax_percentage || 0);
  const withholding = Math.round((afterDiscount * (Number.isFinite(withholdingRate) ? withholdingRate : 0)) / 100);
  const isTcs = doc.tax_type === "TCS";
  const adjustment = toPaise(doc.adjustment);
  const shipping = toPaise(doc.shipping_charge);
  const total = afterDiscount + gstTotal + (isTcs ? withholding : -withholding) + adjustment + shipping;

  Object.assign(doc, {
    sub_total: fromPaise(subTotal),
    sub_total_formatted: money(fromPaise(subTotal)),
    bcy_sub_total: fromPaise(subTotal),
    discount_amount: fromPaise(discount),
    discount_amount_formatted: money(fromPaise(discount)),
    discount_total: fromPaise(discount),
    discount_total_formatted: money(fromPaise(discount)),
    sub_total_exclusive_of_discount: fromPaise(afterDiscount),
    tax_total: fromPaise(withholding),
    tax_total_formatted: money(fromPaise(withholding)),
    bcy_tax_total: fromPaise(withholding),
    supply_type: zeroRated ? "zero_rated" : inter ? "inter" : "intra",
    gst_total: fromPaise(gstTotal),
    cgst_total: fromPaise(cgst),
    sgst_total: fromPaise(sgst),
    igst_total: fromPaise(igst),
    total: fromPaise(total),
    total_formatted: money(fromPaise(total)),
    bcy_total: fromPaise(total),
  });
  return doc;
};

// Journal lines for an invoice built by priceSalesDocument: sales (and
// shipping/adjustment) and output GST are credited, the receivable is
// debited, discount and TDS are debits, TCS is owed.
const invoiceJournalLines = (inv) => {
  const out = [];
  const add = (id, name, side, amount) => {
    if (toPaise(amount) > 0) out.push({ coa_account_id: id, coa_account_name: name, creditOrDebit: side, amount: fromPaise(toPaise(amount)), amount_formatted: money(amount) });
  };
  const n = (v) => Number(v || 0);
  add("AC_046", "Sales", "Credit", n(inv.sub_total));
  add("AC_029", "Output CGST", "Credit", n(inv.cgst_total));
  add("AC_030", "Output SGST", "Credit", n(inv.sgst_total));
  add("AC_028", "Output IGST", "Credit", n(inv.igst_total));
  if (inv.tax_type === "TCS") add("AC_025", "TCS Payable", "Credit", n(inv.tax_total));
  else add("AC_006", "TDS Receivable", "Debit", n(inv.tax_total));
  add("AC_050", "Discount", "Debit", n(inv.discount_amount));
  add("AC_045", "Shipping Charge", "Credit", n(inv.shipping_charge));
  const adj = n(inv.adjustment);
  if (adj) add("AC_044", "Other Charges", adj > 0 ? "Credit" : "Debit", Math.abs(adj));
  add("AC_019", "Accounts Receivable", "Debit", n(inv.total));
  return out;
};

module.exports = {
  STATES,
  stateCode,
  GST_LINE_FIELDS,
  GST_DOC_FIELDS,
  loadTaxContext,
  priceSalesDocument,
  invoiceJournalLines,
};
