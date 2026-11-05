// Team roles: the built-in presets (in code) and the permission rules shared
// by custom roles, the org admin's ceiling and the runtime check.
//
// A role's permissions use the same shape as a user's:
//   { [pageKey]: ["view", "create", "edit", "delete", "convert"] }
// The grid a role is built from is the catalog in helpers/rbac.js, minus
// teamUsers (that is the org admin's own switch, never a role's).
const { PAGES } = require("./rbac");

const TEAM_SWITCH = "teamUsers";
// Features no preset gives: they belong to the org admin's own account.
const OWNER_ONLY_FEATURES = ["customerPortal", "imports", "assistant", TEAM_SWITCH];

const GRID = PAGES.filter((p) => !p.planned && p.key !== TEAM_SWITCH);
const GRID_BY_KEY = Object.fromEntries(GRID.map((p) => [p.key, p]));

const allActions = (keys) => Object.fromEntries(keys.map((k) => [k, [...GRID_BY_KEY[k].actions]]));
const viewOnly = (keys) => Object.fromEntries(keys.filter((k) => GRID_BY_KEY[k]).map((k) => [k, ["view"]]));
const keysIn = (...groups) => GRID.filter((p) => groups.includes(p.group)).map((p) => p.key);
const merge = (...parts) => Object.assign({}, ...parts);

// Everyday features that are safe to give to any team role.
const BASIC_FEATURES = viewOnly(["globalSearch", "notifications", "exportData", "quickCreate"]);

const SALES_DOCS = ["customers", "quotes", "salesOrders", "deliveryChallans", "invoices", "paymentsReceived", "recurringInvoices", "creditNotes"];
const PURCHASE_DOCS = ["vendors", "expenses", "recurringExpenses", "purchaseOrders", "bills", "paymentMade", "recurringBills", "vendorCredits"];

const PRESETS = [
  {
    key: "admin",
    name: "Admin",
    description: "Every page and feature of the business, except managing the team.",
    build: () => merge(allActions(GRID.map((p) => p.key))),
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Books, journals, reports, and all sales and purchase documents.",
    build: () =>
      merge(
        allActions(keysIn("Sales", "Purchase", "Accountant", "Inventory")),
        viewOnly(["home", "profitAndLoss", "balanceSheet", "journalReport", "inventoryValuation"]),
        allActions(["items", "chartOfAccounts", "journalEntries", "inventoryAdjustments"]),
        BASIC_FEATURES,
        { imports: ["view", "create"] }
      ),
  },
  {
    key: "sales",
    name: "Sales",
    description: "Customers and sales documents, with stock on hand to look at.",
    build: () => merge(allActions(SALES_DOCS), viewOnly(["home", "items", "inventory"]), BASIC_FEATURES),
  },
  {
    key: "purchase",
    name: "Purchase",
    description: "Vendors and purchase documents, with stock on hand to look at.",
    build: () => merge(allActions(PURCHASE_DOCS), viewOnly(["home", "items", "inventory"]), BASIC_FEATURES),
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Can look at the pages but change nothing.",
    build: () => viewOnly(GRID.map((p) => p.key).filter((k) => !OWNER_ONLY_FEATURES.includes(k))),
  },
];

const PRESET_BY_KEY = Object.fromEntries(PRESETS.map((p) => [p.key, p]));
const presetRole = (key) => {
  const p = PRESET_BY_KEY[key];
  return p ? { key: p.key, name: p.name, description: p.description, permissions: p.build() } : null;
};

// Keeps only grid pages and their valid actions; any action implies "view".
const normalize = (input) => {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const page of GRID) {
    const wanted = Array.isArray(input[page.key]) ? input[page.key] : [];
    let allowed = page.actions.filter((a) => wanted.includes(a));
    if (allowed.length && !allowed.includes("view")) allowed = ["view", ...allowed];
    if (allowed.length) out[page.key] = allowed;
  }
  return out;
};

// The most the org admin can give: their own permissions (the superadmin's
// grant), or everything when the admin is the superadmin.
const ownerCeiling = (owner) => {
  if (!owner) return {};
  if (owner.role === "superadmin") return normalize(allActions(GRID.map((p) => p.key)));
  return normalize(owner.permissions || {});
};

// A member's effective permissions: what their role gives AND what the org
// admin has. Never more than either.
const intersect = (rolePermissions, ceiling) => {
  const out = {};
  for (const page of GRID) {
    const granted = (rolePermissions?.[page.key] || []).filter((a) => (ceiling?.[page.key] || []).includes(a));
    if (granted.length) out[page.key] = granted;
  }
  return out;
};

// Validates a custom role's permissions against the org admin's ceiling.
// Returns { permissions } or { error } with the first problem in plain words.
const checkRolePermissions = (input, ceiling) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Choose the pages this role can use." };
  for (const key of Object.keys(input)) {
    if (!GRID_BY_KEY[key]) return { error: `"${key}" isn't a page or feature you can give to a role.` };
  }
  for (const page of GRID) {
    const wanted = Array.isArray(input[page.key]) ? input[page.key] : [];
    for (const action of wanted) {
      if (!page.actions.includes(action)) return { error: `${page.label} can't be given "${action}".` };
      if (!(ceiling[page.key] || []).includes(action)) {
        return { error: `Your account doesn't have ${action} access to ${page.label}, so you can't give it to a role.` };
      }
    }
  }
  const permissions = normalize(input);
  if (!Object.keys(permissions).length) return { error: "Give the role access to at least one page." };
  return { permissions };
};

// For the admin's screen: the grid as the browser shows it.
const gridForClient = () => GRID.map((p) => ({ key: p.key, label: p.label, group: p.group, actions: [...p.actions], apiOnly: Boolean(p.apiOnly) }));

module.exports = {
  TEAM_SWITCH,
  GRID,
  PRESETS: PRESETS.map((p) => ({ key: p.key, name: p.name, description: p.description })),
  presetRole,
  normalize,
  ownerCeiling,
  intersect,
  checkRolePermissions,
  gridForClient,
};
