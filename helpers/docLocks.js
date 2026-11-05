// Rule: once a sales or purchase document has been invoiced or converted, it
// can't go back to draft, be reversed, or lose the link to what it became.
// Every status change and delete goes through these checks on the server
// (a 400 with the reason). The frontend mirrors the same predicates in
// src/app/common/docLock.ts so the buttons are disabled with the same reason.
//
// Each check returns the message to send, or null when the change is fine.

const lower = (v) => String(v ?? "").trim().toLowerCase();
const DRAFT_STATUSES = ["draft"];

// ---- Invoices ------------------------------------------------------------
// An invoice is issued once it has left draft: sent, paid, partly paid, or
// with payments recorded. `issued_at` is stamped the first time that happens;
// invoices saved before it existed count as issued when their status says so.
const invoiceIssued = (inv) =>
  Boolean(inv.issued_at) ||
  Number(inv.payment_made || 0) > 0 ||
  (Array.isArray(inv.payments) && inv.payments.length > 0) ||
  !["draft", "void"].includes(lower(inv.status) || "draft");

const invoicePaid = (inv) => Number(inv.payment_made || 0) > 0 || ["paid", "partially paid"].includes(lower(inv.status));

// Stamp to add to an invoice's $set when its status moves away from draft.
const invoiceIssuedStamp = (inv, nextStatus) => {
  if (inv.issued_at || DRAFT_STATUSES.includes(lower(nextStatus)) || lower(nextStatus) === "void") return {};
  return { issued_at: new Date() };
};

// Reason an invoice can't move to `next`, or null.
const invoiceStatusBlock = (inv, next) => {
  const to = lower(next);
  const from = lower(inv.status) || "draft";
  if (!to || to === from || !invoiceIssued(inv)) return null;
  if (to === "draft") {
    return invoicePaid(inv)
      ? "This invoice has payments recorded, so it can't go back to draft."
      : "This invoice has been sent, so it can't go back to draft.";
  }
  if (from === "void") return "This invoice has been voided, so it can't be reopened.";
  return null;
};

// ---- Quotes --------------------------------------------------------------
const quoteConverted = (q) =>
  (q.invoice_ids || []).length > 0 ||
  (q.invoices || []).length > 0 ||
  (q.salesorder_ids || []).length > 0 ||
  (q.salesorders || []).length > 0 ||
  lower(q.status) === "invoiced";

const quoteTarget = (q) =>
  (q.invoice_ids || []).length > 0 || (q.invoices || []).length > 0 || lower(q.status) === "invoiced"
    ? "an invoice"
    : "a sales order";

// Draft is never allowed once converted. A quote converted to an invoice is
// marked "invoiced" and keeps that status; one converted only to a sales order
// can still be marked sent, accepted or declined.
const quoteStatusBlock = (q, next) => {
  const to = lower(next);
  if (!to || to === lower(q.status) || !quoteConverted(q)) return null;
  if (to === "draft") return `This quote is already converted to ${quoteTarget(q)} and can't go back to draft.`;
  if (lower(q.status) === "invoiced" || (q.invoice_ids || []).length > 0 || (q.invoices || []).length > 0) {
    return `This quote is already converted to ${quoteTarget(q)}, so its status can't change.`;
  }
  return null;
};

const quoteDeleteBlock = (q) =>
  quoteConverted(q) ? `This quote is already converted to ${quoteTarget(q)} and can't be deleted.` : null;

// ---- Sales orders --------------------------------------------------------
const salesOrderConverted = (so) =>
  (so.invoice_ids || []).length > 0 || (so.invoices || []).length > 0 || lower(so.invoiced_status) === "invoiced";

// `body` holds the status fields being saved (status, invoiced_status, order_status).
const salesOrderStatusBlock = (so, body = {}) => {
  if (!salesOrderConverted(so)) return null;
  const to = lower(body.status);
  const changing = to && to !== lower(so.status);
  if (changing && ["draft", "void", "not_invoiced"].includes(to)) {
    return to === "draft"
      ? "This sales order is already converted to an invoice and can't go back to draft."
      : `This sales order is already converted to an invoice, so it can't be marked ${to.replace("_", " ")}.`;
  }
  if (body.invoiced_status !== undefined && lower(body.invoiced_status) !== "invoiced" && lower(body.invoiced_status) !== lower(so.invoiced_status)) {
    return "This sales order is already converted to an invoice, so it can't be marked not invoiced.";
  }
  if (body.order_status !== undefined && lower(body.order_status) !== "closed" && lower(body.order_status) !== lower(so.order_status)) {
    return "This sales order is already converted to an invoice, so it can't be reopened.";
  }
  return null;
};

const salesOrderDeleteBlock = (so) =>
  salesOrderConverted(so) ? "This sales order is already converted to an invoice and can't be deleted." : null;

// ---- Delivery challans ---------------------------------------------------
const challanConverted = (c) => (c.invoices || []).length > 0 || lower(c.invoiced_status) === "invoiced";

const challanStatusBlock = (c, body = {}) => {
  if (!challanConverted(c)) return null;
  if (lower(body.status) === "draft" && lower(c.status) !== "draft") {
    return "This delivery challan is already converted to an invoice and can't go back to draft.";
  }
  if (body.invoiced_status !== undefined && lower(body.invoiced_status) !== "invoiced" && lower(body.invoiced_status) !== lower(c.invoiced_status)) {
    return "This delivery challan is already converted to an invoice, so it can't be marked not invoiced.";
  }
  return null;
};

const challanDeleteBlock = (c) =>
  challanConverted(c) ? "This delivery challan is already converted to an invoice and can't be deleted." : null;

// ---- Bills (status: 0 open, 1 draft, 2 void, 3 paid) ---------------------
const BILL_TYPE_CODE = { OPEN: 0, DRAFT: 1, VOID: 2, PAID: 3 };
// `nextType` is OPEN, DRAFT, VOID or PAID.
const billStatusBlock = (bill, nextType) => {
  const cur = Number(bill.status);
  const to = String(nextType || "").toUpperCase();
  if (!to || BILL_TYPE_CODE[to] === cur) return null;
  if (to === "DRAFT" && cur !== BILL_TYPE_CODE.DRAFT) return "This bill has been recorded, so it can't go back to draft.";
  if (cur === BILL_TYPE_CODE.VOID) return "This bill has been voided, so it can't be reopened.";
  if (to === "VOID" && cur === BILL_TYPE_CODE.PAID) return "A paid bill can't be voided.";
  return null;
};

// ---- Purchase orders -----------------------------------------------------
const poBilled = (po) => (po.bills || []).length > 0 || lower(po.billed_status) === "billed";

// `verb` completes "...so it can't be <verb>."
const poStatusBlock = (po, verb) =>
  poBilled(po) ? `This purchase order has been converted to a bill, so it can't be ${verb}.` : null;

const poDeleteBlock = (po) =>
  poBilled(po) ? "This purchase order has been converted to a bill and can't be deleted." : null;

module.exports = {
  invoiceIssued,
  invoiceIssuedStamp,
  invoiceStatusBlock,
  quoteConverted,
  quoteStatusBlock,
  quoteDeleteBlock,
  salesOrderConverted,
  salesOrderStatusBlock,
  salesOrderDeleteBlock,
  challanConverted,
  challanStatusBlock,
  challanDeleteBlock,
  billStatusBlock,
  poBilled,
  poStatusBlock,
  poDeleteBlock,
};
