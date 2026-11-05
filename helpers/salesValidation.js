// Server-side checks for sales documents (quotes, sales orders, invoices,
// recurring invoices) before they are priced and saved. Each check returns a
// message for a 400 response, or null when the document is fine.

const MAX_QTY = 1000000; // 10 lakh units on one line
const MAX_RATE = 100000000; // ₹10 crore per unit
const MAX_DOC_TOTAL = 10000000000; // ₹1,000 crore per document
const MAX_ADJUSTMENT = 100000000;

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

// Rows the form leaves empty (no item picked, no name) are not lines.
const isBlankLine = (l) => !l || (!l.item_id && !String(l.name || l.item_name || "").trim());

const parseLines = (lines) => {
  if (typeof lines === "string") {
    try {
      return JSON.parse(lines);
    } catch {
      return null;
    }
  }
  return lines;
};

const dayOf = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// `label` is what the user calls the document ("invoice", "quote", ...).
// `dueField` is the date that must not be before `date` (due_date, expiry_date...).
const validateSalesDocument = (doc, { label = "document", dueField = "due_date", dueLabel = "Due date", requireCustomer = true } = {}) => {
  if (!doc || typeof doc !== "object") return `The ${label} is empty.`;
  if (requireCustomer && !String(doc.customer_id || "").trim()) return `Select a customer for this ${label}.`;

  const parsed = parseLines(doc.line_items);
  if (!Array.isArray(parsed)) return `The ${label} needs at least one item.`;
  const lines = parsed.filter((l) => !isBlankLine(l));
  if (lines.length === 0) return `Add at least one item to the ${label}.`;

  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const name = String(l.name || l.item_name || `line ${i + 1}`).slice(0, 60);
    const qty = num(l.quantity);
    const rate = num(l.rate ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) return `Quantity for "${name}" must be greater than zero.`;
    if (qty > MAX_QTY) return `Quantity for "${name}" can't be more than ${MAX_QTY.toLocaleString("en-IN")}.`;
    if (!Number.isFinite(rate) || rate < 0) return `Rate for "${name}" can't be negative.`;
    if (rate > MAX_RATE) return `Rate for "${name}" can't be more than ₹${MAX_RATE.toLocaleString("en-IN")}.`;
    const disc = num(l.discount ?? 0);
    if (l.discount !== undefined && l.discount !== "" && (!Number.isFinite(disc) || disc < 0 || disc > 100))
      return `Discount for "${name}" must be between 0 and 100%.`;
    const gst = num(l.gst_rate ?? 0);
    if (l.gst_rate !== undefined && l.gst_rate !== "" && l.gst_rate !== null && (!Number.isFinite(gst) || gst < 0 || gst > 100))
      return `GST rate for "${name}" must be between 0 and 100%.`;
    total += qty * rate;
  }
  if (total > MAX_DOC_TOTAL) return `The ${label} total is too large (more than ₹${MAX_DOC_TOTAL.toLocaleString("en-IN")}).`;

  if (doc.adjustment !== undefined && doc.adjustment !== "" && doc.adjustment !== null) {
    const adj = num(doc.adjustment);
    if (!Number.isFinite(adj) || Math.abs(adj) > MAX_ADJUSTMENT) return "Adjustment must be a number within ±₹10 crore.";
  }

  const start = dayOf(doc.date);
  const due = dayOf(doc[dueField]);
  if (start && due && due < start) return `${dueLabel} can't be before the ${label} date.`;

  // Store only real lines.
  if (Array.isArray(doc.line_items)) doc.line_items = lines;
  return null;
};

module.exports = { validateSalesDocument, isBlankLine, MAX_QTY, MAX_RATE };
