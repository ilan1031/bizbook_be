const createError = require("http-errors");
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const dotenv = require("dotenv");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const app = express();
// Note: app.js lives at the backend project root, so its own .env is just
// "./.env" here — not "../.env" (that was pointing one directory too high,
// at the repo root). It worked before only because config/config.js later
// loaded the correct path itself; fixed here so JWT_SECRET (and everything
// else) is reliably available as soon as app.js needs it.
dotenv.config({ path: path.join(__dirname, ".env") });

// Every auth token in this app is signed with JWT_SECRET — refuse to boot
// without one so we never silently sign tokens with `undefined`, and refuse
// to boot in production with an obviously-default/weak value.
const weakJwtSecrets = ["dev-local-secret", "secret", "changeme", "jwtsecret"];
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error(
    "FATAL: JWT_SECRET is missing or too short (min 16 chars). Set a strong, random JWT_SECRET in .env before starting the server."
  );
  process.exit(1);
}
// Account email (sign-in codes, sign-up and approval notices): say clearly
// when it can't be delivered.
{
  const { isMailConfigured, mailTarget, fromAddress } = require("./helpers/mailer");
  const everyLogin = (process.env.LOGIN_OTP_MODE || "every_login") === "every_login";
  if (isMailConfigured()) {
    if (process.env.LOGIN_OTP_ENABLED === "true") {
      console.log(`Sign-in codes by email (${fromAddress()} via ${mailTarget()}), ${everyLogin ? "on every login" : "for new devices"}.`);
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn("WARNING: email isn't set up (EMAIL_USER + EMAIL_PASS, or BREVO_API_KEY / RESEND_API_KEY + EMAIL_FROM_ADDRESS): no sign-in codes, sign-up alerts or approval emails will be sent.");
  } else {
    console.warn("NOTE: email isn't set up: emails (including sign-in codes) are printed in this log.");
  }
}
if (
  process.env.NODE_ENV === "production" &&
  weakJwtSecrets.includes(process.env.JWT_SECRET)
) {
  console.error(
    "FATAL: JWT_SECRET is set to a known placeholder value — generate a real secret before running in production."
  );
  process.exit(1);
}

// SO
const swaggerUI = require("swagger-ui-express");
const swaggerSpec = require("./swagger");

require("./config/db_connection");
// common_BEO
require("./model/organizationSchema");
require("./model/taxExemptionSchema");
require("./model/columnsModel");
require("./model/clientSchema");

// SO
require("./model/soContactModel ");
require("./model/Salesperson");
require("./model/contactPerson");
require("./model/recurringInvoice");
// PO
require("./model/Item");
require("./model/usersSchema");
require("./model/contactModel");
require("./model/billsSchema");
require("./model/purchaseOrder");
require("./model/expenseModel");
require("./model/paymentSchema");
require("./model/userActivitySchema");
require("./model/recurringExpenseSchema");
require("./model/recurringBillModel");
require("./model/EmployeeModel");
require("./model/chartOfAccountsModel");
require("./model/journalSchema");
require("./model/withholdingTaxSchema");
require("./model/creditDocumentModels");
require("./model/coa_transactionSchema");
require("./model/teamMemberSchema");
require("./model/teamRoleSchema");
require("./model/teamAuditSchema");

require("./cron/recurringInvoiceCron");
require("./cron-job/cron");

// Common Routes
const itemRoutes = require("./routes/itemRoutes");
const userRoutes = require("./routes/userRoutes");
const orgRoutes = require("./routes/organisationRoutes");
const contactRoutes = require("./routes/contactRoutes");
const taxRoutes = require("./routes/taxExemptionRoutes");
const contactPersonRoutes = require("./routes/contactPersonRoutes");
const exportRoutes = require("./routes/exportRoutes");
const verifyToken = require("./routes/verifyToken");
const commonRoutes = require("./routes/commonRoutes");
const importRoutes = require("./routes/importRoutes");
const verifyEmail = require("./routes/verifyEmail");

// SO ROUTES

const quoteRoutes = require("./routes/quoteRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const salesorderRoutes = require("./routes/salesorderRoutes");
const deliveryChallanRoutes = require("./routes/deliveryChallanRoutes");
const emailRoutes = require("./routes/emailRoutes");
const soExportRoutes = require("./routes/soExportRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const soImportRoutes = require("./routes/soImportRoutes");
const salesRoutes = require("./routes/salespersonRoutes");
const recurringInvoiceRoutes = require("./routes/recurringInvoiceRoutes");

// PO Routes

const billsRoutes = require("./routes/billesRoutes");
const purchaseOrderRoutes = require("./routes/purchaseOrderRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const poEmailRoutes = require("./routes/poEmailRoutes");
const expenseRoutes = require("./routes/expensesRoutes");
const poExportRoutes = require("./routes/poExportRoutes");
const poImportRoutes = require("./routes/poImportRoutes");
const poPaymentRoutes = require("./routes/poPaymentRoutes");
const recurringExpenseRoute = require("./routes/recurringExpenseRoutes");
const recurringBillRoutes = require("./routes/recurringBillRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const creditDocumentRoutes = require("./routes/creditDocumentRoutes");
const COA_Routes = require("./routes/COA_routes");
const journalRoutes = require("./routes/journalRoutes");
const ProfitAndLossRoutes = require("./routes/ProfitAndLossRoutes");
const manualJournalRoutes = require("./routes/manualJournalRoutes");
const balanceSheetRoutes = require("./routes/balanceSheetRoutes");
const adminRoutes = require("./routes/adminRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const teamRoutes = require("./routes/teamRoutes");

// const emailRoutes = require('./routes/emailRoutes');
// const itemRoutes = require("./routes/itemRoutes");
// const userRoutes = require("./routes/userRoutes");
// const orgRoutes = require("./routes/organisationRoutes");
// const contactRoutes = require("./routes/contactRoutes")

// Serve Swagger documentation
// Swagger exposes the entire API surface (routes, params, models) — keep it
// out of anything but local development.
if (process.env.NODE_ENV !== "production") {
  app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerSpec));
}

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
// A wildcard origin ("*") cannot legally be combined with
// Access-Control-Allow-Credentials: true — browsers reject that combination,
// but it's a landmine (the previous code did both at once). Reflect an
// allow-listed origin instead so credentialed cross-origin requests stay
// restricted to our own frontend(s).
// FRONTEND_URL (and PORTAL_URL, the customer portal) may list several
// origins separated by commas (e.g. the Vercel production URL and a preview
// URL); an entry may use "*" for one hostname label, like
// https://*.vercel.app. See helpers/hostingConfig.js.
const { trustProxySetting, originMatchers, isOriginAllowed } = require("./helpers/hostingConfig");
const allowedOrigins = originMatchers();

// Behind a reverse proxy (Render, etc.) the client's IP arrives in
// X-Forwarded-For, and Express must be told to trust it: TRUST_PROXY sets the
// number of proxy hops (Render: 1, and that's the default there). Left off
// anywhere else, otherwise clients could fake the IP the per-user allow-list
// relies on.
const proxySetting = trustProxySetting();
if (proxySetting !== undefined) app.set("trust proxy", proxySetting);

const warnedOrigins = new Set();
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser tools (curl, server-to-server) with no Origin header.
      if (isOriginAllowed(origin, allowedOrigins)) return callback(null, true);
      // Not an error: the browser just gets no CORS headers and blocks the
      // call. Say once which origin to add, instead of a stack trace per request.
      if (!warnedOrigins.has(origin)) {
        warnedOrigins.add(origin);
        console.warn(`CORS: blocked requests from ${origin}. If that is your frontend, add it to FRONTEND_URL (comma-separated).`);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Device-Id"],
  })
);

// Health check for the hosting platform (Render's healthCheckPath).
app.get("/api-health", (req, res) => {
  const dbUp = require("mongoose").connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? "connected" : "disconnected" });
});

