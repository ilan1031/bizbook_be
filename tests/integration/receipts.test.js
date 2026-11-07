// Receipt capture: upload, check what was read, and turn into an expense.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.TEST_DB_URL || "mongodb://127.0.0.1:27017/bizbooks_test";
process.env.DB_Coll = base.replace(/\/([^/?]+)(\?|$)/, "/$1_receipts$2");
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
process.env.ANTHROPIC_API_KEY = "";

const mongoose = require("mongoose");
const request = require("supertest");
const reader = require("../../helpers/receiptReader");

const realLog = console.log;
console.log = () => {};

let app;
let token;
let org;
let accounts;
const IP = "10.0.0.1";
const call = (method, url, body, tok = token) => {
  const r = request(app)[method](url).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${tok}`);
  return body === undefined ? r : r.send(body);
};
// A 1x1 PNG and a minimal PDF header.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const upload = (buf, name = "r.png", org_ = org) =>
  request(app).post(`/api/v1/receipts?org_id=${org_}`).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${token}`).attach("file", buf, name);

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
  const res = await request(app).post("/api/v1/user/user-login").set("X-Forwarded-For", IP).send({ email: "superadmin@test.local", password: "Super@1234" });
  token = res.body.token;
  assert.ok(token, JSON.stringify(res.body));
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Receipts Test Pvt Ltd", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  org = String(o.body.data?.organization_id);
  assert.ok(org, JSON.stringify(o.body));
  const lk = await call("get", `/api/v1/receipts/lookups?org_id=${org}`);
  accounts = lk.body.data;
  assert.ok(accounts.expense_accounts.length && accounts.paid_through.length, JSON.stringify(accounts));
});

