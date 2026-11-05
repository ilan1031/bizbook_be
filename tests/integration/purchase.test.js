// Purchase fixes (QA round 1): items and bills are only visible to their own
// organisation (PUR-10, PUR-18); expenses save without a vendor/customer and
// post balanced GST journals (PUR-1, PUR-2, PUR-17); a payment and the bills
// it pays are saved together, over-paying is refused and editing a payment
// doesn't apply it twice (PUR-3, PUR-4, PUR-24); bills are priced on the
// server (PUR-6, PUR-8); recurring bill profiles post no journal (PUR-9);
// in-use vendors and items can't be deleted (PUR-22).
//
// Runs against its own throwaway database (TEST_DB_URL + "_purchase").
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_purchase$2");
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
let bToken;
let orgA;
let orgA2; // a second organisation of the same owner
let orgB; // another business
let vendor;
const SA_IP = "203.0.113.30";
const B_IP = "10.30.0.2";
const today = new Date().toISOString().slice(0, 10);

const call = (method, url, { token, ip = SA_IP, body } = {}) => {
  const r = request(app)[method](url).set("X-Forwarded-For", ip);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return body === undefined ? r : r.send(body);
};
const asA = (method, url, body) => call(method, url, { token: saToken, body });
const asB = (method, url, body) => call(method, url, { token: bToken, ip: B_IP, body });
const paise = (n) => Math.round(Number(n || 0) * 100);
const journal = (journal_id) => mongoose.model("Journal").findOne({ journal_id }).lean();
const balanced = (j) => j.line_items.reduce((s, l) => s + (l.creditOrDebit === "Debit" ? 1 : -1) * paise(l.amount), 0) === 0;
const bill = (bill_number) => mongoose.model("PO_bill").findOne({ bill_number }).lean();

const newOrg = async (as, name) => {
  const o = await as("post", "/api/v1/org/create-organisation", { organizationName: name, country: "India", state: "Tamil Nadu", industry_name: "IT" });
  return String(o.body.data?.organization_id || o.body.organization_id);
};
const newBill = async (org, v, amount, extra = {}) => {
  const r = await asA("post", `/api/v1/bills/create-bills?org_id=${org}`, {
    status: 0,
    vendor_id: v._id,
    vendorName: v.contact_name,
    billDate: today,
    items: [{ item_name: "Line", quantity: 1, rate: amount, amount }],
    ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.body.data.bill_number;
};

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
  orgA = await newOrg(asA, "Buyer A");
  orgA2 = await newOrg(asA, "Buyer A2");

  const B = { companyName: "B Co", email: "pb@test.local", password: "Bpass@1234", phoneNumber: "9123456781", country: "India", state: "Kerala", agreeToTerms: true };
  await call("post", "/api/v1/user/user-register", { ip: B_IP, body: B });
  const bId = String((await mongoose.model("user").findOne({ email: B.email }).lean())._id);
  const all = ["view", "create", "edit", "delete"];
  await asA("patch", `/api/v1/admin/users/${bId}`, { status: "active", permissions: { items: all, bills: all, vendors: all } });
  const bl = await call("post", "/api/v1/user/user-login", { ip: B_IP, body: { email: B.email, password: B.password } });
  assert.equal(bl.status, 200, bl.text);
  bToken = bl.body.token;
  orgB = await newOrg(asB, "Buyer B");

  const v = await asA("post", "/api/v1/contact", {
    organization_id: orgA,
    contact_type: "Vendor",
    contact_name: "Steel Supplies",
    company_name: "Steel Supplies",
    place_of_contact: "Tamil Nadu",
  });
  assert.ok(v.status < 300, v.text);
  vendor = await mongoose.model("Contact").findOne({ organization_id: orgA, contact_type: "Vendor" }).lean();
});

test.after(async () => {
  console.log = realLog;
  await mongoose.disconnect();
});

test("PUR-10: another business can't read an item by its id", async () => {
  const r = await asA("post", "/api/v1/items/newitems", { organization_id: orgA, name: "Secret Item", rate: 100, purchase_rate: 80 });
  assert.ok(r.status < 300, r.text);
  const item = await mongoose.model("Item").findOne({ organization_id: orgA, name: "Secret Item" }).lean();
  const leak = await asB("get", `/api/v1/item/singleitems/${item.item_id}?organization_id=${orgB}`);
  assert.equal(leak.status, 404, leak.text);
  assert.doesNotMatch(leak.text, /Secret/);
  const sameOwnerOtherOrg = await asA("get", `/api/v1/item/singleitems/${item.item_id}?organization_id=${orgA2}`);
  assert.equal(sameOwnerOtherOrg.status, 404);
  const own = await asA("get", `/api/v1/item/singleitems/${item.item_id}?organization_id=${orgA}`);
  assert.equal(own.status, 200, own.text);
});

