// Money maths for purchase documents (expenses and bills).
//
// The server works out every total itself, in integer paise, instead of
// trusting the totals the screen sends, so the saved document and its
// journal always agree and every journal balances.
//
// GST on a purchase is input tax credit. Within one state it is split into
// CGST + SGST; between states it is IGST. TDS withheld from a vendor is a
// liability (TDS Payable) and reduces what the vendor is owed; TCS charged
// by a vendor is an asset (TCS Receivable) and adds to it.
const { stateCode } = require("./gstHelper");

// Anything that isn't a number ("", "-", "abc") counts as zero.
const toPaise = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const fromPaise = (p) => Math.round(p) / 100;
const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ACCOUNTS = {
  igst: ["AC_011", "Input IGST"],
  cgst: ["AC_012", "Input CGST"],
  sgst: ["AC_013", "Input SGST"],
  itc: ["AC_010", "Input Tax Credits"],
  tdsPayable: ["AC_022", "TDS Payable"],
  tcsReceivable: ["AC_009", "TCS Receivable"],
  payable: ["AC_032", "Accounts Payable"],
  discount: ["AC_075", "Purchase Discounts"],
  otherExpense: ["AC_065", "Other Expenses"],
  cogs: ["AC_078", "Cost of Goods Sold"],
  inventory: ["AC_084", "Inventory Asset"],
  travel: ["AC_051", "Travel Expense"],
};

const journalLine = ([id, name], side, paise) => ({
  coa_account_id: id,
  coa_account_name: name,
  creditOrDebit: side,
  amount: fromPaise(paise),
  amount_formatted: money(fromPaise(paise)),
});

// A client error: the controller answers 400 with this message.
class PurchaseInputError extends Error {}

// Empty strings in reference fields (e.g. an optional vendor or customer the
// form left blank) can't be cast to an ObjectId; store them as null.
const blankRefsToNull = (data, fields) => {
  for (const f of fields) {
    if (data[f] === "" || data[f] === "null" || data[f] === "undefined") data[f] = null;
  }
  return data;
};

// "IGST18 [18%]", "GST18 [18%]", "18" -> 18
const parseTaxPercent = (label) => {
  if (label === undefined || label === null || label === "") return 0;
  const m = /\[(\d+(?:\.\d+)?)%\]/.exec(String(label)) || /(\d+(?:\.\d+)?)/.exec(String(label));
  return m ? Number(m[1]) : 0;
};

// Whether a purchase crosses a state border. Known states decide it; when
// one is unknown, an "IGST..." tax label means inter-state.
const isInterState = (fromState, toState, taxLabel = "") => {
  const a = stateCode(fromState);
  const b = stateCode(toState);
  if (a && b) return a !== b;
  return /^\s*IGST/i.test(String(taxLabel || ""));
};

// Splits GST paise into CGST + SGST (intra-state) or IGST (inter-state).
const splitGst = (gstPaise, inter) => {
  if (inter) return { cgst: 0, sgst: 0, igst: gstPaise };
  const cgst = Math.floor(gstPaise / 2);
  return { cgst, sgst: gstPaise - cgst, igst: 0 };
};

const NO_GST_TREATMENTS = ["Registered Business - Composition", "Non-GST Supply", "Out Of Scope"];

