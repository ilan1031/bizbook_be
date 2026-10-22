// End-to-end bookkeeping test: drives the API the way the screens do
// (company setup, customers, invoices, payments, bills, expenses, manual
// journals) and checks that the books stay right - every journal balances,
// drafts and voids stay out of the reports, payments update invoices, and the
// P&L, balance sheet and dashboard agree with each other.
//
// Runs against its own throwaway database (TEST_DB_URL + "_ledger").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_ledger$2");
process.env.JWT_SECRET = "test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.TRUST_PROXY = "1";
process.env.SUPERADMIN_EMAIL = "superadmin@test.local";
process.env.SUPERADMIN_PASSWORD = "Super@1234";
process.env.SUPERADMIN_MOBILE = "9000000001";
process.env.LOGIN_OTP_ENABLED = "false";
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

const mongoose = require("mongoose");
const request = require("supertest");

const realLog = console.log;
console.log = () => {}; // the controllers are chatty

let app;
let token;
let org;
const IP = "10.0.0.1";
const today = new Date().toISOString().slice(0, 10);
const nextMonth = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

const api = (method, url, body) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};
const paise = (n) => Math.round(Number(n || 0) * 100);

const journals = () => mongoose.model("Journal").find({ organization_id: String(org) }).lean();
const journal = (journal_id) => mongoose.model("Journal").findOne({ journal_id }).lean();
const invoice = (invoice_id) => mongoose.model("Invoice").findOne({ invoice_id }).lean();

const balanceSheet = async () => (await api("get", `/api/v1/reports/balance-sheet?org_id=${org}`)).body.data;
const accountAmount = (bs, name) => {
  for (const side of Object.values(bs.sections)) {
    for (const group of side) {
      const acc = group.accounts.find((a) => a.account_name === name);
      if (acc) return acc.amount;
    }
  }
  return 0;
};
const profitAndLoss = async () =>
  (await api("get", `/api/v1/reports/profit-loss/bill-invoice?organization_id=${org}&from=${today.slice(0, 4)}-01-01&to=${nextMonth}`))
    .body.data.summary;

let customer;
let vendor;
const ids = {};