test("PUR-26: negative item prices are refused", async () => {
  const r = await asA("post", "/api/v1/items/newitems", { organization_id: orgA, name: "Negative", rate: -50, purchase_rate: -40 });
  assert.equal(r.status, 400, r.text);
});

test("PUR-18: a bill can't be opened from another organisation of the same owner", async () => {
  const n = await newBill(orgA, vendor, 999);
  const r = await asA("get", `/api/v1/bills/get-individual-bill?org_id=${orgA2}&bill_id=${n}`);
  assert.equal(r.status, 404, r.text);
  const own = await asA("get", `/api/v1/bills/get-individual-bill?org_id=${orgA}&bill_id=${n}`);
  assert.equal(own.status, 200);
});

test("PUR-14: a non-numeric organisation id is a bad request, not an expired session", async () => {
  const r = await asA("get", `/api/v1/bills/get-bills?org_id=undefined`);
  assert.equal(r.status, 400);
  assert.notEqual(r.body.message, "Invalid or expired token.");
});

test("PUR-1/2/17: expenses save without vendor/customer and post balanced GST journals", async () => {
  const base = {
    type: "expense",
    date: today,
    paid_through_account_id: "AC_017",
    paid_through_account_name: "Petty Cash",
    vendor_id: "",
    customer_id: "",
    lineItems: [{ account_id: "AC_051", account_name: "Travel Expense", amount: "1000" }],
    gst_treatment: "Registered Business - Regular",
  };
  // Exclusive, same state: CGST + SGST on top.
  const ex = await asA("post", `/api/v1/expense/create-expense?org_id=${orgA}`, {
    ...base,
    inclusive_exclusive: "exclusive",
    expense_tax_percent: "GST18 [18%]",
    source_of_supply: "TN",
    destination_of_supply: "TN",
    tot_amount_with_tax: 5, // ignored: the server works it out
  });
  assert.equal(ex.status, 201, ex.text);
  assert.equal(ex.body.data.tot_amount_with_tax, 1180);
  const j1 = await journal(ex.body.data.journal_id);
  assert.ok(balanced(j1));
  assert.equal(j1.line_items.find((l) => l.coa_account_id === "AC_012").amount, 90);
  assert.equal(j1.line_items.find((l) => l.coa_account_id === "AC_013").amount, 90);

  // Inclusive, other state: IGST taken out of the amount.
  const inc = await asA("post", `/api/v1/expense/create-expense?org_id=${orgA}`, {
    ...base,
    inclusive_exclusive: "inclusive",
    expense_tax_percent: "IGST18 [18%]",
    source_of_supply: "KA",
    destination_of_supply: "TN",
  });
  assert.equal(inc.status, 201, inc.text);
  const j2 = await journal(inc.body.data.journal_id);
  assert.ok(balanced(j2));
  assert.equal(j2.line_items.find((l) => l.coa_account_id === "AC_051").amount, 847.46);
  assert.equal(j2.line_items.find((l) => l.coa_account_id === "AC_011").amount, 152.54);

  // Bad input: refused, and no journal is left behind.
  const before = await mongoose.model("Journal").countDocuments({ organization_id: orgA });
  const bad = await asA("post", `/api/v1/expense/create-expense?org_id=${orgA}`, { ...base, lineItems: [{ account_id: "AC_051", amount: "-5" }] });
  assert.equal(bad.status, 400, bad.text);
  assert.equal(await mongoose.model("Journal").countDocuments({ organization_id: orgA }), before);
});

test("PUR-6/8: bills are priced on the server (GST per line, % discount, TDS, TCS)", async () => {
  const n = await newBill(orgA, vendor, 0, {
    items: [
      { item_name: "A", quantity: 3, rate: 33.33, amount: 1, gst_rate: 18 },
      { item_name: "A", quantity: 1, rate: 50, amount: 1, gst_rate: 18 },
    ],
    discount_percent: 10,
    tax_type: "TDS",
    tax_percentage: 2,
    total: 1,
  });
  const b = await bill(n);
  assert.equal(b.items.length, 2, "two lines of the same item are both kept");
  assert.equal(b.sub_total, 149.99);
  assert.equal(b.discount_amount, 15);
  assert.equal(b.tax_amount, 2.7);
  assert.equal(b.gst_total, 24.3);
  assert.equal(b.total, 156.59);
  assert.equal(b.due_amt, 156.59);
  const j = await journal(b.journal_id);
  assert.ok(balanced(j));

  const tcs = await bill(await newBill(orgA, vendor, 1000, { tax_type: "TCS", tax_percentage: 1 }));
  assert.equal(tcs.total, 1010, "TCS adds to what's owed");
  const tj = await journal(tcs.journal_id);
  assert.ok(balanced(tj));
  assert.equal(tj.line_items.find((l) => l.coa_account_name === "TCS Receivable").creditOrDebit, "Debit");
});

