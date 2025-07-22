const express = require("express");
const recurringExpenseController = require("../controllers/recurringExpenseController");
const authMiddleware = require("../middleware/userMiddleware");
const { upload } = require("../helpers/multer");
const router = express.Router();

// Create a recurring expense
router.post("/create-recurring-expense", authMiddleware, recurringExpenseController.createRecurringExpense);
// Get list of recurring expenses
router.get("/recurring-expense-list", authMiddleware, recurringExpenseController.getRecurringExpense);
// Get an individual recurring expense
router.get("/get-individual-recurring-expense", authMiddleware, recurringExpenseController.getIndiRecurringExpense);
// Update a recurring expense
router.post("/update-recurring-expense", authMiddleware, recurringExpenseController.updateRecurringExpense);
// Get child recurring expenses
router.get("/get-recurring-expense-child", authMiddleware, recurringExpenseController.getChildRecurringExpense);
// Update recurring expense status
router.post("/update-recurring-status", authMiddleware, recurringExpenseController.updateRecurringStatus);
// Delete a recurring expense
router.post("/delete-recurring-expense", authMiddleware, recurringExpenseController.deleteRecurringExpense);

module.exports = router;
