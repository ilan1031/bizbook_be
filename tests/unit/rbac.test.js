const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PAGES,
  actionFor,
  checkApiAccess,
  sanitizePermissions,
  normalizeIp,
  getClientIp,
} = require("../../helpers/rbac");

const user = (permissions) => ({ role: "user", permissions });
const allowed = (u, method, path) => checkApiAccess(u, method, path) === null;

test("actionFor: HTTP method and legacy path verbs map to actions", () => {
  assert.equal(actionFor("GET", "/api/v1/invoices"), "view");
  assert.equal(actionFor("POST", "/api/v1/invoices"), "create");
  assert.equal(actionFor("PATCH", "/api/v1/invoices"), "edit");
  assert.equal(actionFor("PUT", "/api/v1/invoices/status"), "edit");
  assert.equal(actionFor("DELETE", "/api/v1/invoices"), "delete");
  // Legacy routes that use POST for reads/updates/deletes
  assert.equal(actionFor("POST", "/api/v1/expense/delete-expense"), "delete");
  assert.equal(actionFor("POST", "/api/v1/bills/update-status-void"), "edit");
  assert.equal(actionFor("POST", "/api/v1/org/get-organisation"), "view");
  assert.equal(actionFor("POST", "/api/v1/sales/export"), "view");
  // Removing an attachment edits the record
  assert.equal(actionFor("POST", "/api/v1/purchase-orders/remove-document"), "edit");
});

test("superadmin may do anything", () => {
  const sa = { role: "superadmin", permissions: {} };
  assert.ok(allowed(sa, "DELETE", "/api/v1/bills/delete-individual-bill"));
  assert.ok(allowed(sa, "GET", "/api/v1/anything/unmapped"));
});

test("page actions are enforced per page", () => {
  const u = user({ invoices: ["view", "create"] });
  assert.ok(allowed(u, "GET", "/api/v1/invoices?organization_id=1"));
  assert.ok(allowed(u, "POST", "/api/v1/invoices"));
  assert.ok(!allowed(u, "PATCH", "/api/v1/invoices"));
  assert.ok(!allowed(u, "DELETE", "/api/v1/invoices"));
  assert.ok(!allowed(u, "GET", "/api/v1/bills/get-bills"));
  assert.ok(!allowed(u, "GET", "/api/v1/reports/balance-sheet"));
});

test("lookups needed by forms are readable with any page, but not writable", () => {
  const u = user({ invoices: ["view"] });
  for (const path of [
    "/api/v1/customers",
    "/api/v1/contact/abc",
    "/api/v1/item/getitems",
    "/api/v1/COA/get-coa-list",
    "/api/v1/bills/get-vendors",
    "/api/v1/employee",
    "/api/v1/get-individual-journal",
    "/api/v1/taxes",
    "/api/v1/columns",
  ]) {
    assert.ok(allowed(u, "GET", path), `expected read of ${path}`);
  }
  assert.ok(!allowed(u, "POST", "/api/v1/contact"));
  assert.ok(!allowed(u, "DELETE", "/api/v1/items/1"));
  assert.ok(!allowed(u, "POST", "/api/v1/COA/add-coa"));
});

test("a user with no pages can only set up their company", () => {
  const u = user({});
  assert.ok(allowed(u, "POST", "/api/v1/org/create-organisation"));
  assert.ok(allowed(u, "GET", "/api/v1/user/me"));
  assert.ok(!allowed(u, "GET", "/api/v1/customers"));
  assert.ok(!allowed(u, "GET", "/api/v1/taxes"));
});

test("admin API and unknown routes are refused for normal users", () => {
  const full = user(Object.fromEntries(PAGES.map((p) => [p.key, p.actions])));
  assert.ok(!allowed(full, "GET", "/api/v1/admin/users"));
  assert.ok(!allowed(full, "GET", "/api/v1/not/a/route"));
});

test("sanitizePermissions drops unknown pages/actions and implies view", () => {
  const out = sanitizePermissions({
    invoices: ["create", "bogus"],
    notAPage: ["view"],
    profitAndLoss: ["view", "delete"], // reports are view-only
    bills: [],
  });
  assert.deepEqual(out, { invoices: ["view", "create"], profitAndLoss: ["view"] });
  assert.deepEqual(sanitizePermissions(null), {});
  assert.deepEqual(sanitizePermissions("x"), {});
});

test("every catalog page has a key, label, group, routes and valid actions", () => {
  const keys = new Set();
  for (const p of PAGES) {
    assert.ok(p.key && p.label && p.group, `incomplete page ${JSON.stringify(p)}`);
    assert.ok(!keys.has(p.key), `duplicate key ${p.key}`);
    keys.add(p.key);
    assert.ok(Array.isArray(p.routes) && p.routes.length);
    assert.ok(p.actions.every((a) => ["view", "create", "edit", "delete"].includes(a)));
  }
});

test("IP normalisation", () => {
  assert.equal(normalizeIp("::ffff:10.0.0.5"), "10.0.0.5");
  assert.equal(normalizeIp("::1"), "127.0.0.1");
  assert.equal(normalizeIp(" 203.0.113.9 "), "203.0.113.9");
  assert.equal(normalizeIp(undefined), "");
  assert.equal(getClientIp({ ip: "::ffff:1.2.3.4" }), "1.2.3.4");
  assert.equal(getClientIp({ socket: { remoteAddress: "::1" } }), "127.0.0.1");
});