// Expense / mileage: recomputes tot_amount, base_amount, expense_tax_amount
// and tot_amount_with_tax in place and returns the balanced journal lines.
// Throws PurchaseInputError for input that can't be saved.
const priceExpense = (bData) => {
  const isExpense = bData.type !== "mileage";
  if (!bData.paid_through_account_id) {
    throw new PurchaseInputError("Choose the account the expense was paid through.");
  }
  if (!isExpense) {
    const totalP = toPaise(bData.tot_amount);
    if (!(totalP > 0)) throw new PurchaseInputError("Enter a mileage amount greater than zero.");
    bData.tot_amount = fromPaise(totalP);
    bData.tot_amount_with_tax = fromPaise(totalP);
    return [
      journalLine([bData.paid_through_account_id, bData.paid_through_account_name], "Credit", totalP),
      journalLine(ACCOUNTS.travel, "Debit", totalP),
    ];
  }

  const lines = Array.isArray(bData.lineItems) ? bData.lineItems : [];
  if (!lines.length) throw new PurchaseInputError("Add at least one expense line.");
  const linePaise = lines.map((l) => toPaise(l.amount));
  if (lines.some((l) => !l.account_id)) throw new PurchaseInputError("Choose an expense account for every line.");
  if (linePaise.some((p) => !(p > 0))) throw new PurchaseInputError("Enter an expense amount greater than zero.");
  lines.forEach((l, i) => (l.amount = fromPaise(linePaise[i])));
  const enteredP = linePaise.reduce((s, p) => s + p, 0);

  const percent = NO_GST_TREATMENTS.includes(bData.gst_treatment) ? 0 : parseTaxPercent(bData.expense_tax_percent);
  if (percent < 0 || percent > 100) throw new PurchaseInputError("Choose a valid tax rate.");
  const inclusive = bData.inclusive_exclusive === "inclusive";
  let taxP;
  let baseP;
  if (inclusive) {
    baseP = Math.round(enteredP / (1 + percent / 100));
    taxP = enteredP - baseP;
  } else {
    baseP = enteredP;
    taxP = Math.round((enteredP * percent) / 100);
  }
  const totalP = baseP + taxP;
  bData.tot_amount = fromPaise(enteredP);
  bData.base_amount = fromPaise(baseP);
  bData.expense_tax_amount = fromPaise(taxP);
  bData.tot_amount_with_tax = fromPaise(totalP);

  const out = [journalLine([bData.paid_through_account_id, bData.paid_through_account_name], "Credit", totalP)];
  // Each line's share of the pre-tax amount (inclusive lines carry their tax).
  let left = baseP;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? left : Math.round((linePaise[i] * baseP) / enteredP);
    left -= share;
    if (share > 0) out.push(journalLine([l.account_id, l.account_name], "Debit", share));
  });
  if (taxP > 0) {
    const { cgst, sgst, igst } = splitGst(taxP, isInterState(bData.source_of_supply, bData.destination_of_supply, bData.expense_tax_percent));
    if (cgst) out.push(journalLine(ACCOUNTS.cgst, "Debit", cgst));
    if (sgst) out.push(journalLine(ACCOUNTS.sgst, "Debit", sgst));
    if (igst) out.push(journalLine(ACCOUNTS.igst, "Debit", igst));
  }
  return out;
};

const isBlank = (v) => v === undefined || v === null || v === "";

