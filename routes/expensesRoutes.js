const express = require("express");
const expenseController = require("../controllers/expensesController");
const authMiddleware = require("../middleware/userMiddleware");
const { uploadExpense } = require("../helpers/multer");
const router = express.Router();

router.post(
  "/expense/create-expense",
  authMiddleware,
  uploadExpense.single("document"),
  expenseController.createExpense
);
// router.post(
//   "/expense/newexpense",
//   authMiddleware,
//   uploadExpense.single("document"),
//   expenseController.createExpense
// );
router.get(
  "/expense/get-expense",
  authMiddleware,
  expenseController.getExpense
);
router.get(
  "/expense/get-individual-expense",
  authMiddleware,
  expenseController.getIndividualExpense
);
router.put(
  "/expense/update-expense",
  authMiddleware,
  uploadExpense.single("document"),
  expenseController.updateExpense
);
router.post(
  "/expense/delete-expense",
  authMiddleware,
  expenseController.deleteExpense
);

module.exports = router;
