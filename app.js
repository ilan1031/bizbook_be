const createError = require("http-errors");
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const dotenv = require("dotenv");
const app = express();
dotenv.config({ path: path.join(__dirname, "../.env") });
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
const COA_Routes = require("./routes/COA_routes");
const journalRoutes = require("./routes/journalRoutes");
const ProfitAndLossRoutes = require("./routes/ProfitAndLossRoutes");

// const emailRoutes = require('./routes/emailRoutes');
// const itemRoutes = require("./routes/itemRoutes");
// const userRoutes = require("./routes/userRoutes");
// const orgRoutes = require("./routes/organisationRoutes");
// const contactRoutes = require("./routes/contactRoutes")

// Serve Swagger documentation
app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerSpec));

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(cors("*"));

app.use(function (req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", true);
  next();
});
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ limit: "500mb", extended: true }));

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

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  res.status(404).render("404", { title: " Sorry, page not found" });
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error", { title: "Error Page" });
});

module.exports = app;
