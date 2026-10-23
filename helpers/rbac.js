// Role-based access control.
//
// One catalog of pages drives everything: the superadmin's permission matrix,
// which sidebar entries/routes a user sees (sent to the frontend via
// GET /api/v1/user/me), and which API calls a user may make (enforced in
// middleware/userMiddleware.js). Permissions are stored on the user as
//   { [pageKey]: ["view", "create", "edit", "delete", "convert"] }
// "convert" exists only on documents that turn into others (quote ->
// invoice / sales order, sales order -> invoice, challan -> invoice).

const ACTIONS = ["view", "create", "edit", "delete"];
const VIEW_ONLY = ["view"];
const WITH_CONVERT = [...ACTIONS, "convert"];
const ALL_ACTIONS = WITH_CONVERT;

// `routes` are frontend path prefixes (matched on whole path segments).
const PAGES = [
  { key: "home", label: "Dashboard", group: "General", routes: ["/home"], actions: VIEW_ONLY },
  { key: "items", label: "Items", group: "General", routes: ["/items", "/item"] },
  { key: "banking", label: "Banking", group: "General", routes: ["/banking"], planned: true },

  { key: "customers", label: "Customers", group: "Sales", routes: ["/sales/customer"] },
  { key: "quotes", label: "Quotes", group: "Sales", routes: ["/sales/quotes", "/print/quote"], actions: WITH_CONVERT },
  { key: "salesOrders", label: "Sales Orders", group: "Sales", routes: ["/sales/salesOrder"], actions: WITH_CONVERT },
  { key: "deliveryChallans", label: "Delivery Challans", group: "Sales", routes: ["/sales/deliveryChallan"], actions: WITH_CONVERT },
  { key: "invoices", label: "Invoices", group: "Sales", routes: ["/sales/invoices", "/print/invoice"] },
  { key: "paymentsReceived", label: "Payments Received", group: "Sales", routes: ["/sales/paymentsReceived"] },
  { key: "recurringInvoices", label: "Recurring Invoices", group: "Sales", routes: ["/sales/recurringInvoice"] },
  { key: "creditNotes", label: "Credit Notes", group: "Sales", routes: ["/sales/creditNotes"] },

  { key: "vendors", label: "Vendors", group: "Purchase", routes: ["/purchase/vendor"] },
  { key: "expenses", label: "Expenses", group: "Purchase", routes: ["/purchase/expense"] },
  { key: "recurringExpenses", label: "Recurring Expenses", group: "Purchase", routes: ["/purchase/recurringexpenses"] },
  { key: "purchaseOrders", label: "Purchase Orders", group: "Purchase", routes: ["/purchase/purchaseorder"] },
  { key: "bills", label: "Bills", group: "Purchase", routes: ["/purchase/bills"] },
  { key: "paymentMade", label: "Payments Made", group: "Purchase", routes: ["/purchase/paymentmade"] },
  { key: "recurringBills", label: "Recurring Bills", group: "Purchase", routes: ["/purchase/recurringbills"] },
  { key: "vendorCredits", label: "Vendor Credits", group: "Purchase", routes: ["/purchase/vendorcredits"] },

  { key: "timesheets", label: "Timesheets", group: "Time Tracking", routes: ["/time/timesheets"], planned: true },
  { key: "projects", label: "Projects", group: "Time Tracking", routes: ["/time/projects"], planned: true },

  { key: "chartOfAccounts", label: "Chart of Accounts", group: "Accountant", routes: ["/accountant/chartOfAccounts"] },
  { key: "journalEntries", label: "Journal Entries", group: "Accountant", routes: ["/accountant/journals"] },

  { key: "profitAndLoss", label: "Profit and Loss", group: "Reports", routes: ["/reports/profitandloss"], actions: VIEW_ONLY },
  { key: "balanceSheet", label: "Balance Sheet", group: "Reports", routes: ["/reports/balancesheet"], actions: VIEW_ONLY },
  { key: "journalReport", label: "Journal Report", group: "Reports", routes: ["/reports/journalreport"], actions: VIEW_ONLY },

  // Features: switched on per user like pages. apiOnly ones have no screen
  // of their own (they're buttons, menus or behaviour inside other screens).
  { key: "tally", label: "Classic view & toggle", group: "Features", routes: ["/tally"] },
  { key: "imports", label: "Import Data", group: "Features", routes: ["/import", "/import-files"], actions: ["view", "create"] },
  { key: "assistant", label: "AI Assistant", group: "Features", routes: ["/bot"], actions: VIEW_ONLY },
  // Lets the user invite customers to the customer portal; while it's off,
  // that user's customers can't use the portal either.
  { key: "customerPortal", label: "Customer Portal", group: "Features", routes: [], apiOnly: true, actions: ["view", "create"] },
  { key: "templates", label: "Invoice & Quote Templates", group: "Features", routes: ["/settings/templates"], actions: ["view", "edit"] },
  { key: "quickCreate", label: "Quick Create (+) menu", group: "Features", routes: [], apiOnly: true, actions: VIEW_ONLY },
  { key: "globalSearch", label: "Global Search", group: "Features", routes: [], apiOnly: true, actions: VIEW_ONLY },
  { key: "notifications", label: "Notifications", group: "Features", routes: [], apiOnly: true, actions: VIEW_ONLY },
  { key: "bulkActions", label: "Bulk Actions on lists", group: "Features", routes: [], apiOnly: true, actions: VIEW_ONLY },
  { key: "exportData", label: "Export & Print", group: "Features", routes: [], apiOnly: true, actions: VIEW_ONLY },
  { key: "documents", label: "Documents", group: "Other", routes: ["/documents"], planned: true },
  { key: "payroll", label: "Payroll", group: "Other", routes: ["/payroll"], planned: true },
  { key: "configure", label: "Configure Features", group: "Other", routes: ["/configure"], planned: true },
].map((p) => ({ actions: ACTIONS, ...p }));

