// Inventory rules for sales and purchase documents.
// RULE 1: items are optional on every document type. A free-text line (name,
// quantity, rate, tax, no inventory item) saves and moves no stock. A tracked
// item line moves stock (sales out, purchases in, credit notes in, vendor
// credits out) and books its cost once, on save and on every re-save.
// RULE 2: once a document is invoiced or converted it can't go back to draft,
// be reversed, or lose its link. Refused on the server with a 400 and a reason.
//
// Runs against its own throwaway database (TEST_DB_URL + "_inv_rules").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_inv_rules$2");
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "1";
process.env.SUPERADMIN_EMAIL = "superadmin@test.local";
process.env.SUPERADMIN_PASSWORD = "Super@1234";
process.env.SUPERADMIN_MOBILE = "9000000001";
process.env.LOGIN_OTP_ENABLED = "false";
process.env.EMAIL_USER = "";
process.env.EMAIL_PASS = "";
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";

const mongoose = require("mongoose");
const request = require("supertest");

const realLog = console.log;
console.log = () => {};

let app;
let saToken;
let orgA;
let customer; // contact_id (customers)
let vendor; // Mongo _id (bills, POs and vendor credits name the vendor by it)
let vendorContact; // contact_id
const SA_IP = "203.0.113.71";

const call = (method, url, { body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", SA_IP).set("Authorization", `Bearer ${saToken}`);
  return body === undefined ? r : r.send(body);
};
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const itemNamed = (org, name) => mongoose.model("Item").findOne({ organization_id: String(org), name }).lean();
const stockOf = async (item) => {
  const it = await mongoose.model("Item").findById(item._id).lean();
  return { qty: money(it.stock_qty), value: money(it.stock_value) };
};
const idOf = async (model, filter) => String((await mongoose.model(model).findOne(filter, { _id: 1 }).lean())._id);
const movementsFor = (source_type, source_id) => mongoose.model("Stock_movement").find({ source_type, source_id: String(source_id) }).lean();
const journalOf = (journal_id) => mongoose.model("Journal").findOne({ journal_id }).lean();
const stockLines = (journal) => (journal?.line_items || []).filter((l) => l.stock_line);
const cogsAmount = (journal) => money(stockLines(journal).filter((l) => l.coa_account_name === "Cost of Goods Sold" && l.creditOrDebit === "Debit").reduce((s, l) => s + Number(l.amount || 0), 0));
const assertRefused = (r, pattern) => {
  assert.equal(r.status, 400, r.text);
  assert.equal(r.body.status === false || r.body.success === false || r.body.status === undefined, true, r.text);
  assert.match(r.body.message || "", pattern);
};

const newOrg = async (name) => {
  const o = await call("post", "/api/v1/org/create-organisation", { body: { organizationName: name, country: "India", state: "Tamil Nadu", industry_name: "Retail" } });
  assert.ok(o.status < 300, o.text);
  return String(o.body.data?.organization_id || o.body.organization_id);
};
const newContact = async (org, type, name) => {
  const r = await call("post", "/api/v1/contact", {
    body: {
      organization_id: org,
      contact_type: type,
      contact_name: name,
      company_name: name,
      place_of_contact: "Tamil Nadu",
      contact_persons: [{ first_name: name, email: `${name.replace(/\W/g, "").toLowerCase()}@rules.test`, is_primary_contact: true }],
    },
  });
  assert.ok(r.status < 300, r.text);
  return r.body.data.contact_id;
};
const newItem = async (org, body) => {
  const r = await call("post", "/api/v1/items/newitems", {
    body: {
      organization_id: org,
      item_type: "goods",
      can_be_sold: true,
      can_be_purchased: true,
      track_inventory: true,
      valuation_method: "average",
      ...body,
      item_name: body.name,
    },
  });
  assert.ok(r.status < 300, r.text);
  return itemNamed(org, body.name);
};
const tracked = (item, quantity, rate = 100) => ({ item_id: item.item_id, name: item.name, quantity, rate, gst_rate: 0 });
const free = (name, quantity = 2, rate = 100) => ({ name, quantity, rate, gst_rate: 18 });

const invoiceBody = (lines, status = "sent") => ({
  organization_id: orgA,
  customer_id: customer,
  customer_name: "Rules Customer",
  date: "2026-11-03",
  due_date: "2026-12-03",
  status,
  status_formatted: status[0].toUpperCase() + status.slice(1),
  place_of_supply: "Tamil Nadu",
  line_items: lines,
});
const createInvoice = (lines, status = "sent") => call("post", `/api/v1/invoices?org_id=${orgA}`, { body: invoiceBody(lines, status) });
const invoiceByNumber = (id) => mongoose.model("Invoice").findOne({ invoice_id: id, organization_id: orgA }).lean();

const billBody = (lines, status = 0) => ({
  status,
  vendor_id: vendor,
  vendorName: "Rules Vendor",
  billDate: "2026-11-01",
  dueDate: "2026-12-01",
  items: lines.map((l) => ({ ...l, item_name: l.name, amount: l.quantity * l.rate })),
});
const createBill = (lines, status = 0) => call("post", `/api/v1/bills/create-bills?org_id=${orgA}`, { body: billBody(lines, status) });

test.before(async () => {
  const conn = await mongoose.createConnection(process.env.DB_Coll).asPromise();
  await conn.dropDatabase();
  await conn.close();
  app = require("../../app");
  for (let i = 0; i < 100 && mongoose.connection.readyState !== 1; i++) await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 50; i++) {
    if (await mongoose.model("user").exists({ role: "superadmin" })) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const l = await call("post", "/api/v1/user/user-login", { body: { email: "superadmin@test.local", password: "Super@1234" } });
  assert.equal(l.status, 200, l.text);
  saToken = l.body.token;
  orgA = await newOrg("Rules A");
  customer = await newContact(orgA, "Customer", "Rules Customer");
  vendorContact = await newContact(orgA, "Vendor", "Rules Vendor");
  vendor = String((await mongoose.model("Contact").findOne({ contact_id: vendorContact }).lean())._id);
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

// ---- RULE 1 ---------------------------------------------------------------

test("RULE 1: free-text lines save on every document type and move no stock", async () => {
  const pen = await newItem(orgA, { name: "Rule1 Pen", opening_stock: 10, opening_stock_rate: 40 });
  const before = await stockOf(pen);
  const saved = [];

  const inv = await createInvoice([free("Consulting")], "sent");
  assert.equal(inv.status, 201, inv.text);
  saved.push(["invoice", await idOf("Invoice", { invoice_id: inv.body.data.invoice_id })]);

  const quote = await call("post", `/api/v1/estimates?organization_id=${orgA}`, {
    body: { organization_id: orgA, customer_id: customer, customer_name: "Rules Customer", date: "2026-11-03", expiry_date: "2026-12-03", status: "draft", status_formatted: "Draft", place_of_supply: "Tamil Nadu", line_items: [free("Quote service")] },
  });
  assert.ok(quote.status < 300, quote.text);

  const so = await call("post", `/api/v1/salesorders?organization_id=${orgA}`, {
    body: { organization_id: orgA, customer_id: customer, customer_name: "Rules Customer", date: "2026-11-03", shipment_date: "2026-12-03", status: "draft", status_formatted: "Draft", place_of_supply: "Tamil Nadu", line_items: [free("Order service")] },
  });
  assert.ok(so.status < 300, so.text);

  const challan = await call("post", `/api/v1/deliverychallans?organization_id=${orgA}`, {
    body: { organization_id: orgA, customer_id: customer, customer_name: "Rules Customer", date: "2026-11-03", status: "draft", status_formatted: "Draft", line_items: [free("Delivered crate", 1, 0)] },
  });
  assert.ok(challan.status < 300, challan.text);

  const bill = await createBill([free("Freight")]);
  assert.equal(bill.status, 201, bill.text);
  saved.push(["bill", await idOf("PO_bill", { bill_number: bill.body.data.bill_number })]);

  const po = await call("post", `/api/v1/purchaseorders/createpurchaseorder?org_id=${orgA}`, {
    body: { organization_id: orgA, org_id: orgA, vendor_id: vendor, vendorName: "Rules Vendor", date: "2026-11-03", status: 0, items: [{ name: "PO freight", quantity: 2, rate: 100, amount: 200 }] },
  });
  assert.equal(po.status, 201, po.text);

  const exp = await call("post", `/api/v1/expense/create-expense?org_id=${orgA}`, {
    body: { organization_id: orgA, expense_date: "2026-11-03", date: "2026-11-03", paid_through_account_id: "AC_018", paid_through_account_name: "Bank Account", tot_amount: 100, tot_amount_with_tax: 100, lineItems: [{ account_id: "AC_073", account_name: "Office Supplies", amount: 100, description: "Free expense" }] },
  });
  assert.equal(exp.status, 201, exp.text);

  const cn = await call("post", `/api/v1/credit-notes?org_id=${orgA}`, { body: { contact_id: customer, date: "2026-11-03", status: "open", line_items: [free("Goodwill credit", 1, 50)] } });
  assert.equal(cn.status, 201, cn.text);
  saved.push(["credit_note", await idOf("Credit_note", { credit_number: cn.body.data.credit_number })]);

  const vc = await call("post", `/api/v1/vendor-credits?org_id=${orgA}`, { body: { contact_id: vendor, date: "2026-11-03", status: "open", line_items: [free("Vendor return", 1, 30)] } });
  assert.equal(vc.status, 201, vc.text);
  saved.push(["vendor_credit", await idOf("Vendor_credit", { credit_number: vc.body.data.credit_number })]);

  for (const [type, id] of saved) {
    assert.equal((await movementsFor(type, id)).length, 0, `${type} with free text has no stock movement`);
  }
  assert.deepEqual(await stockOf(pen), before, "free-text documents leave stock unchanged");
});

test("RULE 1: a tracked item line moves stock out and books the cost; re-saving never doubles it", async () => {
  const pen = await itemNamed(orgA, "Rule1 Pen");
  const before = await stockOf(pen);
  const inv = await createInvoice([tracked(pen, 3, 100), free("Installation", 1, 500)], "sent");
  assert.equal(inv.status, 201, inv.text);
  const invId = await idOf("Invoice", { invoice_id: inv.body.data.invoice_id });
  assert.equal((await stockOf(pen)).qty, before.qty - 3);
  let moves = await movementsFor("invoice", invId);
  assert.equal(moves.length, 1, "only the tracked line moves stock");
  assert.equal(money(moves[0].qty), -3);
  const journal = await journalOf(inv.body.data.journal_id);
  assert.equal(cogsAmount(journal), money(3 * 40), "cost of the 3 pens is booked to COGS");

  const edit = await call("patch", `/api/v1/invoices?organization_id=${orgA}&invoice_id=${inv.body.data.invoice_id}`, {
    body: { ...invoiceBody([tracked(pen, 3, 100), free("Installation", 1, 500)], "sent") },
  });
  assert.equal(edit.status, 200, edit.text);
  assert.equal((await stockOf(pen)).qty, before.qty - 3, "re-saving does not take the stock out again");
  moves = await movementsFor("invoice", invId);
  assert.equal(moves.length, 1, "still one movement");
  assert.equal(cogsAmount(await journalOf(inv.body.data.journal_id)), money(3 * 40), "still one cost entry");
  assert.equal(stockLines(await journalOf(inv.body.data.journal_id)).length, 2, "one debit and one credit for the cost");
});

test("RULE 1: non-tracked goods and services on a document move no stock and book no cost", async () => {
  const plain = await newItem(orgA, { name: "Rule1 Plain Goods", track_inventory: false, opening_stock: 0 });
  const service = await newItem(orgA, { name: "Rule1 Service", item_type: "service", track_inventory: false });
  const inv = await createInvoice([tracked(plain, 2, 90), tracked(service, 1, 300)], "sent");
  assert.equal(inv.status, 201, inv.text);
  assert.equal((await movementsFor("invoice", await idOf("Invoice", { invoice_id: inv.body.data.invoice_id }))).length, 0);
  assert.equal(stockLines(await journalOf(inv.body.data.journal_id)).length, 0, "no cost lines in the journal");
});

test("RULE 1: a tracked bill line puts stock in; the inventory asset is debited for it only", async () => {
  const pen = await itemNamed(orgA, "Rule1 Pen");
  const before = await stockOf(pen);
  const bill = await createBill([tracked(pen, 4, 60), free("Packing", 1, 25)], 0);
  assert.equal(bill.status, 201, bill.text);
  assert.equal((await stockOf(pen)).qty, before.qty + 4);
  assert.equal((await movementsFor("bill", await idOf("PO_bill", { bill_number: bill.body.data.bill_number }))).length, 1, "only the tracked line moves stock");
  const billDoc = await mongoose.model("PO_bill").findOne({ bill_number: bill.body.data.bill_number }).lean();
  const journal = await journalOf(billDoc.journal_id);
  const inventoryDebit = (journal?.line_items || []).filter((l) => l.coa_account_name === "Inventory Asset" && l.creditOrDebit === "Debit");
  assert.equal(money(inventoryDebit.reduce((s, l) => s + Number(l.amount || 0), 0)), money(4 * 60), "inventory asset holds the tracked line only");
});

test("RULE 1: a delivery challan line can be a free-text line or a tracked item; only the invoice moves stock", async () => {
  const pen = await itemNamed(orgA, "Rule1 Pen");
  const before = await stockOf(pen);
  const challan = await call("post", `/api/v1/deliverychallans?organization_id=${orgA}`, {
    body: { organization_id: orgA, customer_id: customer, customer_name: "Rules Customer", date: "2026-11-03", status: "draft", status_formatted: "Draft", line_items: [tracked(pen, 2, 100), free("Crate", 1, 0)] },
  });
  assert.ok(challan.status < 300, challan.text);
  assert.equal((await stockOf(pen)).qty, before.qty, "an open challan moves no stock");
});

// ---- RULE 2 ---------------------------------------------------------------

test("RULE 2: a sent invoice can't go back to draft, by status endpoint or by edit", async () => {
  const inv = await createInvoice([free("Retainer", 1, 1000)], "sent");
  assert.equal(inv.status, 201, inv.text);
  const q = `organization_id=${orgA}&invoice_id=${inv.body.data.invoice_id}`;

  const viaStatus = await call("put", `/api/v1/invoices/status?${q}`, { body: { status: "draft", status_formatted: "Draft" } });
  assertRefused(viaStatus, /has been sent, so it can't go back to draft/);

  const viaEdit = await call("patch", `/api/v1/invoices?${q}`, { body: { ...invoiceBody([free("Retainer", 1, 1000)], "draft") } });
  assertRefused(viaEdit, /has been sent, so it can't go back to draft/);

  const stillSent = await invoiceByNumber(inv.body.data.invoice_id);
  assert.equal(stillSent.status, "sent");

  // Editing the lines of a sent invoice (status unchanged) is still allowed.
  const editLines = await call("patch", `/api/v1/invoices?${q}`, { body: { ...invoiceBody([free("Retainer", 2, 1000)], "sent") } });
  assert.equal(editLines.status, 200, editLines.text);
});

test("RULE 2: an invoice with payments can't go back to draft", async () => {
  const inv = await createInvoice([free("Part paid", 1, 400)], "sent");
  assert.equal(inv.status, 201, inv.text);
  await mongoose.model("Invoice").updateOne({ invoice_id: inv.body.data.invoice_id }, { $set: { status: "partially paid", payment_made: 100 } });
  const q = `organization_id=${orgA}&invoice_id=${inv.body.data.invoice_id}`;
  assertRefused(await call("put", `/api/v1/invoices/status?${q}`, { body: { status: "draft", status_formatted: "Draft" } }), /payments recorded, so it can't go back to draft/);
  assertRefused(await call("patch", `/api/v1/invoices?${q}`, { body: { ...invoiceBody([free("Part paid", 1, 400)], "draft") } }), /payments recorded/);
});

test("RULE 2: void reverses stock and the cost; a never-sent draft can be voided and restored; a sent void can't be reopened", async () => {
  const pen = await itemNamed(orgA, "Rule1 Pen");
  const before = await stockOf(pen);
  const inv = await createInvoice([tracked(pen, 2, 100)], "sent");
  assert.equal(inv.status, 201, inv.text);
  const q = `organization_id=${orgA}&invoice_id=${inv.body.data.invoice_id}`;
  assert.equal((await stockOf(pen)).qty, before.qty - 2);

  const voided = await call("put", `/api/v1/invoices/status?${q}`, { body: { status: "void", status_formatted: "Void" } });
  assert.equal(voided.status, 200, voided.text);
  assert.equal((await stockOf(pen)).qty, before.qty, "void puts the stock back");
  assert.equal(stockLines(await journalOf(inv.body.data.journal_id)).length, 0, "void removes the cost lines");

  assertRefused(await call("put", `/api/v1/invoices/status?${q}`, { body: { status: "draft", status_formatted: "Draft" } }), /has been sent, so it can't go back to draft/);
  assertRefused(await call("put", `/api/v1/invoices/status?${q}`, { body: { status: "sent", status_formatted: "Sent" } }), /has been voided, so it can't be reopened/);

  // A draft that was voided without ever being sent can be restored to draft.
  const draft = await createInvoice([free("Never sent", 1, 100)], "draft");
  const dq = `organization_id=${orgA}&invoice_id=${draft.body.data.invoice_id}`;
  assert.equal((await call("put", `/api/v1/invoices/status?${dq}`, { body: { status: "void", status_formatted: "Void" } })).status, 200);
  const restored = await call("put", `/api/v1/invoices/status?${dq}`, { body: { status: "draft", status_formatted: "Draft" } });
  assert.equal(restored.status, 200, restored.text);
});

test("RULE 2: a quote converted to an invoice can't go back to draft, be deleted or lose its status", async () => {
  const quote = await call("post", `/api/v1/estimates?organization_id=${orgA}`, {
    body: { organization_id: orgA, customer_id: customer, customer_name: "Rules Customer", date: "2026-11-03", expiry_date: "2026-12-03", status: "sent", status_formatted: "Sent", place_of_supply: "Tamil Nadu", line_items: [free("Quoted work", 1, 800)] },
  });
  assert.ok(quote.status < 300, quote.text);
  const quoteId = quote.body.data.msg.quote_id;

  const conv = await call("post", `/api/v1/estimates/convert?organization_id=${orgA}&quote_id=${quoteId}`, { body: { status: "sent", status_formatted: "Sent" } });
  assert.equal(conv.status, 200, conv.text);

  const cq = `organization_id=${orgA}&quote_id=${quoteId}`;
  assertRefused(await call("put", `/api/v1/estimate/status?${cq}`, { body: { status: "draft", status_formatted: "Draft" } }), /converted to an invoice and can't go back to draft/);
  assertRefused(await call("put", `/api/v1/estimate/status?${cq}`, { body: { status: "sent", status_formatted: "Sent" } }), /converted to an invoice, so its status can't change/);
  assertRefused(await call("patch", `/api/v1/estimates/${quoteId}/status?organization_id=${orgA}`, { body: { status: "sent", status_formatted: "Sent" } }), /converted to an invoice, so its status can't change/);
  assertRefused(await call("put", `/api/v1/estimates/${quoteId}?organization_id=${orgA}`, { body: { status: "draft", status_formatted: "Draft" } }), /can't go back to draft/);
  assertRefused(await call("delete", `/api/v1/estimates/${quoteId}?organization_id=${orgA}`), /can't be deleted/);
});

test("RULE 2: a quote that was never converted can still change status", async () => {
  const quote = await call("post", `/api/v1/estimates?organization_id=${orgA}`, {
    body: { organization_id: orgA, customer_id: customer, customer_name: "Rules Customer", date: "2026-11-03", expiry_date: "2026-12-03", status: "sent", status_formatted: "Sent", place_of_supply: "Tamil Nadu", line_items: [free("Open quote", 1, 100)] },
  });
  const quoteId = quote.body.data.msg.quote_id;
  const r = await call("put", `/api/v1/estimate/status?organization_id=${orgA}&quote_id=${quoteId}`, { body: { status: "draft", status_formatted: "Draft" } });
  assert.equal(r.status, 200, r.text);
});

test("RULE 2: a sales order converted to an invoice can't go back to draft, be voided, be unlinked or deleted", async () => {
  const pen = await itemNamed(orgA, "Rule1 Pen");
  const so = await call("post", `/api/v1/salesorders?organization_id=${orgA}`, {
    body: { organization_id: orgA, customer_id: customer, customer_name: "Rules Customer", date: "2026-11-03", shipment_date: "2026-12-03", status: "sent", status_formatted: "Sent", place_of_supply: "Tamil Nadu", line_items: [tracked(pen, 1, 100)] },
  });
  assert.ok(so.status < 300, so.text);
  const soId = so.body.data.salesorder_id;
  const before = await stockOf(pen);

  const conv = await call("post", `/api/v1/salesorders/convert-to-invoice?organization_id=${orgA}&salesorder_id=${soId}`, { body: { status: "sent", status_formatted: "Sent" } });
  assert.equal(conv.status, 200, conv.text);
  assert.equal((await stockOf(pen)).qty, before.qty - 1, "the invoice from the order takes the stock out once");

  const sq = `organization_id=${orgA}&salesorder_id=${soId}`;
  assertRefused(await call("put", `/api/v1/sales-order/status?${sq}`, { body: { status: "draft", status_formatted: "Draft" } }), /converted to an invoice and can't go back to draft/);
  assertRefused(await call("put", `/api/v1/sales-order/status?${sq}`, { body: { status: "void", status_formatted: "Void" } }), /can't be marked void/);
  assertRefused(await call("put", `/api/v1/sales-order/status?${sq}`, { body: { status: "not_invoiced", status_formatted: "Not Invoiced", invoiced_status: "not_invoiced" } }), /can't be marked not invoiced/);
  assertRefused(await call("put", `/api/v1/salesorders?${sq}`, { body: { status: "draft", status_formatted: "Draft" } }), /can't go back to draft/);
  assertRefused(await call("delete", `/api/v1/salesorders?${sq}`), /can't be deleted/);
  assert.equal((await stockOf(pen)).qty, before.qty - 1, "refused changes leave the stock alone");
});

test("RULE 2: a delivery challan converted to an invoice can't go back to draft or be marked not invoiced", async () => {
  const challan = await call("post", `/api/v1/deliverychallans?organization_id=${orgA}`, {
    body: { organization_id: orgA, customer_id: customer, customer_name: "Rules Customer", date: "2026-11-03", status: "open", status_formatted: "Open", line_items: [free("Dispatched", 1, 200)] },
  });
  assert.ok(challan.status < 300, challan.text);
  const cid = challan.body.deliverychallan.deliverychallan_id;
  const conv = await call("post", `/api/v1/deliverychallans/convert-to-invoice?organization_id=${orgA}&deliverychallan_id=${cid}`, { body: { status: "sent", status_formatted: "Sent" } });
  assert.equal(conv.status, 200, conv.text);

  const cq = `organization_id=${orgA}&deliverychallan_id=${cid}`;
  assertRefused(await call("put", `/api/v1/deliverychallan/status?${cq}`, { body: { status: "draft", status_formatted: "Draft" } }), /converted to an invoice and can't go back to draft/);
  assertRefused(await call("put", `/api/v1/deliverychallan/status?${cq}`, { body: { status: "open", status_formatted: "Open", invoiced_status: "" } }), /can't be marked not invoiced/);
  assertRefused(await call("put", `/api/v1/deliverychallans?${cq}`, { body: { status: "draft" } }), /can't go back to draft/);
  assertRefused(await call("delete", `/api/v1/deliverychallans?${cq}`), /can't be deleted/);
});

test("RULE 2: a recorded bill can't go back to draft; a void bill can't be reopened; void reverses its stock", async () => {
  const pen = await itemNamed(orgA, "Rule1 Pen");
  const before = await stockOf(pen);
  const bill = await createBill([tracked(pen, 2, 70)], 0);
  assert.equal(bill.status, 201, bill.text);
  const billNo = bill.body.data.bill_number;
  assert.equal((await stockOf(pen)).qty, before.qty + 2);

  assertRefused(await call("put", `/api/v1/bills/update-individual-bill?org_id=${orgA}&bill_id=${billNo}`, { body: { status: 1 } }), /recorded, so it can't go back to draft/);
  assertRefused(await call("post", `/api/v1/bills/update-status-draft?org_id=${orgA}&bill_id=${billNo}&status=draft`, {}), /recorded, so it can't go back to draft/);

  const voided = await call("post", `/api/v1/bills/update-status-void?org_id=${orgA}&bill_id=${billNo}&status=void`, {});
  assert.equal(voided.status, 200, voided.text);
  assert.equal((await stockOf(pen)).qty, before.qty, "void reverses the bill's stock");

  assertRefused(await call("post", `/api/v1/bills/update-status-draft?org_id=${orgA}&bill_id=${billNo}&status=draft`, {}), /recorded, so it can't go back to draft/);
  assertRefused(await call("put", `/api/v1/bills/update-individual-bill?org_id=${orgA}&bill_id=${billNo}`, { body: { status: 1 } }), /recorded, so it can't go back to draft/);
  assertRefused(await call("put", `/api/v1/bills/update-individual-bill?org_id=${orgA}&bill_id=${billNo}`, { body: { status: 0 } }), /voided, so it can't be reopened/);
  assert.equal((await stockOf(pen)).qty, before.qty, "refused changes leave the stock alone");
});

test("RULE 2: a purchase order converted to a bill can't go back to draft, be voided, cancelled or deleted", async () => {
  const po = await call("post", `/api/v1/purchaseorders/createpurchaseorder?org_id=${orgA}`, {
    body: { organization_id: orgA, org_id: orgA, vendor_id: vendor, vendorName: "Rules Vendor", date: "2026-11-03", status: 0, items: [{ name: "Ink", quantity: 2, rate: 50, amount: 100 }] },
  });
  assert.equal(po.status, 201, po.text);
  const poNo = po.body.data.purchase_number;

  const toBill = await call("post", `/api/v1/purchase-orders/update-purchase-to-bill?org_id=${orgA}&po_id=${poNo}`, {
    body: { vendor_id: vendor, vendorName: "Rules Vendor", billDate: "2026-11-03", dueDate: "2026-12-03", items: [{ name: "Ink", quantity: 2, rate: 50, amount: 100 }] },
  });
  assert.equal(toBill.status, 201, toBill.text);

  const pq = `org_id=${orgA}&po_id=${poNo}`;
  assertRefused(await call("put", `/api/v1/purchase-orders/update-status?${pq}`, { body: { status: 1 } }), /converted to a bill, so it can't be moved back to draft/);
  assertRefused(await call("put", `/api/v1/purchase-orders/update-status?${pq}`, { body: { status: 4 } }), /converted to a bill, so it can't be cancelled/);
  assertRefused(await call("put", `/api/v1/purchase-orders/update-status?${pq}`, { body: { status: 2 } }), /converted to a bill, so it can't be voided/);
  assertRefused(await call("post", `/api/v1/purchase-orders/update-status-void?${pq}&status=void`, {}), /converted to a bill, so it can't be voided/);
  assertRefused(await call("post", `/api/v1/purchase-orders/update-status-draft?${pq}&status=draft`, {}), /converted to a bill, so it can't be moved back to draft/);
  // A converted order is stored as status 1 (closed, billed): saving it unchanged is fine, reopening it is not.
  assert.equal((await call("put", `/api/v1/purchase-orders/update-individual-purchase-order?${pq}`, { body: { status: 1 } })).status, 200);
  assertRefused(await call("put", `/api/v1/purchase-orders/update-individual-purchase-order?${pq}`, { body: { status: 0 } }), /converted to a bill, so its status can't be changed/);
  assertRefused(await call("delete", `/api/v1/purchase-orders/delete-individual-purchase-order?${pq}`), /converted to a bill and can't be deleted/);
});

test("RULE 2: a purchase order that was never billed can still be voided and moved back to draft", async () => {
  const po = await call("post", `/api/v1/purchaseorders/createpurchaseorder?org_id=${orgA}`, {
    body: { organization_id: orgA, org_id: orgA, vendor_id: vendor, vendorName: "Rules Vendor", date: "2026-11-03", status: 0, items: [{ name: "Paper", quantity: 1, rate: 50, amount: 50 }] },
  });
  const poNo = po.body.data.purchase_number;
  const pq = `org_id=${orgA}&po_id=${poNo}`;
  assert.equal((await call("post", `/api/v1/purchase-orders/update-status-void?${pq}&status=void`, {})).status, 200);
  assert.equal((await call("post", `/api/v1/purchase-orders/update-status-draft?${pq}&status=draft`, {})).status, 200);
  assert.equal((await call("put", `/api/v1/purchase-orders/update-status?${pq}`, { body: { status: 2 } })).status, 200);
  assert.equal((await call("put", `/api/v1/purchase-orders/update-status?${pq}`, { body: { status: 1 } })).status, 200);
});
