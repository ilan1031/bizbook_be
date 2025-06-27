const express = require("express");
const recurringExpenseController = require("../controllers/recurringExpenseController");
const authMiddleware = require("../middleware/userMiddleware");
const { upload } = require("../helpers/multer");
const router = express.Router();

router.post(
  "/create-recurring-expense",
  authMiddleware,
  recurringExpenseController.createRecurringExpense
);
router.get(
  "/recurring-expense-list",
  authMiddleware,
  recurringExpenseController.getRecurringExpense
);
router.get(
  "/get-individual-recurring-expense",
  authMiddleware,
  recurringExpenseController.getIndiRecurringExpense
);
router.post(
  "/update-recurring-expense",
  authMiddleware,
  recurringExpenseController.updateRecurringExpense
);
router.get(
  "/get-recurring-expense-child",
  authMiddleware,
  recurringExpenseController.getChildRecurringExpense
);
router.post(
  "/update-recurring-status",
  authMiddleware,
  recurringExpenseController.updateRecurringStatus
);
router.post(
  "/delete-recurring-expense",
  authMiddleware,
  recurringExpenseController.deleteRecurringExpense
);

module.exports = router;
