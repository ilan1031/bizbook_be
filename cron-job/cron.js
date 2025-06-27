const cron = require("node-cron");
const mongoose = require("mongoose");
const RecurringExpenseCollection = mongoose.model("Recurring_Expense");
const ExpenseCollection = mongoose.model("Expense");
const commonHelper = require("../helpers/commonHelpers");
const queryHelper = require("../helpers/query");
const BillCollection = mongoose.model("PO_bill");
const RecurringBillCollection = mongoose.model("recurringBill");

const recurringExpense = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize time

    const recurringExpenses = await RecurringExpenseCollection.find({
      status: "active",
      is_deleted: false,
    });

    const updatePromises = recurringExpenses.map(async (expense) => {
      const nextDate = new Date(expense.next_expense_date);
      const endDate = expense.end_date ? new Date(expense.end_date) : null;

      nextDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(0, 0, 0, 0);

      if (nextDate.getTime() === today.getTime()) {
        const { recurrence_frequency, repeat_every } = expense;
        const newNextDate = new Date(nextDate);

        switch (recurrence_frequency) {
          case "days":
            newNextDate.setDate(newNextDate.getDate() + repeat_every);
            break;
          case "weeks":
          case "week":
            newNextDate.setDate(newNextDate.getDate() + repeat_every * 7);
            break;
          case "month":
          case "months":
            newNextDate.setMonth(newNextDate.getMonth() + repeat_every);
            break;
          case "years":
            newNextDate.setFullYear(newNextDate.getFullYear() + repeat_every);
            break;
          default:
            console.warn(
              `Unknown recurrence frequency: ${recurrence_frequency}`
            );
            return;
        }
        // expense["date"] = today.toISOString().split("T")[0];
        // console.log(expense, "expense data");
        let expenseUniqueId = await commonHelper.generateUniqueId(
          ExpenseCollection,
          "unique_EX_id",
          5,
          "EX"
        );
        let expenseData = {
          vendor_id: expense.vendor_id,
          admin_id: expense.admin_id,
          organization_id: expense.organization_id,
          unique_EX_id: expenseUniqueId,
          paid_through_account_id: expense.paid_through_account_name,
          form_status: 0,
          date: today.toISOString().split("T")[0],
          invoice_number: expense.invoice_number,
          tot_amount: expense.total,
          tot_amount_with_tax: expense.total + expense.expense_tax_amount,
          expense_type: expense.expense_type,
          inclusive_exclusive: expense.inclusive_exclusive,
          base_amount: expense.base_amount,
          destination_of_supply: expense.destination_of_supply,
          source_of_supply: expense.source_of_supply,
          hsn_code: expense.hsn_code,
          sac_code: expense.sac_code,
          gst_treatment: expense.gst_treatment,
          vendor_gst_no: expense.vendor_gst_no,
          reverse_charge: expense.reverse_charge,
          expense_tax_percent: expense.expense_tax_percent,
          expense_tax_amount: expense.expense_tax_amount,
          lineItems: [
            {
              line_item_id: "",
              account_id: expense.account_name,
              description: expense.description,
              amount: expense.total,
            },
          ],
          customer_id: expense.customer_id,
          currency_id: expense.currency_id,
          type: "expense",
          status: 0,
          is_Billable: false,
        };
        const createdExpense = await queryHelper.insertData(
          ExpenseCollection,
          expenseData
        );
        // Add entry to item_list
        const itemEntry = {
          expense_id: createdExpense.msg._id,
          expense_number: expenseUniqueId, // Fallback if missing
          timestamp: new Date(),
        };

        await RecurringExpenseCollection.updateOne(
          { _id: expense._id },
          {
            $set: {
              next_expense_date: newNextDate,
              next_expense_date_formatted:
                commonHelper.formatDateString(newNextDate),
              status: "active",
              status_formatted: "ACTIVE",
            },
            $push: {
              item_list: itemEntry,
            },
          }
        );
      } else if (endDate && endDate.getTime() < today.getTime()) {
        await RecurringExpenseCollection.findOneAndUpdate(
          { _id: expense._id },
          {
            $set: {
              next_expense_date: null,
              next_expense_date_formatted: "",
              status: "expired",
              status_formatted: "EXPIRED",
            },
          }
        );
      }
    });

    await Promise.all(updatePromises);
  } catch (error) {
    console.error("recurringExpense error", error);
  }
};