const PAGE_KEYS = new Set(PAGES.map((p) => p.key));

// Pages that exist in the app today. "Planned" modules (no screens yet) stay
// in PAGES so their API rules keep working, but they aren't offered in the
// permission matrix or the sidebar.
const CATALOG = PAGES.filter((p) => !p.planned);

// Frontend routes every logged-in, active user may open regardless of page
// permissions (own company setup), and helper routes that belong to whatever
// page a user is working in (allowed once they have any page at all).
const ALWAYS_ALLOWED_ROUTES = ["/organisation", "/organization-list", "/no-access", "/profile"];
const SHARED_ROUTES = ["/common"];

// Feature switches that apply on top of the page rules below: a request
// matching one of these also needs that feature (and action).
const FEATURE_RULES = [
  { re: /^\/api\/v1\/user\/search$/, feature: "globalSearch", action: "view" },
  { re: /^\/api\/v1\/user\/notifications$/, feature: "notifications", action: "view" },
  { re: /^\/api\/v1\/(sales|purchase|common)\/export$/, feature: "exportData", action: "view" },
  { re: /^\/api\/v1\/org\/templates(\/|$)/, methods: ["PUT", "POST", "PATCH", "DELETE"], feature: "templates", action: "edit" },
];

// Backend API rules, checked in order; the first match wins.
//   pages: [...]  - needs the action on ANY of these pages
//   open: true    - any logged-in active user (account / company setup)
//   shared: true  - any user who has been granted at least one page
//                   (lookups used by many forms: dropdowns, columns, email)
const API_RULES = [
  { re: /^\/api\/v1\/(user|client)\//, open: true },
  { re: /^\/api\/v1\/(verify-token|verifyEmail)$/, open: true },
  { re: /^\/api\/v1\/(org|organization)(\/|$)/, open: true },

  { re: /^\/api\/v1\/kpi\//, pages: ["home"] },
  // Lookups that document forms need for their dropdowns (customers,
  // vendors, items, employees...) are readable by anyone with at least one
  // page (sharedRead); changing them still needs the page itself.
  { re: /^\/api\/v1\/items?(\/|$)/, pages: ["items"], sharedRead: true },

  // Contacts serve both customers and vendors.
  { re: /^\/api\/v1\/customers$/, pages: ["customers"], sharedRead: true },
  { re: /^\/api\/v1\/(bills|purchase-orders)\/get-vendors$/, pages: ["vendors"], sharedRead: true },
  { re: /^\/api\/v1\/vendors(\/|$)/, pages: ["vendors"], sharedRead: true },
  { re: /^\/api\/v1\/vendor(\/|$)/, pages: ["vendors", "bills", "purchaseOrders"] },
  { re: /^\/api\/v1\/(contact|contacts|contact-person|individual-contact-person)(\/|$)/, pages: ["customers", "vendors"], sharedRead: true },

  { re: /^\/api\/v1\/(estimates|estimate-id|estimate|clientestimates)(\/|$)/, pages: ["quotes"] },
  { re: /^\/api\/v1\/import\/quote$/, pages: ["quotes"] },
  { re: /^\/api\/v1\/import\/customers$/, pages: ["customers"], action: "create" },
  { re: /^\/api\/v1\/import\/vendors$/, pages: ["vendors"], action: "create" },
  { re: /^\/api\/v1\/import\/items$/, pages: ["items"], action: "create" },
  { re: /^\/api\/v1\/ask$/, pages: ["assistant"], action: "view" },
  { re: /^\/api\/v1\/(invoices|invoice-id|invoice)(\/|$)/, pages: ["invoices"] },
  { re: /^\/api\/v1\/(salesorders|sales-order)(\/|$)|^\/api\/v1\/sales\/unique-id$/, pages: ["salesOrders"] },
  { re: /^\/api\/v1\/sales\/export$/, pages: ["customers", "quotes", "salesOrders", "deliveryChallans", "invoices", "paymentsReceived", "recurringInvoices", "creditNotes"], action: "view" },
  { re: /^\/api\/v1\/(deliverychallans|delivery-challans|deliveryunique-id|deliverychallan)(\/|$)/, pages: ["deliveryChallans"] },
  { re: /^\/api\/v1\/payment(\/|$)/, pages: ["paymentsReceived"] },
  { re: /^\/api\/v1\/RecurringInvoices(\/|$)/, pages: ["recurringInvoices"] },
  { re: /^\/api\/v1\/credit-notes(\/|$)/, pages: ["creditNotes"] },
  { re: /^\/api\/v1\/salesperson(\/|$)/, pages: ["quotes", "salesOrders", "invoices", "deliveryChallans"], sharedRead: true },

  { re: /^\/api\/v1\/bills(\/|$)|^\/api\/v1\/import\/import-bills$/, pages: ["bills"] },
  { re: /^\/api\/v1\/(purchase-orders|purchaseorders|purchaseorder)(\/|$)|^\/api\/v1\/import\/purchase-order$/, pages: ["purchaseOrders"] },
  { re: /^\/api\/v1\/purchase\/export$/, pages: ["vendors", "expenses", "purchaseOrders", "bills", "paymentMade", "recurringBills", "recurringExpenses", "vendorCredits"], action: "view" },
  { re: /^\/api\/v1\/expense(\/|$)/, pages: ["expenses"] },
  { re: /^\/api\/v1\/recurring-expense(\/|$)/, pages: ["recurringExpenses"] },
  { re: /^\/api\/v1\/recurring-bill(\/|$)/, pages: ["recurringBills"] },
  { re: /^\/api\/v1\/vendor-credits(\/|$)/, pages: ["vendorCredits"] },
  { re: /^\/api\/v1\/(payments|payment-email)(\/|$)/, pages: ["paymentMade"] },
  { re: /^\/api\/v1\/employee(\/|$)/, pages: ["payroll", "expenses"], sharedRead: true }, // mileage form adds employees

  // Account lists feed dropdowns everywhere; changing accounts needs the page.
  { re: /^\/api\/v1\/COA\/(coa-list-view|coa-details|get-coa-transaction)$/, pages: ["chartOfAccounts"] },
  { re: /^\/api\/v1\/COA\//, pages: ["chartOfAccounts"], sharedRead: true },
  { re: /^\/api\/v1\/manual-journals(\/|$)/, pages: ["journalEntries"] },
  // A document's own journal entry is shown on its detail page.
  { re: /^\/api\/v1\/get-individual-journal$/, pages: ["journalReport", "journalEntries"], action: "view", sharedRead: true },
  { re: /^\/api\/v1\/get-journal$/, pages: ["journalReport", "journalEntries"], action: "view" },
  { re: /^\/api\/v1\/reports\/profit-loss\//, pages: ["profitAndLoss"], action: "view" },
  { re: /^\/api\/v1\/reports\/balance-sheet$/, pages: ["balanceSheet"], action: "view" },

  { re: /^\/api\/v1\/email\/(invite-portal|verify-invite)$/, pages: ["customerPortal"], action: "create" },
  { re: /^\/api\/v1\/(taxes|tax|columns|email|common|import\/get-column)(\/|$)/, shared: true },
];

// Which action an API call performs. Many legacy routes use POST for reads,
// updates and deletes, so the path wins over the HTTP method.
const actionFor = (method, path) => {
  const p = path.toLowerCase();
  // Removing an attachment edits the record rather than deleting it.
  if (/remove-document|additional-address/.test(p)) return "edit";
  if (method === "DELETE" || /(^|[/-])(delete|remove)([/-]|$)/.test(p)) return "delete";
  if (/(^|[/-])convert([/-]|$)/.test(p)) return "convert";
  if (/(^|[/-])(export|logs|get)([/-]|$)/.test(p) || method === "GET") return "view";
  if (method === "PUT" || method === "PATCH" ||
      /(update|edit|status|apply|refund|void|draft|primary|address|comment|document|resend)/.test(p))
    return "edit";
  return "create";
};

const userPerms = (user) => (user && user.permissions) || {};
const hasAction = (user, page, action) =>
  Array.isArray(userPerms(user)[page]) && userPerms(user)[page].includes(action);
const hasAnyPage = (user) =>
  Object.values(userPerms(user)).some((a) => Array.isArray(a) && a.length > 0);

const cleanPath = (rawPath) => rawPath.split("?")[0].replace(/\/+$/, "") || "/";

// The page rule a request falls under and the action it performs, e.g.
// { page: "invoices", action: "create" } - used for the create limits.
const classifyRequest = (method, rawPath) => {
  const path = cleanPath(rawPath);
  const rule = API_RULES.find((r) => r.re.test(path));
  if (!rule || !rule.pages) return null;
  return { page: rule.pages[0], action: rule.action || actionFor(method, path) };
};

// Returns null when allowed, otherwise a short reason.
const checkApiAccess = (user, method, rawPath) => {
  if (user.role === "superadmin") return null;
  const path = cleanPath(rawPath);
  const gate = FEATURE_RULES.find((r) => r.re.test(path) && (!r.methods || r.methods.includes(method)));
  if (gate && !hasAction(user, gate.feature, gate.action)) {
    const label = PAGES.find((p) => p.key === gate.feature)?.label || gate.feature;
    return `${label} isn't switched on for your account`;
  }
  const rule = API_RULES.find((r) => r.re.test(path));
  if (!rule) return "This action isn't available to your account";
  if (rule.open) return null;
  if (rule.shared) return hasAnyPage(user) ? null : "No pages have been assigned to your account";
  const action = rule.action || actionFor(method, path);
  if (rule.pages.some((page) => hasAction(user, page, action))) return null;
  if (rule.sharedRead && action === "view" && hasAnyPage(user)) return null;
  return `You don't have permission to ${action} this`;
};

// Validates and normalises a permissions object sent by the superadmin.
const sanitizePermissions = (input) => {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const page of PAGES) {
    const actions = Array.isArray(input[page.key]) ? input[page.key] : [];
    let allowed = page.actions.filter((a) => actions.includes(a));
    // Any action implies being able to open the page.
    if (allowed.length && !allowed.includes("view")) allowed = ["view", ...allowed];
    if (allowed.length) out[page.key] = allowed;
  }
  return out;
};

// Client IP. Behind a proxy (Render, etc.) set TRUST_PROXY so Express reads
// X-Forwarded-For; without it, req.ip is the socket address.
const normalizeIp = (ip) => {
  if (!ip) return "";
  const v = String(ip).trim();
  if (v === "::1") return "127.0.0.1";
  return v.startsWith("::ffff:") ? v.slice(7) : v;
};
const getClientIp = (req) => normalizeIp(req.ip || req.socket?.remoteAddress);

module.exports = {
  ACTIONS,
  ALL_ACTIONS,
  PAGES,
  CATALOG,
  PAGE_KEYS,
  ALWAYS_ALLOWED_ROUTES,
  SHARED_ROUTES,
  actionFor,
  classifyRequest,
  checkApiAccess,
  sanitizePermissions,
  getClientIp,
  normalizeIp,
};