test.before(async () => {
  const conn = await mongoose.createConnection(process.env.DB_Coll).asPromise();
  await conn.dropDatabase();
  await conn.close();
  app = require("../../app");
  for (let i = 0; i < 100 && mongoose.connection.readyState !== 1; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (let i = 0; i < 50; i++) {
    if (await mongoose.model("user").exists({ role: "superadmin" })) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const res = await request(app)
    .post("/api/v1/user/user-login")
    .set("X-Forwarded-For", IP)
    .send({ email: "superadmin@test.local", password: "Super@1234" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  token = res.body.token || res.body.data?.token;
  assert.ok(token, "login token");
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("company setup creates an organisation with a chart of accounts", async () => {
  const res = await api("post", "/api/v1/org/create-organisation", {
    organizationName: "Ledger Test Pvt Ltd",
    country: "India",
    state: "Tamil Nadu",
    industry_name: "IT",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  org = res.body.data?.organization_id || res.body.organization_id;
  assert.ok(org, JSON.stringify(res.body));
  const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: String(org) }).lean();
  assert.ok(coa?.chart_of_accounts?.length > 20);
});

test("customers and vendors can be created", async () => {
  const c = await api("post", "/api/v1/contact", {
    organization_id: String(org),
    contact_type: "Customer",
    contact_name: "Kumar Traders",
    company_name: "Kumar Traders",
    gst_treatment: "Unregistered Business",
    place_of_contact: "TN",
  });
  assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
  customer = await mongoose.model("Contact").findOne({ organization_id: String(org), contact_type: "Customer" }).lean();
  assert.ok(customer?.contact_id);

  const v = await api("post", "/api/v1/contact", {
    organization_id: String(org),
    contact_type: "Vendor",
    contact_name: "Supply Co",
    company_name: "Supply Co",
  });
  assert.ok([200, 201].includes(v.status), JSON.stringify(v.body));
  vendor = await mongoose.model("Contact").findOne({ organization_id: String(org), contact_type: "Vendor" }).lean();
  assert.ok(vendor?._id);
});

const createInvoice = async (status, qty, rate) => {
  const res = await api("post", `/api/v1/invoices?org_id=${org}`, {
    customer_id: customer.contact_id,
    customer_name: customer.contact_name,
    date: today,
    due_date: nextMonth,
    line_items: [{ item_id: "IT-1", name: "Consulting", quantity: qty, rate }],
    sub_total: qty * rate,
    status,
    status_formatted: status[0].toUpperCase() + status.slice(1),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
};

test("a sent invoice posts a balanced journal; a draft one stays out of the books", async () => {
  const sent = await createInvoice("sent", 2, 5000);
  ids.invoice = sent.invoice_id;
  assert.equal(sent.total, 10000);
  assert.equal(sent.balance, 10000);
  const j = await journal(sent.journal_id);
  assert.equal(j.posting_status, "posted");

  const draft = await createInvoice("draft", 1, 3000);
  assert.equal((await journal(draft.journal_id)).posting_status, "draft");

  const toVoid = await createInvoice("sent", 1, 2000);
  const v = await api("put", `/api/v1/invoices/status?organization_id=${org}&invoice_id=${toVoid.invoice_id}`, {
    status: "void",
    status_formatted: "Void",
  });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal((await journal(toVoid.journal_id)).posting_status, "void");
});

test("payment received: rejects over-application, then records and applies a bank payment", async () => {
  const over = await api("post", `/api/v1/payment/customerpayments?organization_id=${org}`, {
    formType: "Invoice Payment",
    amount: 20000,
    payment_mode: "Bank Transfer",
    date: today,
    customer_id: customer.contact_id,
    customer_name: customer.contact_name,
    invoices: [{ invoice_id: ids.invoice, amount_applied: 15000 }],
  });
  assert.equal(over.status, 400, "more than the invoice balance");

  const res = await api("post", `/api/v1/payment/customerpayments?organization_id=${org}`, {
    formType: "Invoice Payment",
    amount: 6000,
    payment_mode: "Bank Transfer",
    deposite_to: "Petty Cash",
    date: today,
    customer_id: customer.contact_id,
    customer_name: customer.contact_name,
    invoices: [{ invoice_id: ids.invoice, amount_applied: 6000 }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.online, false, "offline payment needs no gateway");
  assert.equal(res.body.paymentData.payment_status, "completed");

  const inv = await invoice(ids.invoice);
  assert.equal(inv.balance, 4000);
  assert.equal(inv.status, "partially paid");
  const j = await journal(res.body.paymentData.journal_id);
  assert.equal(j.posting_status, "posted");
});

test("editing an invoice re-posts its journal and keeps the paid amount", async () => {
  const res = await api("patch", `/api/v1/invoices?organization_id=${org}&invoice_id=${ids.invoice}`, {
    line_items: [{ item_id: "IT-1", name: "Consulting", quantity: 2, rate: 6000 }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const inv = await invoice(ids.invoice);
  assert.equal(inv.total, 12000);
  assert.equal(inv.balance, 6000);
  const j = await journal(inv.journal_id);
  const ar = j.line_items.find((l) => l.coa_account_id === "AC_019");
  assert.equal(ar.amount, 12000);
});

test("a bill with TDS posts a balanced journal (TDS is owed, not receivable); a draft bill doesn't post", async () => {
  const res = await api("post", `/api/v1/bills/create-bills?org_id=${org}`, {
    status: 0,
    vendor_id: vendor._id,
    vendorName: vendor.contact_name,
    billDate: today,
    dueDate: nextMonth,
    items: [{ account_id: "AC_078", account_name: "Cost of Goods Sold", amount: "4000", quantity: 1, rate: 4000 }],
    sub_total: 4000,
    total: 3600,
    tax_type: "TDS",
    tax_percentage: 10,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  ids.bill = res.body.data.bill_number;
  const j = res.body.journalData;
  assert.equal(j.posting_status, "posted");
  const tds = j.line_items.find((l) => l.coa_account_name === "TDS Payable");
  assert.equal(tds?.creditOrDebit, "Credit");
  assert.equal(j.line_items.find((l) => l.coa_account_id === "AC_032").amount, 3600);

  const draft = await api("post", `/api/v1/bills/create-bills?org_id=${org}`, {
    status: 1,
    vendor_id: vendor._id,
    vendorName: vendor.contact_name,
    billDate: today,
    dueDate: nextMonth,
    items: [{ account_id: "AC_078", account_name: "Cost of Goods Sold", amount: "1000" }],
    sub_total: 1000,
    total: 1000,
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.journalData.posting_status, "draft");
});

test("editing a bill can't move it to another company and re-posts its journal", async () => {
  const res = await api("put", `/api/v1/bills/update-individual-bill?org_id=${org}&bill_id=${ids.bill}`, {
    organization_id: "999999",
    admin_id: "000000000000000000000000",
    items: [{ account_id: "AC_078", account_name: "Cost of Goods Sold", amount: "4000" }],
    sub_total: 4000,
    total: 3600,
    tax_type: "TDS",
    tax_percentage: 10,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const bill = await mongoose.model("PO_bill").findOne({ bill_number: ids.bill }).lean();
  assert.equal(String(bill.organization_id), String(org));
  const j = await journal(bill.journal_id);
  assert.equal(j.line_items.find((l) => l.coa_account_id === "AC_032").amount, 3600);

  const missing = await api("put", `/api/v1/bills/update-individual-bill?org_id=${org}&bill_id=BL-NOPE`, { total: 1 });
  assert.equal(missing.status, 404);
});

test("payment made and expense post balanced journals", async () => {
  const pay = await api("post", `/api/v1/payments/made?organization_id=${org}`, {
    contact_id: String(vendor._id),
    payment_type: "BillPayment",
    amount: 2000,
    date: today,
    paid_through_account_id: "AC_017",
    paid_through_account_name: "Petty Cash",
    organization_id: "999999", // must be ignored
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(String(pay.body.data.organization_id), String(org));

  const exp = await api("post", `/api/v1/expense/create-expense?org_id=${org}`, {
    type: "expense",
    date: today,
    paid_through_account_id: "AC_017",
    paid_through_account_name: "Petty Cash",
    tot_amount: 1500,
    tot_amount_with_tax: 1500,
    lineItems: [{ account_id: "AC_065", account_name: "Other Expenses", amount: 1500 }],
  });
  assert.equal(exp.status, 201, JSON.stringify(exp.body));

  const noLines = await api("post", `/api/v1/expense/create-expense?org_id=${org}`, {
    type: "expense",
    date: today,
    tot_amount_with_tax: 10,
  });
  assert.equal(noLines.status, 400);
});

test("manual journal: owner's capital", async () => {
  const res = await api("post", `/api/v1/manual-journals?org_id=${org}`, {
    journal_date: today,
    reference_number: "CAP-1",
    notes: "Owner's capital",
    line_items: [
      { coa_account_id: "AC_017", creditOrDebit: "Debit", amount: 50000 },
      { coa_account_id: "AC_042", creditOrDebit: "Credit", amount: 50000 },
    ],
  });
  assert.ok([200, 201].includes(res.status), JSON.stringify(res.body));
});

const journalOf = async (credit) => journal(credit.journal_id);

test("credit note: raises a balanced credit, applies to an invoice, refunds the rest", async () => {
  const cn = await api("post", `/api/v1/credit-notes?org_id=${org}`, {
    contact_id: customer.contact_id,
    date: today,
    reference_number: "RET-1",
    line_items: [{ name: "Returned consulting hours", quantity: 1, rate: 1000 }],
  });
  assert.equal(cn.status, 201, JSON.stringify(cn.body));
  ids.creditNote = cn.body.data.credit_number;
  assert.equal(cn.body.data.balance, 1000);
  const j = await journalOf(cn.body.data);
  assert.equal(j.posting_status, "posted");
  assert.deepEqual(
    j.line_items.map((l) => [l.coa_account_id, l.creditOrDebit, l.amount]),
    [["AC_046", "Debit", 1000], ["AC_019", "Credit", 1000]]
  );

  const open = await api("get", `/api/v1/credit-notes/${ids.creditNote}/open-documents?org_id=${org}`);
  assert.equal(open.status, 200);
  assert.ok(open.body.data.some((d) => d.document_id === ids.invoice && d.balance === 6000));

  const apply = await api("post", `/api/v1/credit-notes/${ids.creditNote}/apply?org_id=${org}`, {
    applications: [{ document_id: ids.invoice, amount: 600 }],
  });
  assert.equal(apply.status, 200, JSON.stringify(apply.body));
  assert.equal(apply.body.data.balance, 400);
  const inv = await invoice(ids.invoice);
  assert.equal(inv.balance, 5400);
  assert.equal(inv.credits_applied, 600);

  const over = await api("post", `/api/v1/credit-notes/${ids.creditNote}/apply?org_id=${org}`, {
    applications: [{ document_id: ids.invoice, amount: 500 }],
  });
  assert.equal(over.status, 400, "more than the credit left");

  const notCash = await api("post", `/api/v1/credit-notes/${ids.creditNote}/refund?org_id=${org}`, {
    amount: 400, date: today, account_id: "AC_046",
  });
  assert.equal(notCash.status, 400, "refunds come from cash or bank");

  const refund = await api("post", `/api/v1/credit-notes/${ids.creditNote}/refund?org_id=${org}`, {
    amount: 400, date: today, account_id: "AC_017", mode: "Cash",
  });
  assert.equal(refund.status, 200, JSON.stringify(refund.body));
  assert.equal(refund.body.data.status, "closed");
  const rj = await journal(refund.body.data.refunds[0].journal_id);
  assert.deepEqual(
    rj.line_items.map((l) => [l.coa_account_id, l.creditOrDebit, l.amount]),
    [["AC_019", "Debit", 400], ["AC_017", "Credit", 400]]
  );

  const edit = await api("put", `/api/v1/credit-notes/${ids.creditNote}?org_id=${org}`, {
    line_items: [{ name: "x", quantity: 1, rate: 5 }],
  });
  assert.equal(edit.status, 400, "a used credit can't be edited");
  assert.equal((await api("delete", `/api/v1/credit-notes/${ids.creditNote}?org_id=${org}`)).status, 400);
});

test("credit note: draft and void stay out of the books; an unused one can be deleted", async () => {
  const draft = await api("post", `/api/v1/credit-notes?org_id=${org}`, {
    contact_id: customer.contact_id,
    date: today,
    status: "draft",
    line_items: [{ name: "Draft credit", quantity: 2, rate: 250 }],
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const number = draft.body.data.credit_number;
  assert.equal((await journalOf(draft.body.data)).posting_status, "draft");

  const applyDraft = await api("post", `/api/v1/credit-notes/${number}/apply?org_id=${org}`, {
    applications: [{ document_id: ids.invoice, amount: 100 }],
  });
  assert.equal(applyDraft.status, 400, "a draft can't be applied");

  const v = await api("put", `/api/v1/credit-notes/${number}/status?org_id=${org}`, { status: "void" });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal((await journalOf(draft.body.data)).posting_status, "void");

  const del = await api("delete", `/api/v1/credit-notes/${number}?org_id=${org}`);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(await journal(draft.body.data.journal_id), null, "its journal goes with it");

  const noCustomer = await api("post", `/api/v1/credit-notes?org_id=${org}`, {
    contact_id: String(vendor._id), date: today, line_items: [{ name: "x", quantity: 1, rate: 1 }],
  });
  assert.equal(noCustomer.status, 400, "a vendor isn't a customer");
});

test("vendor credit: raises a balanced credit and applies it to a bill", async () => {
  const vc = await api("post", `/api/v1/vendor-credits?org_id=${org}`, {
    contact_id: String(vendor._id),
    date: today,
    line_items: [{ name: "Damaged goods returned", quantity: 1, rate: 500 }],
  });
  assert.equal(vc.status, 201, JSON.stringify(vc.body));
  const number = vc.body.data.credit_number;
  const j = await journalOf(vc.body.data);
  assert.deepEqual(
    j.line_items.map((l) => [l.coa_account_id, l.creditOrDebit, l.amount]),
    [["AC_078", "Credit", 500], ["AC_032", "Debit", 500]]
  );

  const apply = await api("post", `/api/v1/vendor-credits/${number}/apply?org_id=${org}`, {
    applications: [{ document_id: ids.bill, amount: 500 }],
  });
  assert.equal(apply.status, 200, JSON.stringify(apply.body));
  assert.equal(apply.body.data.status, "closed");
  const bill = await mongoose.model("PO_bill").findOne({ bill_number: ids.bill }).lean();
  assert.equal(bill.due_amt, 3100);
  assert.equal(bill.vendor_credits_applied, 500);
  assert.equal(bill.status_type, "PARTIALLY PAID");
});

test("bill payments add up instead of replacing each other", async () => {
  for (const amount of [100, 100]) {
    const res = await api("put", `/api/v1/bills/apply-payment?org_id=${org}&bill_id=${ids.bill}`, { amount_applied: amount });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  const bill = await mongoose.model("PO_bill").findOne({ bill_number: ids.bill }).lean();
  assert.equal(bill.payment_made, 200);
  assert.equal(bill.due_amt, 2900);
  const over = await api("put", `/api/v1/bills/apply-payment?org_id=${org}&bill_id=${ids.bill}`, { amount_applied: 5000 });
  assert.equal(over.status, 400);
});

const lineOf = (j, id) => j.line_items.find((l) => l.coa_account_id === id);

test("GST: same-state invoice charges CGST + SGST and posts them as output tax", async () => {
  const res = await api("post", `/api/v1/invoices?org_id=${org}`, {
    customer_id: customer.contact_id,
    customer_name: customer.contact_name,
    date: today,
    due_date: nextMonth,
    status: "sent",
    line_items: [{ item_id: "IT-2", name: "Laptop", quantity: 1, rate: 10000, gst_rate: 18 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const inv = res.body.data;
  assert.equal(inv.supply_type, "intra", "customer and company are both in Tamil Nadu");
  assert.equal(inv.cgst_total, 900);
  assert.equal(inv.sgst_total, 900);
  assert.equal(inv.total, 11800);
  assert.equal(inv.balance, 11800);
  const j = await journal(inv.journal_id);
  assert.equal(lineOf(j, "AC_046").amount, 10000);
  assert.equal(lineOf(j, "AC_029").amount, 900);
  assert.equal(lineOf(j, "AC_030").amount, 900);
  assert.equal(lineOf(j, "AC_019").amount, 11800);
});

test("GST: other-state place of supply charges IGST", async () => {
  const res = await api("post", `/api/v1/invoices?org_id=${org}`, {
    customer_id: customer.contact_id,
    customer_name: customer.contact_name,
    place_of_supply: "[KA] - Karnataka",
    date: today,
    due_date: nextMonth,
    status: "sent",
    line_items: [{ name: "Support", quantity: 2, rate: 1000, gst_rate: 12 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const inv = res.body.data;
  assert.equal(inv.supply_type, "inter");
  assert.equal(inv.igst_total, 240);
  assert.equal(inv.cgst_total, 0);
  assert.equal(inv.total, 2240);
  assert.equal(lineOf(await journal(inv.journal_id), "AC_028").amount, 240);
});

test("GST: quotes and sales orders are priced the same way; a converted quote carries its GST", async () => {
  const q = await api("post", `/api/v1/estimates?organization_id=${org}`, {
    customer_id: customer.contact_id,
    customer_name: customer.contact_name,
    date: today,
    status: "sent",
    discount_percent: 10,
    line_items: [{ name: "Design", quantity: 1, rate: 1000, gst_rate: 5 }],
    total: 1, // the server works out the total itself
  });
  assert.equal(q.status, 201, JSON.stringify(q.body));
  const quote = q.body.data.msg || q.body.data;
  assert.equal(quote.discount_amount, 100);
  assert.equal(quote.gst_total, 45);
  assert.equal(quote.total, 945);

  const edited = await api("put", `/api/v1/estimates/${quote.quote_id}?organization_id=${org}`, {
    line_items: [{ name: "Design", quantity: 2, rate: 1000, gst_rate: 5 }],
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.data.total, 1890, "2000 - 10% + 5% GST");

  const so = await api("post", `/api/v1/salesorders?organization_id=${org}`, {
    customer_id: customer.contact_id,
    customer_name: customer.contact_name,
    date: today,
    place_of_supply: "Karnataka",
    line_items: [{ name: "Hardware", quantity: 1, rate: 500, gst_rate: 28 }],
  });
  assert.equal(so.status, 200, JSON.stringify(so.body));
  assert.equal(so.body.data.igst_total, 140);
  assert.equal(so.body.data.total, 640);

  const conv = await api("post", `/api/v1/estimates/convert?organization_id=${org}&quote_id=${quote.quote_id}`, {});
  assert.equal(conv.status, 200, JSON.stringify(conv.body));
  const converted = await mongoose.model("Invoice").findOne({ invoice_id: conv.body.data.invoice?.invoice_id || conv.body.data.invoice_id }).lean()
    || await mongoose.model("Invoice").findOne({ organization_id: { $in: [org, String(org)] } }).sort({ _id: -1 }).lean();
  assert.equal(converted.total, 1890);
  assert.equal(converted.cgst_total + converted.sgst_total, 90);
  const cj = await journal(converted.journal_id);
  assert.equal(cj.posting_status, "draft", "converted invoices start as drafts");
  assert.equal(lineOf(cj, "AC_029").amount + lineOf(cj, "AC_030").amount, 90);
});

test("every journal balances", async () => {
  const all = await journals();
  assert.ok(all.length >= 8);
  for (const j of all) {
    let net = 0;
    for (const l of j.line_items) net += (l.creditOrDebit === "Debit" ? 1 : -1) * paise(l.amount);
    assert.equal(net, 0, `${j.type} ${j.journal_id} is out by ${net / 100}`);
  }
});

test("P&L counts only posted documents", async () => {
  const pl = await profitAndLoss();
  assert.equal(pl.operatingIncome, 23000, "sent invoices (draft/void excluded) less the credit note; GST is not income");
  assert.equal(pl.costOfGoodsSold, 3500, "open bill less the vendor credit");
  assert.equal(pl.operatingExpenses, 1500);
  assert.equal(pl.netProfitLoss, 18000);
});

test("balance sheet balances and agrees with the P&L", async () => {
  const bs = await balanceSheet();
  assert.equal(bs.checks.is_balanced, true, JSON.stringify(bs.totals));
  assert.equal(accountAmount(bs, "Accounts Receivable"), 5400 + 11800 + 2240);
  assert.equal(accountAmount(bs, "Output CGST"), 900);
  assert.equal(accountAmount(bs, "Output SGST"), 900);
  assert.equal(accountAmount(bs, "Output IGST"), 240);
  assert.equal(accountAmount(bs, "Accounts Payable"), 1100);
  assert.equal(accountAmount(bs, "TDS Payable"), 400);
  assert.equal(accountAmount(bs, "Petty Cash"), 6000 + 50000 - 2000 - 1500 - 400);
  assert.equal(bs.totals.assets, 57500 + 14040);
  assert.equal(bs.totals.liabilities_and_equity, 57500 + 14040);
});

test("dashboard cards show what's still unpaid", async () => {
  const res = await api("get", `/api/v1/kpi/summary?org_id=${org}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { receivables, payables } = res.body.data;
  assert.equal(receivables.total, 5400 + 14040, "draft and void invoices don't count; credits applied do");
  assert.equal(receivables.overdue, 0);
  assert.equal(payables.total, 2900, "draft bill doesn't count; credit and payments applied do");
});

test("a write keyed by a missing journal_id touches nothing", async () => {
  const Journal = mongoose.model("Journal");
  const before = await Journal.countDocuments({ organization_id: String(org) });
  await Journal.findOneAndUpdate({ journal_id: undefined, organization_id: String(org) }, { $set: { total_amount: -1 } });
  await Journal.findOneAndDelete({ journal_id: undefined, organization_id: String(org) });
  assert.equal(await Journal.countDocuments({ organization_id: String(org) }), before);
  assert.equal(await Journal.countDocuments({ total_amount: -1 }), 0);
});
