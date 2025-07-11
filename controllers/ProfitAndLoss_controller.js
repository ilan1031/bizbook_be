// controllers/profitLossController.js
const mongoose = require("mongoose");
const JournalCollection = mongoose.model("Journal");
const dayjs = require("dayjs");
const ST_CODES = require("../helpers/statusCodeHelpers");

class ProfitLossController {
//   async getProfitLossReport(req, res) {
//   try {
//     const admin_id = res.locals.user_id;
//     const organization_id = req.query.organization_id;
//     const from = req.query.from; // e.g. "2025-01-01"
//     const to = req.query.to; // e.g. "2025-07-31"

//     if (!admin_id || !organization_id) {
//       return res
//         .status(ST_CODES.BAD_REQUEST)
//         .json({ message: "Missing organization_id or admin_id" });
//     }

//     // Set default date range if not provided
//     const fromDate = from 
//       ? dayjs(from).startOf("day").toDate() 
//       : dayjs().startOf("month").toDate();
//     const toDate = to 
//       ? dayjs(to).endOf("day").toDate() 
//       : dayjs().endOf("month").toDate();

//     // Fetch journals with type Bill or Invoice
//     const journals = await JournalCollection.find({
//       organization_id,
//       admin_id,
//       journal_date: { $gte: fromDate, $lte: toDate },
//       type: { $in: ["Bill", "Invoice"] }
//     });

//     // Initialize response structure
//     const response = {
//       bills: {
//         totalDebits: 0,
//         totalDiscounts: 0,
//         netAmount: 0,
//         count: 0
//       },
//       invoices: {
//         totalCredits: 0,
//         totalDiscounts: 0,
//         netAmount: 0,
//         count: 0
//       }
//     };

//     // Process each journal entry
//     for (const journal of journals) {
//       if (journal.type === "Bill") {
//         response.bills.count++;
        
//         // Process line items for Bills
//         for (const line of journal.line_items) {
//           const amount = line.amount || 0;
          
//           // Sum all Debit amounts
//           if (line.creditOrDebit === "Debit") {
//             response.bills.totalDebits += amount;
//           }
          
//           // Sum Purchase Discount amounts (usually Credit)
//           if (line.coa_account_name === "Purchase Discount") {
//             response.bills.totalDiscounts += amount;
//           }
//         }
//       } 
//       else if (journal.type === "Invoice") {
//         response.invoices.count++;
        
//         // Process line items for Invoices
//         for (const line of journal.line_items) {
//           const amount = line.amount || 0;
          
//           // Sum all Credit amounts (Revenue/Sales)
//           if (line.creditOrDebit === "Credit") {
//             response.invoices.totalCredits += amount;
//           }
          
//           // 🔧 FIXED: Handle Sales/Invoice Discount properly
//           // Sales Discount is typically a Debit entry that reduces revenue
//           if ((line.coa_account_name === "Discount" || 
//                line.coa_account_name === "Discount") && 
//               line.creditOrDebit === "Debit") {
//             response.invoices.totalDiscounts += amount;
//           }
//         }
//       }
//     }

//     // Calculate net amounts
//     // For Bills: Net = Total Debits - Purchase Discounts
//     response.bills.netAmount = response.bills.totalDebits - response.bills.totalDiscounts;
    
//     // For Invoices: Net = Total Credits - Sales Discounts
//     response.invoices.netAmount = response.invoices.totalCredits - response.invoices.totalDiscounts;

//     // Round to 2 decimal places
//     response.bills.totalDebits = Math.round(response.bills.totalDebits * 100) / 100;
//     response.bills.totalDiscounts = Math.round(response.bills.totalDiscounts * 100) / 100;
//     response.bills.netAmount = Math.round(response.bills.netAmount * 100) / 100;
    
//     response.invoices.totalCredits = Math.round(response.invoices.totalCredits * 100) / 100;
//     response.invoices.totalDiscounts = Math.round(response.invoices.totalDiscounts * 100) / 100;
//     response.invoices.netAmount = Math.round(response.invoices.netAmount * 100) / 100;

//     // 🔧 Calculate Profit/Loss: Invoice Net Amount - Bill Net Amount
//     const profitLoss = response.invoices.netAmount - response.bills.netAmount;
//     const roundedProfitLoss = Math.round(profitLoss * 100) / 100;

//     res.status(ST_CODES.OK).json({
//       success: true,
//       data: {
//         ...response,
//         profit_loss: {
//           amount: roundedProfitLoss,
//           status: roundedProfitLoss >= 0 ? "Profit" : "Loss",
//           calculation: `Invoice Net (${response.invoices.netAmount}) - Bill Net (${response.bills.netAmount})`
//         }
//       },
//       dateRange: {
//         from: dayjs(fromDate).format("YYYY-MM-DD"),
//         to: dayjs(toDate).format("YYYY-MM-DD")
//       }
//     });

//   } catch (err) {
//     console.error("Profit & Loss Bill/Invoice Error:", err);
//     res
//       .status(ST_CODES.INTERNAL_SERVER_ERROR)
//       .json({ 
//         success: false,
//         message: "Error generating Bill/Invoice report" 
//       });
//   }
// }

async getProfitLossReport(req, res) {
  try {
    const admin_id = res.locals.user_id;
    const organization_id = req.query.organization_id;
    const from = req.query.from; // e.g. "2025-01-01"
    const to = req.query.to; // e.g. "2025-07-31"

    if (!admin_id || !organization_id) {
      return res
        .status(ST_CODES.BAD_REQUEST)
        .json({ message: "Missing organization_id or admin_id" });
    }

    // Set default date range if not provided
    const fromDate = from 
      ? dayjs(from).startOf("day").toDate() 
      : dayjs().startOf("month").toDate();
    const toDate = to 
      ? dayjs(to).endOf("day").toDate() 
      : dayjs().endOf("month").toDate();

    // Fetch journals with type Bill or Invoice
    const journals = await JournalCollection.find({
      organization_id,
      admin_id,
      journal_date: { $gte: fromDate, $lte: toDate },
      type: { $in: ["Bill", "Invoice"] }
    });

    // Initialize response structure
    const response = {
      bills: {
        totalDebits: 0,
        totalDiscounts: 0,
        netAmount: 0,
        count: 0,
        coa_accounts: {} // Track COA account details
      },
      invoices: {
        totalCredits: 0,
        totalDiscounts: 0,
        netAmount: 0,
        count: 0,
        coa_accounts: {} // Track COA account details
      }
    };

    // Process each journal entry
    for (const journal of journals) {
      if (journal.type === "Bill") {
        response.bills.count++;
        
        // Process line items for Bills
        for (const line of journal.line_items) {
          const amount = line.amount || 0;
          const accountId = line.coa_account_id;
          const accountName = line.coa_account_name;
          const creditOrDebit = line.creditOrDebit;
          
          // Initialize COA account if not exists
          if (!response.bills.coa_accounts[accountId]) {
            response.bills.coa_accounts[accountId] = {
              account_name: accountName,
              total_amount: 0,
              debit_amount: 0,
              credit_amount: 0,
              transaction_count: 0
            };
          }
          
          // Update COA account totals
          response.bills.coa_accounts[accountId].total_amount += amount;
          response.bills.coa_accounts[accountId].transaction_count++;
          
          if (creditOrDebit === "Debit") {
            response.bills.coa_accounts[accountId].debit_amount += amount;
            response.bills.totalDebits += amount;
          } else {
            response.bills.coa_accounts[accountId].credit_amount += amount;
          }
          
          // Sum Purchase Discount amounts (usually Credit)
          if (accountName === "Purchase Discount") {
            response.bills.totalDiscounts += amount;
          }
        }
      } 
      else if (journal.type === "Invoice") {
        response.invoices.count++;
        
        // Process line items for Invoices
        for (const line of journal.line_items) {
          const amount = line.amount || 0;
          const accountId = line.coa_account_id;
          const accountName = line.coa_account_name;
          const creditOrDebit = line.creditOrDebit;
          
          // Initialize COA account if not exists
          if (!response.invoices.coa_accounts[accountId]) {
            response.invoices.coa_accounts[accountId] = {
              account_name: accountName,
              total_amount: 0,
              debit_amount: 0,
              credit_amount: 0,
              transaction_count: 0
            };
          }
          
          // Update COA account totals
          response.invoices.coa_accounts[accountId].total_amount += amount;
          response.invoices.coa_accounts[accountId].transaction_count++;
          
          if (creditOrDebit === "Credit") {
            response.invoices.coa_accounts[accountId].credit_amount += amount;
            response.invoices.totalCredits += amount;
          } else {
            response.invoices.coa_accounts[accountId].debit_amount += amount;
          }
          
          // Handle Sales/Invoice Discount properly
          if ((accountName === "Sales Discount" || 
               accountName === "Invoice Discount") && 
              creditOrDebit === "Debit") {
            response.invoices.totalDiscounts += amount;
          }
        }
      }
    }

    // Calculate net amounts
    response.bills.netAmount = response.bills.totalDebits - response.bills.totalDiscounts;
    response.invoices.netAmount = response.invoices.totalCredits - response.invoices.totalDiscounts;

    // Round all amounts to 2 decimal places
    const roundAmount = (amount) => Math.round(amount * 100) / 100;
    
    response.bills.totalDebits = roundAmount(response.bills.totalDebits);
    response.bills.totalDiscounts = roundAmount(response.bills.totalDiscounts);
    response.bills.netAmount = roundAmount(response.bills.netAmount);
    
    response.invoices.totalCredits = roundAmount(response.invoices.totalCredits);
    response.invoices.totalDiscounts = roundAmount(response.invoices.totalDiscounts);
    response.invoices.netAmount = roundAmount(response.invoices.netAmount);

    // Round COA account amounts
    Object.keys(response.bills.coa_accounts).forEach(accountId => {
      const account = response.bills.coa_accounts[accountId];
      account.total_amount = roundAmount(account.total_amount);
      account.debit_amount = roundAmount(account.debit_amount);
      account.credit_amount = roundAmount(account.credit_amount);
    });

    Object.keys(response.invoices.coa_accounts).forEach(accountId => {
      const account = response.invoices.coa_accounts[accountId];
      account.total_amount = roundAmount(account.total_amount);
      account.debit_amount = roundAmount(account.debit_amount);
      account.credit_amount = roundAmount(account.credit_amount);
    });

    // Calculate Profit/Loss
    const profitLoss = response.invoices.netAmount - response.bills.netAmount;
    const roundedProfitLoss = roundAmount(profitLoss);

    res.status(ST_CODES.OK).json({
      success: true,
      data: {
        ...response,
        profit_loss: {
          amount: roundedProfitLoss,
          status: roundedProfitLoss >= 0 ? "Profit" : "Loss",
          calculation: `Invoice Net (${response.invoices.netAmount}) - Bill Net (${response.bills.netAmount})`
        }
      },
      dateRange: {
        from: dayjs(fromDate).format("YYYY-MM-DD"),
        to: dayjs(toDate).format("YYYY-MM-DD")
      }
    });

  } catch (err) {
    console.error("Profit & Loss Bill/Invoice Error:", err);
    res
      .status(ST_CODES.INTERNAL_SERVER_ERROR)
      .json({ 
        success: false,
        message: "Error generating Bill/Invoice report" 
      });
  }
}

}

module.exports = new ProfitLossController();
