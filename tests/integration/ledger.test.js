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
process.env.SMS_PROVIDER = "console";
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
  assert.equal(pl.operatingIncome, 12000, "edited sent invoice only (draft and void excluded)");
  assert.equal(pl.costOfGoodsSold, 4000, "open bill only");
  assert.equal(pl.operatingExpenses, 1500);
  assert.equal(pl.netProfitLoss, 6500);
});

test("balance sheet balances and agrees with the P&L", async () => {
  const bs = await balanceSheet();
  assert.equal(bs.checks.is_balanced, true, JSON.stringify(bs.totals));
  assert.equal(accountAmount(bs, "Accounts Receivable"), 6000);
  assert.equal(accountAmount(bs, "Accounts Payable"), 1600);
  assert.equal(accountAmount(bs, "TDS Payable"), 400);
  assert.equal(accountAmount(bs, "Petty Cash"), 6000 + 50000 - 2000 - 1500);
  assert.equal(bs.totals.assets, 58500);
  assert.equal(bs.totals.liabilities_and_equity, 58500);
});

test("dashboard cards show what's still unpaid", async () => {
  const res = await api("get", `/api/v1/kpi/summary?org_id=${org}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { receivables, payables } = res.body.data;
  assert.equal(receivables.total, 6000, "draft and void invoices don't count");
  assert.equal(receivables.overdue, 0);
  assert.equal(payables.total, 3600, "draft bill doesn't count");
});

test("a write keyed by a missing journal_id touches nothing", async () => {
  const Journal = mongoose.model("Journal");
  const before = await Journal.countDocuments({ organization_id: String(org) });
  await Journal.findOneAndUpdate({ journal_id: undefined, organization_id: String(org) }, { $set: { total_amount: -1 } });
  await Journal.findOneAndDelete({ journal_id: undefined, organization_id: String(org) });
  assert.equal(await Journal.countDocuments({ organization_id: String(org) }), before);
  assert.equal(await Journal.countDocuments({ total_amount: -1 }), 0);
});