// Bill (and purchase order) pricing. Recomputes each line's amount and GST,
// the sub total, discount, GST totals, TDS/TCS and the total in place.
// `vendorState` is where the vendor supplies from, `orgState` where the
// organisation is. Returns the totals in paise for the journal.
const priceBill = (b, { vendorState, orgState } = {}) => {
  const items = Array.isArray(b.items) ? b.items : [];
  const amounts = items.map((it) => {
    const q = Number(it.quantity);
    const r = Number(it.rate);
    if ((!isBlank(it.quantity) && q < 0) || (!isBlank(it.rate) && r < 0) || toPaise(it.amount) < 0) {
      throw new PurchaseInputError("Quantity, rate and amount can't be negative.");
    }
    if (!isBlank(it.quantity) && !isBlank(it.rate) && Number.isFinite(q) && Number.isFinite(r)) return toPaise(q * r);
    return toPaise(it.amount);
  });
  let subP = amounts.reduce((s, p) => s + p, 0);
  if (!items.length) subP = toPaise(b.sub_total ?? b.total);
  if (subP < 0) throw new PurchaseInputError("The bill total can't be negative.");

  const pct = Number(b.discount_percent || 0);
  let discP = b.discount_type !== "amount" && pct > 0 ? Math.round((subP * pct) / 100) : toPaise(b.discount_amount);
  if (discP < 0 || discP > subP) throw new PurchaseInputError("The discount must be between zero and the sub total.");

  const inter = isInterState(vendorState || b.source_of_supply, orgState || b.destination_of_supply);
  let gstP = 0;
  let left = discP;
  items.forEach((it, i) => {
    // Each line's share of the discount, so GST is charged on what's paid.
    const share = i === items.length - 1 ? left : subP ? Math.round((amounts[i] * discP) / subP) : 0;
    left -= share;
    const rate = Number(it.gst_rate || 0);
    if (rate < 0 || rate > 100) throw new PurchaseInputError("Choose a valid GST rate.");
    const lineGst = Math.round(((amounts[i] - share) * rate) / 100);
    gstP += lineGst;
    it.amount = String(fromPaise(amounts[i]));
    it.gst_rate = rate;
    it.gst_amount = fromPaise(lineGst);
  });
  const { cgst, sgst, igst } = splitGst(gstP, inter);

  const taxType = b.tax_type || b.tdsOrTcs || "";
  const taxPct = Number(b.tax_percentage || 0);
  if (taxPct < 0 || taxPct > 100) throw new PurchaseInputError("Choose a valid TDS/TCS rate.");
  // TDS and TCS are worked out on the value before GST.
  const taxP = Math.round(((subP - discP) * taxPct) / 100);
  const adjP = toPaise(b.adjustment);
  const adds = taxType === "TCS" || taxType === "GST";
  const totalP = subP - discP + gstP + (adds ? taxP : -taxP) + adjP;
  if (totalP < 0) throw new PurchaseInputError("The bill total can't be negative.");

  Object.assign(b, {
    tax_type: taxType || "TDS",
    sub_total: fromPaise(subP),
    subtotal: fromPaise(subP),
    discount_amount: fromPaise(discP),
    tax_amount: fromPaise(taxP),
    taxAmount: fromPaise(taxP),
    supply_type: inter ? "inter" : "intra",
    gst_total: fromPaise(gstP),
    cgst_total: fromPaise(cgst),
    sgst_total: fromPaise(sgst),
    igst_total: fromPaise(igst),
    adjustment: fromPaise(adjP),
    total: fromPaise(totalP),
    total_formatted: money(fromPaise(totalP)),
  });
  return { subP, discP, cgst, sgst, igst, taxP, taxType, adjP, totalP, amounts };
};

// Journal lines for a bill priced by priceBill: each item debits its
// account, input GST is debited, TDS is owed (credit), TCS is receivable
// (debit), and the total is credited to Accounts Payable.
// trackedIds (optional): item codes of goods that track inventory. Their lines
// debit Inventory Asset instead of the item's expense account.
const billJournalLines = (b, priced, trackedIds) => {
  const p = priced || priceBill(b);
  const items = Array.isArray(b.items) ? b.items : [];
  const out = [];
  if (items.length) {
    items.forEach((it, i) => {
      if (p.amounts[i] > 0) {
        const stock = trackedIds && trackedIds.has(String(it.item_id || ""));
        const account = stock ? ACCOUNTS.inventory : [it.account_id || ACCOUNTS.cogs[0], it.account_name || ACCOUNTS.cogs[1]];
        out.push(journalLine(account, "Debit", p.amounts[i]));
      }
    });
  } else if (p.subP > 0) {
    out.push(journalLine(ACCOUNTS.cogs, "Debit", p.subP));
  }
  if (p.cgst) out.push(journalLine(ACCOUNTS.cgst, "Debit", p.cgst));
  if (p.sgst) out.push(journalLine(ACCOUNTS.sgst, "Debit", p.sgst));
  if (p.igst) out.push(journalLine(ACCOUNTS.igst, "Debit", p.igst));
  if (p.taxP > 0) {
    if (p.taxType === "TCS") out.push(journalLine(ACCOUNTS.tcsReceivable, "Debit", p.taxP));
    else if (p.taxType === "GST") out.push(journalLine(ACCOUNTS.itc, "Debit", p.taxP));
    else out.push(journalLine(ACCOUNTS.tdsPayable, "Credit", p.taxP));
  }
  if (p.discP > 0) out.push(journalLine(ACCOUNTS.discount, "Credit", p.discP));
  if (p.adjP) out.push(journalLine(ACCOUNTS.otherExpense, p.adjP > 0 ? "Debit" : "Credit", Math.abs(p.adjP)));
  out.push(journalLine(ACCOUNTS.payable, "Credit", p.totalP));
  return out;
};

module.exports = {
  PurchaseInputError,
  blankRefsToNull,
  parseTaxPercent,
  isInterState,
  priceExpense,
  priceBill,
  billJournalLines,
  toPaise,
  fromPaise,
  money,
};