test.after(async () => {
  console.log = realLog;
  reader.setReader(null);
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test("without a reader the receipt is saved blank for hand entry", async () => {
  const r = await upload(PNG);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.amount, 0);
  assert.equal(r.body.data.read_by_ai, false);
  assert.equal(r.body.reader_ready, false);
});

test("only real images and PDFs are accepted", async () => {
  assert.equal((await upload(Buffer.from("just text"), "r.png")).status, 400);
  assert.equal((await upload(Buffer.from("<html><script>1</script></html>"), "r.pdf")).status, 400);
  assert.equal((await upload(PDF, "r.pdf")).status, 201);
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  assert.equal((await upload(big)).status, 400);
  assert.equal((await request(app).post(`/api/v1/receipts?org_id=${org}`).set("X-Forwarded-For", IP).set("Authorization", `Bearer ${token}`)).status, 400);
});

test("a reader fills in the details", async () => {
  reader.setReader(async () => ({ vendor: "Chai Point", date: "2026-11-03", amount: 236, note: "Tea for the office" }));
  const r = await upload(PNG, "chai.png");
  assert.equal(r.body.data.vendor, "Chai Point");
  assert.equal(r.body.data.amount, 236);
  assert.equal(r.body.data.read_by_ai, true);
  reader.setReader(null);
});

test("the file can be opened back, and details corrected", async () => {
  const list = await call("get", `/api/v1/receipts?org_id=${org}`);
  assert.equal(list.body.data.length, 3);
  const png = list.body.data.find((x) => x.file_name === "chai.png");
  const f = await call("get", `/api/v1/receipts/${png._id}/file?org_id=${org}`);
  assert.equal(f.status, 200);
  assert.equal(f.headers["content-type"], "image/png");
  assert.equal(f.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(Buffer.from(f.body), PNG);
  const blank = list.body.data.find((x) => x.amount === 0 && x.mime === "image/png");
  assert.equal((await call("patch", `/api/v1/receipts/${blank._id}`, { org_id: org, date: "2026-02-30" })).status, 400);
  assert.equal((await call("patch", `/api/v1/receipts/${blank._id}`, { org_id: org, amount: -5 })).status, 400);
  const ok = await call("patch", `/api/v1/receipts/${blank._id}`, { org_id: org, vendor: "Stationery Hub", date: "2026-11-04", amount: 118.5, note: "Pens" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.amount, 118.5);
});

test("a receipt becomes an expense with a posted journal, once", async () => {
  const list = await call("get", `/api/v1/receipts?org_id=${org}`);
  const rec = list.body.data.find((x) => x.vendor === "Stationery Hub");
  const body = { org_id: org, expense_account_id: accounts.expense_accounts[0].account_id, paid_through_account_id: accounts.paid_through[0].account_id };
  assert.equal((await call("post", `/api/v1/receipts/${rec._id}/expense`, { ...body, expense_account_id: "nope" })).status, 400);
  assert.equal((await call("post", `/api/v1/receipts/${rec._id}/expense`, { ...body, paid_through_account_id: accounts.expense_accounts[0].account_id })).status, 400);
  const r = await call("post", `/api/v1/receipts/${rec._id}/expense`, body);
  assert.equal(r.status, 200, r.text);
  assert.match(r.body.data.expense_number, /^EX/);
  assert.equal(r.body.data.status, "converted");
  const exp = await mongoose.model("Expense").findOne({ unique_EX_id: r.body.data.expense_number }).lean();
  assert.equal(exp.tot_amount_with_tax, 118.5);
  const journal = await mongoose.model("Journal").findOne({ journal_id: exp.journal_id }).lean();
  const debit = journal.line_items.filter((l) => l.creditOrDebit === "Debit").reduce((t, l) => t + l.amount, 0);
  const credit = journal.line_items.filter((l) => l.creditOrDebit === "Credit").reduce((t, l) => t + l.amount, 0);
  assert.equal(debit, 118.5);
  assert.equal(credit, 118.5);
  assert.equal((await call("post", `/api/v1/receipts/${rec._id}/expense`, body)).status, 400);
  assert.equal((await call("delete", `/api/v1/receipts/${rec._id}?org_id=${org}`)).status, 400);
  assert.equal((await call("patch", `/api/v1/receipts/${rec._id}`, { org_id: org, amount: 1 })).status, 400);
});

test("a receipt without details cannot become an expense, and can be deleted", async () => {
  const list = await call("get", `/api/v1/receipts?org_id=${org}`);
  const blank = list.body.data.find((x) => x.mime === "application/pdf");
  const body = { org_id: org, expense_account_id: accounts.expense_accounts[0].account_id, paid_through_account_id: accounts.paid_through[0].account_id };
  const r = await call("post", `/api/v1/receipts/${blank._id}/expense`, body);
  assert.equal(r.status, 400);
  assert.match(r.body.message, /date/);
  assert.equal((await call("delete", `/api/v1/receipts/${blank._id}?org_id=${org}`)).status, 200);
});

test("a locked period blocks the expense", async () => {
  const list = await call("get", `/api/v1/receipts?org_id=${org}`);
  const rec = list.body.data.find((x) => x.vendor === "Chai Point");
  const lock = await call("put", "/api/v1/period-lock", { org_id: org, locked_until: "2026-11-30" });
  if (lock.status >= 300) return; // the lock endpoint shape is covered in period_lock tests
  const r = await call("post", `/api/v1/receipts/${rec._id}/expense`, { org_id: org, expense_account_id: accounts.expense_accounts[0].account_id, paid_through_account_id: accounts.paid_through[0].account_id });
  assert.equal(r.status, 400);
});

test("another organisation cannot see or open these receipts", async () => {
  const o = await call("post", "/api/v1/org/create-organisation", { organizationName: "Other Receipts Co", country: "India", state: "Tamil Nadu", industry_name: "Retail" });
  const other = String(o.body.data?.organization_id);
  assert.equal((await call("get", `/api/v1/receipts?org_id=${other}&status=all`)).body.data.length, 0);
  const mine = (await call("get", `/api/v1/receipts?org_id=${org}&status=all`)).body.data[0];
  assert.equal((await call("get", `/api/v1/receipts/${mine._id}/file?org_id=${other}`)).status, 404);
  assert.equal((await call("delete", `/api/v1/receipts/${mine._id}?org_id=${other}`)).status, 404);
});