const recurringBill = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize time

    // formatted the today date
    const todayFormatted =
      today.getFullYear() +
      "-" +
      String(today.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getDate()).padStart(2, "0");

    const recurringBill = await RecurringBillCollection.find({
      status: 0,
    });

    const updatePromises = recurringBill.map(async (bill) => {
      const nextDateFormatted = bill.next_bill_date;
      const endDate = bill.end_date || null;

      if (nextDateFormatted === todayFormatted) {
        const { recurrence_frequency, repeat_every } = bill;
        const nextDate = bill.next_bill_date;
        const newNextDate = new Date(nextDate);

        switch (recurrence_frequency) {
          case "days":
            newNextDate.setDate(newNextDate.getDate() + repeat_every);
            break;
          case "weeks":
          case "week":
            newNextDate.setDate(newNextDate.getDate() + repeat_every * 7);
            break;
          case "month":
          case "months":
            newNextDate.setMonth(newNextDate.getMonth() + repeat_every);
            break;
          case "years":
            newNextDate.setFullYear(newNextDate.getFullYear() + repeat_every);
            break;
          default:
            console.warn(
              `Unknown recurrence frequency: ${recurrence_frequency}`
            );
            return;
        }
        let billUniqueId = await commonHelper.generateUniqueId(
          BillCollection,
          "bill_number",
          5,
          "BL"
        );
        let billData = {
          vendor_id: bill.vendor_id,
          admin_id: bill.admin_id,
          organization_id: bill.organization_id,
          bill_number: billUniqueId,
          billDate: today.toISOString().split("T")[0],
          total: bill.total,
          taxAmount: bill.tax_amount,
          destination_of_supply: bill.destination_of_supply,
          source_of_supply: bill.source_of_supply,
          items: bill.items.map((item) => ({
            item_id: item.item_id || "",
            amount: item.amount || 0,
            details: item.details || "",
            rate: item.rate || 0,
            quantity: item.quantity || 1,
            discount: item.discount || 0,
            sku: item.sku || "",
            tax: item.tax || "",
          })),
          taxCategory: bill.tds_option,
          tdsOrTcs: bill.tax_type,
          subtotal: bill.sub_total,
          status: 0,
          status_type: "OPEN",
          adjustment: bill.adjustment,
          billing_address: bill.billing_address,
          recurring_bill_id: bill.recurring_bill_id,
        };
        const createdBill = await queryHelper.insertData(
          BillCollection,
          billData
        );

        const newNextDateFormatted =
            newNextDate.getFullYear() +
            "-" +
            String(newNextDate.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(newNextDate.getDate()).padStart(2, "0");

        await RecurringBillCollection.updateOne(
          { _id: bill._id },
          {
            $set: {
              next_bill_date: newNextDateFormatted,
              status_type: "active",
              last_modified_date: today.toISOString(),
            },
          }
        );
      } else if (endDate && endDate <= todayFormatted) {
        await RecurringBillCollection.findOneAndUpdate(
          { _id: bill._id },
          {
            $set: {
              next_bill_date: null,
              status: 2,
              status_type: "expired",
              last_modified_date: today.toISOString(),
            },
          }
        );
      }
    });

    await Promise.all(updatePromises);
  } catch (error) {
    console.error("recurringBill error", error);
  }
};

// Cron: Run once daily at 00:00 (midnight)
// cron.schedule("* * * * * *", function async() {
// cron.schedule("* * * * *", () => {
cron.schedule("0 0 * * *", () => {
  recurringExpense();
  recurringBill();
  console.log("Scheduled recurring expense task executed at midnight.");
});