app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

// Basic security headers (CSP disabled — this app serves its own EJS/Swagger
// views, and a default CSP would break them without more tuning).
app.use(helmet({ contentSecurityPolicy: false }));

// General API rate limit — slows down brute-forcing and body-size abuse
// since nothing else in the app currently limits request volume.
// Signed-in requests are counted per user and address (so a whole office
// behind one NAT address doesn't share one budget); anonymous ones per IP.
// Limits per 15 minutes, configurable:
//   RATE_LIMIT_USER_MAX (default 3000), RATE_LIMIT_IP_MAX (default 1500),
//   AUTH_RATE_LIMIT_MAX (failed sign-in/sign-up attempts, default 20).
const envInt = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const rateLimitUser = (req) => {
  if (req._rateLimitUser !== undefined) return req._rateLimitUser;
  let id = null;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token && process.env.JWT_SECRET) {
    try {
      const decoded = require("jsonwebtoken").verify(token, process.env.JWT_SECRET);
      if (decoded?.userId) id = `${decoded.role || "admin"}:${decoded.userId}`;
    } catch (e) {
      id = null;
    }
  }
  req._rateLimitUser = id;
  return id;
};
app.use(
  "/api/v1",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: (req) => (rateLimitUser(req) ? envInt("RATE_LIMIT_USER_MAX", 3000) : envInt("RATE_LIMIT_IP_MAX", 1500)),
    keyGenerator: (req) => {
      const user = rateLimitUser(req);
      // Per signed-in user per address: people behind one office address
      // each get their own budget, and one user's devices don't share one.
      const ip = rateLimit.ipKeyGenerator(req.ip || "");
      return user ? `user:${user}@${ip}` : `ip:${ip}`;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: "RATE_LIMITED", message: "Too many requests. Please wait a minute and try again." },
  })
);

