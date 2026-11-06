const express = require("express");
const expenseController = require("../controllers/expensesController");
const authMiddleware = require("../middleware/userMiddleware");
const periodLock = require("../helpers/periodLock");
const { uploadExpense } = require("../helpers/multer");
const router = express.Router();


// Create a new expense (with optional document upload)
router.post("/expense/create-expense", authMiddleware, uploadExpense.single("document"), periodLock.guard("expense"), expenseController.createExpense);
// router.post("/expense/newexpense", authMiddleware, uploadExpense.single("document"), expenseController.createExpense);
// Get all expenses
router.get("/expense/get-expense", authMiddleware, expenseController.getExpense);
// Get an individual expense by ID
router.get("/expense/get-individual-expense", authMiddleware, expenseController.getIndividualExpense);
// Update an expense (with optional document upload)
router.put("/expense/update-expense", authMiddleware, uploadExpense.single("document"), periodLock.guard("expense"), expenseController.updateExpense);
// Delete an expense
router.post("/expense/delete-expense", authMiddleware, periodLock.guard("expense"), expenseController.deleteExpense);

module.exports = router;
