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
// Sign-in codes go by SMS, else email; say clearly when neither can deliver.
if (process.env.LOGIN_OTP_ENABLED === "true") {
  const sms = require("./helpers/smsHelper");
  const { isMailConfigured } = require("./helpers/mailer");
  const channels = [sms.canDeliver() && `SMS (${sms.provider()})`, isMailConfigured() && "email"].filter(Boolean);
  if (channels.length) {
    console.log(`Sign-in codes: ${channels.join(", then ")}${process.env.LOGIN_OTP_MODE === "every_login" ? ", on every login" : ", for new devices"}.`);
  } else if (process.env.NODE_ENV === "production") {
    console.warn("WARNING: LOGIN_OTP_ENABLED is on but neither SMS nor email is set up, so sign-in codes are off. Set SMS_PROVIDER (e.g. smsgate) or EMAIL_USER/EMAIL_PASS.");
  } else {
    console.warn("NOTE: no SMS provider or email set up: sign-in codes are printed in this log.");
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
// FRONTEND_URL may list several origins separated by commas
// (e.g. the Vercel production URL and a preview URL).
const allowedOrigins = [
  ...String(process.env.FRONTEND_URL || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  "http://localhost:3000",
];

// Behind a reverse proxy (Render, etc.) the client's IP arrives in
// X-Forwarded-For. TRUST_PROXY tells Express how many proxy hops to trust
// (Render: 1). Leave it unset when not behind a proxy, otherwise clients
// could fake their IP - which the per-user IP allow-list relies on.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser tools (curl, server-to-server) with no Origin header.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
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
app.use(
  "/api/v1",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    // Per client IP; each page makes several API calls.
    max: 1500,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Tighter limit on login/register specifically, to slow credential stuffing
// and account-enumeration attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again later." },
});
app.use(
  [
    "/api/v1/user/user-login",
    "/api/v1/user/user-register",
    "/api/v1/user/verify-login-otp",
    "/api/v1/client/login",
    "/api/v1/client/register",
  ],
  authLimiter
);

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

app.use(function (err, req, res, next) {
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