test("PUR-3/4/24: payments apply to bills atomically; over-paying is refused; editing doesn't re-apply", async () => {
  const n = await newBill(orgA, vendor, 1000);
  const b0 = await bill(n);
  const payments = () => mongoose.model("Payment").countDocuments({ organization_id: orgA });
  const journals = () => mongoose.model("Journal").countDocuments({ organization_id: orgA });
  const [p0, j0] = [await payments(), await journals()];

  const over = await asA("post", `/api/v1/payments/made?organization_id=${orgA}`, {
    contact_id: String(vendor._id),
    payment_type: "BillPayment",
    amount: 5000,
    date: today,
    paid_through_account_id: "AC_017",
    bills: [{ bill_id: String(b0._id), amount_applied: 5000 }],
  });
  assert.equal(over.status, 400, over.text);
  assert.equal(await payments(), p0, "no payment saved");
  assert.equal(await journals(), j0, "no journal posted");

  const pay = await asA("post", `/api/v1/payments/made?organization_id=${orgA}`, {
    contact_id: String(vendor._id),
    payment_type: "BillPayment",
    amount: 300,
    date: today,
    paid_through_account_id: "AC_017",
    bills: [{ bill_id: String(b0._id), amount_applied: 300 }],
  });
  assert.equal(pay.status, 200, pay.text);
  assert.ok(pay.body.data.payment_id, "the server numbers the payment");
  assert.equal(pay.body.data.status_type, "PAID");
  let b1 = await bill(n);
  assert.equal(b1.due_amt, 700);
  assert.equal(b1.status_type, "PARTIALLY PAID");

  const pid = pay.body.data.payment_id;
  const edit = await asA("put", `/api/v1/payments/update?organization_id=${orgA}&payment_id=${pid}`, {
    amount: 300,
    payment_type: "vendor",
    bills: [{ bill_id: String(b0._id), amount_applied: 300 }],
  });
  assert.equal(edit.status, 200, edit.text);
  b1 = await bill(n);
  assert.equal(b1.due_amt, 700, "saving an unchanged payment leaves the bill as it was");
  assert.equal(b1.payment_made, 300);
  assert.equal(edit.body.data.payment_type, "BillPayment");

  const del = await asA("delete", `/api/v1/payments/delete?organization_id=${orgA}&payment_id=${pid}`);
  assert.equal(del.status, 200, del.text);
  b1 = await bill(n);
  assert.equal(b1.due_amt, 1000);
  assert.equal(b1.status_type, "OPEN");
});

test("PUR-9: a recurring bill profile posts no journal", async () => {
  const before = await mongoose.model("Journal").countDocuments({ organization_id: orgA, type: "Recurring Bill" });
  const r = await asA("post", `/api/v1/recurring-bill/create?org_id=${orgA}`, {
    vendor_id: String(vendor._id),
    recurrence_name: "Monthly rent",
    repeat_every: 1,
    recurrence_frequency: "months",
    start_date: today,
    is_expired: true,
    status: 0,
    line_items: [{ name: "Rent", account: "Rent Expense", quantity: 1, rate: 250, amount: 250 }],
    sub_total: 250,
    total: 250,
  });
  assert.ok(r.status < 300, r.text);
  assert.ok(!r.body.data?.journal_id);
  assert.equal(await mongoose.model("Journal").countDocuments({ organization_id: orgA, type: "Recurring Bill" }), before);
});

test("PUR-22: a vendor with unpaid bills and an item on a bill can't be deleted", async () => {
  const item = await mongoose.model("Item").findOne({ organization_id: orgA, name: "Secret Item" }).lean();
  await newBill(orgA, vendor, 100, { items: [{ item_id: item.item_id, item_name: "Secret Item", quantity: 1, rate: 100 }] });
  const dv = await asA("delete", `/api/v1/contact?organization_id=${orgA}&contact_id=${vendor.contact_id}`);
  assert.equal(dv.status, 400, dv.text);
  const di = await asA("delete", `/api/v1/items/${item.item_id}?organization_id=${orgA}`);
  assert.equal(di.status, 400, di.text);
});

test("every purchase journal balances", async () => {
  const all = await mongoose.model("Journal").find({ organization_id: orgA }).lean();
  assert.ok(all.length >= 5);
  for (const j of all) assert.ok(balanced(j), `${j.type} ${j.journal_id} doesn't balance`);
});