// Tighter limit on login/register specifically, to slow credential stuffing
// and account-enumeration attempts. Only failed attempts count, so people
// signing in normally never use it up.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => envInt("AUTH_RATE_LIMIT_MAX", 20),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Too many attempts, please try again later." },
});
app.use(
  [
    "/api/v1/user/user-login",
    "/api/v1/user/user-register",
    "/api/v1/user/verify-login-otp",
    "/api/v1/client/login",
    "/api/v1/client/register",
    "/api/v1/client/forgot-password",
    "/api/v1/client/reset-password",
    "/api/v1/user/change-password",
    "/api/v1/client/change-password",
  ],
  authLimiter
);

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
// Attachments are shown by the front end, which runs on another origin, so
// they may be embedded cross-origin (helmet's default is same-origin only).
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "uploads"))
);

// Assign routes COMMON BEO
app.use("/api/v1", userRoutes);
app.use("/api/v1", orgRoutes);
app.use("/api/v1", itemRoutes);
app.use("/api/v1", contactRoutes);
app.use("/api/v1", taxRoutes);
app.use("/api/v1", contactPersonRoutes);
app.use("/api/v1/import", importRoutes);
app.use("/api/v1/common", exportRoutes);
app.use("/api/v1", commonRoutes);
app.use("/api/v1", verifyToken);
app.use("/api/v1", verifyEmail);

// Assign routes SO
app.use("/api/v1", quoteRoutes);
app.use("/api/v1", invoiceRoutes);
app.use("/api/v1", salesorderRoutes);
app.use("/api/v1", deliveryChallanRoutes);
app.use("/api/v1/email", emailRoutes);
app.use("/api/v1/sales", soExportRoutes);
app.use("/api/v1/", paymentRoutes);
app.use("/api/v1/import", soImportRoutes);
app.use("/api/v1", salesRoutes);
app.use("/api/v1", recurringInvoiceRoutes);

// PO
// view engine setup
// Assign routes
// app.use("/api/v1", userRoutes);
// app.use("/api/v1", orgRoutes);
// app.use("/api/v1", itemRoutes);
// app.use("/api/v1",contactRoutes)
app.use("/api/v1/", billsRoutes);
app.use("/api/v1/", purchaseOrderRoutes);
app.use("/api/v1/", vendorRoutes);
app.use("/api/v1/email/", poEmailRoutes);
app.use("/api/v1/", expenseRoutes);
app.use("/api/v1/purchase", poExportRoutes);
app.use("/api/v1/import", poImportRoutes);
app.use("/api/v1/", poPaymentRoutes);
app.use("/api/v1/recurring-expense/", recurringExpenseRoute);
app.use("/api/v1/", recurringBillRoutes);
app.use("/api/v1", employeeRoutes);
app.use("/api/v1/kpi", dashboardRoutes);
app.use("/api/v1/COA", COA_Routes);
app.use("/api/v1", journalRoutes);  
app.use("/api/v1", ProfitAndLossRoutes);
app.use("/api/v1", manualJournalRoutes);
app.use("/api/v1", balanceSheetRoutes);
app.use("/api/v1", creditDocumentRoutes);
app.use("/api/v1", adminRoutes);
app.use("/api/v1", inventoryRoutes);
app.use("/api/v1", teamRoutes);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

app.use(function (err, req, res, next) {
  // Upload problems (file too large, too many files) are the user's input.
  if (err && err.name === "MulterError" && !err.status) {
    err.status = 400;
    if (err.code === "LIMIT_FILE_SIZE") err.message = "The file is too large (10 MB at most).";
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`${req.method} ${req.originalUrl}:`, err);
  // API callers get JSON; never leak internals on server errors.
  if (req.originalUrl.startsWith("/api")) {
    return res.status(status).json({
      status: false,
      message: status === 404 ? "Not found" : status >= 500 ? "Something went wrong" : err.message,
    });
  }
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(status);
  res.render("error", { title: "Error Page" });
});

module.exports = app;
