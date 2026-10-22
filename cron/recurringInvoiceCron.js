const cron = require("node-cron");
const RecurringInvoiceCollection = require("../model/recurringInvoice");
const InvoiceCollection = require("../model/invoice");
const commonHelper = require("../helpers/commonHelpers");
const queryHelper = require("../helpers/query");
const { postInvoiceJournal } = require("../helpers/invoiceHelper");
const emailHelper = require("../helpers/emailHelper");

const processRecurringInvoices = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize time to start of day
    // Format today's date consistently
    const todayFormatted =
      today.getFullYear() +
      "-" +
      String(today.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getDate()).padStart(2, "0");
    console.log(
      `[${new Date().toISOString()}] Running recurring invoice job for date: ${todayFormatted}`
    );
    const recurringInvoices = await RecurringInvoiceCollection.find({
      status: "active",
    });
    console.log(
      `Found ${recurringInvoices.length} recurring invoices for processing`
    );
    // Process each recurring invoice using Promise.all pattern like bills
    const updatePromises = recurringInvoices.map(async (recurringInvoice) => {
      try {
        // Format dates consistently for comparison
        const nextDateFormatted = recurringInvoice.next_invoice_date; // Assuming this is already in YYYY-MM-DD format
        const endDateFormatted = recurringInvoice.end_date || null; // Assuming this is already in YYYY-MM-DD format

        console.log(
          `Checking invoice ${recurringInvoice.recurring_invoice_id}:`
        );
        console.log(`Today: ${todayFormatted}`);
        console.log(`Next Date: ${nextDateFormatted}`);
        console.log(`End Date: ${endDateFormatted}`);

        // Check if invoice is due today using string comparison
        if (nextDateFormatted === todayFormatted) {
          console.log(
            `Processing recurring invoice: ${recurringInvoice.recurring_invoice_id}`
          );

          const { recurrence_frequency, repeat_every } = recurringInvoice;

          // Create Date object from the next_invoice_date for calculation
          const nextDate = new Date(recurringInvoice.next_invoice_date);
          const newNextDate = new Date(nextDate);

          // Calculate next date using native Date methods
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

          // Format the new next date consistently
          const newNextDateFormatted =
            newNextDate.getFullYear() +
            "-" +
            String(newNextDate.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(newNextDate.getDate()).padStart(2, "0");

          // Generate unique invoice ID
          let invoiceNumber = await commonHelper.generateUniqueId(
            InvoiceCollection,
            "invoice_number",
            6,
            "INV"
          );
          let invoiceId = await commonHelper.generateUniqueId(
            InvoiceCollection,
            "invoice_id",
            6
          );

          // Calculate due date if offset is provided
          let dueDateFormatted = todayFormatted;
          if (recurringInvoice.due_date_offset) {
            const dueDate = new Date(today);
            dueDate.setDate(
              dueDate.getDate() + recurringInvoice.due_date_offset
            );
            dueDateFormatted =
              dueDate.getFullYear() +
              "-" +
              String(dueDate.getMonth() + 1).padStart(2, "0") +
              "-" +
              String(dueDate.getDate()).padStart(2, "0");
          }

          // Process line items with complete structure
          let processedLineItems = [];
          let subTotal = 0;

          if (
            recurringInvoice.line_items &&
            recurringInvoice.line_items.length > 0
          ) {
            processedLineItems = recurringInvoice.line_items.map((item) => {
              // Generate line item ID if not provided
              const lineItemId =
                item.line_item_id ||
                Math.random().toString(36).substring(2, 15);

              // Calculate line total
              const quantity = item.quantity || 1;
              const rate = item.rate || 0;
              const lineTotal = quantity * rate;

              subTotal += lineTotal;

              return {
                line_item_id: lineItemId,
                item_id: item.item_id || "",
                name: item.details || item.name || "",
                rate: rate,
                quantity: quantity,
                item_total: lineTotal,
                item_total_formatted: `₹${lineTotal.toFixed(2)}`,
                item_total_inclusive_of_tax: lineTotal,
                item_total_inclusive_of_tax_formatted: `₹${lineTotal.toFixed(
                  2
                )}`,
                discount: item.discount || 0,
                sku: item.sku || "",
                tax: item.tax || "",
                tags: Array.isArray(item.tags)
                  ? item.tags.filter(
                      (tag) =>
                        typeof tag.tag_id === "number" &&
                        typeof tag.tag_option_id === "number"
                    )
                  : [],
                progress_invoice_details: {
                  invoiced_quantity: 0,
                  invoiced_quantity_formatted: "0.00",
                  invoiced_value: 0,
                  invoiced_value_formatted: "₹0.00",
                  balance_amount: lineTotal,
                  balance_amount_formatted: `₹${lineTotal.toFixed(2)}`,
                  is_invoiced: false,
                },
              };
            });
          }

          // Calculate discount
          let discountAmount = 0;
          const discountType = recurringInvoice.discount_type || "";
          const discountPercent = recurringInvoice.discount_percent || 0;
          const discountAmountValue = recurringInvoice.discount_amount || 0;

          if (discountType === "percentage" && discountPercent) {
            discountAmount = (subTotal * discountPercent) / 100;
          } else if (discountAmountValue) {
            discountAmount = discountAmountValue;
          }

          const subTotalAfterDiscount = subTotal - discountAmount;

          // Calculate tax amount
          let taxTotal = 0;
          if (recurringInvoice.taxes && recurringInvoice.taxes.length > 0) {
            recurringInvoice.taxes.forEach((tax) => {
              const taxBase = recurringInvoice.is_discount_before_tax
                ? subTotalAfterDiscount
                : subTotal;
              const taxAmount = (taxBase * (tax.tax_percentage || 0)) / 100;
              tax.tax_amount = taxAmount.toFixed(2);
              taxTotal += taxAmount;
            });
          }

          // Calculate final total
          const shippingCharge = recurringInvoice.shipping_charge || 0;
          const adjustment = recurringInvoice.adjustment || 0;
          const total =
            subTotal - discountAmount + taxTotal + shippingCharge + adjustment;

          // Calculate balance
          const paymentMade = recurringInvoice.payment_made || 0;
          const creditsApplied = recurringInvoice.credits_applied || 0;
          const balance = total - paymentMade - creditsApplied;

          // Create invoice data structure with all required fields
          let invoiceData = {
            // Basic identifiers
            invoice_id: invoiceId,
            invoice_number: invoiceNumber,
            customer_id: recurringInvoice.customer_id,
            organization_id: recurringInvoice.organization_id,

            // User tracking
            created_by_id: recurringInvoice.created_by_id,
            last_modified_by_id: recurringInvoice.created_by_id,

            // Status
            status: "draft",
            status_formatted: "Draft",

            // Dates
            date: today.toISOString(),
            date_formatted: new Date(today).toLocaleDateString("en-GB"),
            due_date: new Date(dueDateFormatted).toISOString(),
            due_date_formatted: new Date(dueDateFormatted).toLocaleDateString(
              "en-GB"
            ),
            created_date: today.toISOString(),

            // Customer and business details
            customer_name: recurringInvoice.customer_name || "",
            place_of_supply: recurringInvoice.place_of_supply || "",
            order_number: recurringInvoice.order_number || "",

            // Tax and VAT details
            vat_treatment: recurringInvoice.vat_treatment || "",
            tax_treatment: recurringInvoice.tax_treatment || "",
            is_reverse_charge_applied:
              recurringInvoice.is_reverse_charge_applied || false,
            gst_treatment: recurringInvoice.gst_treatment || "",
            gst_no: recurringInvoice.gst_no || "",
            cfdi_usage: recurringInvoice.cfdi_usage || "",

            // Reference details
            reference_number: recurringInvoice.reference_number || "",
            invoiced_estimate_id: recurringInvoice.invoiced_estimate_id || "",
            salesperson_name: recurringInvoice.salesperson_name || "",

            // Payment settings
            allow_partial_payments:
              recurringInvoice.allow_partial_payments || false,
            payment_terms: recurringInvoice.payment_terms || "",
            payment_terms_label: recurringInvoice.payment_terms_label || "",

            // Custom fields
            custom_body: recurringInvoice.custom_body || "",
            custom_subject: recurringInvoice.custom_subject || "",

            // Financial calculations
            sub_total: subTotal,
            sub_total_formatted: `₹${subTotal.toFixed(2)}`,
            bcy_sub_total: subTotal,
            sub_total_exclusive_of_discount: subTotalAfterDiscount,
            sub_total_exclusive_of_discount_formatted: `₹${subTotalAfterDiscount.toFixed(
              2
            )}`,

            // Discount details
            discount_amount: discountAmount,
            discount_amount_formatted: `₹${discountAmount.toFixed(2)}`,
            discount_percent: discountPercent,
            discount_total: discountAmount,
            discount_total_formatted: `₹${discountAmount.toFixed(2)}`,
            bcy_discount_total: discountAmount,
            discount_type: discountType,
            is_discount_before_tax:
              recurringInvoice.is_discount_before_tax || false,

            // Tax details
            tax_total: taxTotal,
            tax_total_formatted: `₹${taxTotal.toFixed(2)}`,
            bcy_tax_total: taxTotal,
            tax_amount: taxTotal,
            taxes: recurringInvoice.taxes || [],
            tax_type: recurringInvoice.tax_type || "",

            // Shipping and adjustments
            shipping_charge: shippingCharge,
            adjustment: adjustment,
            adjustment_description:
              recurringInvoice.adjustment_description || "",

            // Totals
            total: total,
            total_formatted: `₹${total.toFixed(2)}`,
            bcy_total: total,
            balance: balance,
            balance_formatted: `₹${balance.toFixed(2)}`,

            // Payment tracking
            payment_made: paymentMade,
            credits_applied: creditsApplied,

            // Line items
            line_items: processedLineItems,

            // Additional fields
            reason: recurringInvoice.reason || "",
            tax_authority_id: recurringInvoice.tax_authority_id || "",
            tax_exemption_id: recurringInvoice.tax_exemption_id || "",
            billing_address_id: recurringInvoice.billing_address_id || "",
            shipping_address_id: recurringInvoice.shipping_address_id || "",
            avatax_use_code: recurringInvoice.avatax_use_code || "",
            avatax_exempt_no: recurringInvoice.avatax_exempt_no || "",
            tax_id: recurringInvoice.tcs_id || recurringInvoice.tds_id || "",
            expense_id: recurringInvoice.expense_id || "",
            salesorder_item_id: recurringInvoice.salesorder_item_id || "",
            avatax_tax_code: recurringInvoice.avatax_tax_code || "",
            time_entry_ids: recurringInvoice.time_entry_ids || [],
            tds_option: recurringInvoice.tds_option || "",

            // Addresses
            billing_address: {
              street: recurringInvoice.billing_address?.street || "",
              address: recurringInvoice.billing_address?.address || "",
              street2: recurringInvoice.billing_address?.street2 || "",
              city: recurringInvoice.billing_address?.city || "",
              state: recurringInvoice.billing_address?.state || "",
              zip: recurringInvoice.billing_address?.zip || "",
              country: recurringInvoice.billing_address?.country || "",
              fax: recurringInvoice.billing_address?.fax || "",
              phone: recurringInvoice.billing_address?.phone || "",
              attention: recurringInvoice.billing_address?.attention || "",
            },
            shipping_address: {
              street: recurringInvoice.shipping_address?.street || "",
              address: recurringInvoice.shipping_address?.address || "",
              street2: recurringInvoice.shipping_address?.street2 || "",
              city: recurringInvoice.shipping_address?.city || "",
              state: recurringInvoice.shipping_address?.state || "",
              zip: recurringInvoice.shipping_address?.zip || "",
              country: recurringInvoice.shipping_address?.country || "",
              fax: recurringInvoice.shipping_address?.fax || "",
              phone: recurringInvoice.shipping_address?.phone || "",
              attention: recurringInvoice.shipping_address?.attention || "",
            },

            // Recurring invoice reference
            recurring_invoice_id: recurringInvoice.recurring_invoice_id,
          };

          // Create the new invoice
          const createdInvoice = await queryHelper.insertData(
            InvoiceCollection,
            invoiceData
          );
          // Each generated invoice is a sale: post its journal.
          await postInvoiceJournal(createdInvoice.msg);

          console.log(`Successfully created invoice: ${invoiceNumber}`);

          // Send email notification immediately after invoice creation
          try {
            const emailResult = await emailHelper.sendInvoiceNotificationEmail(
              invoiceData,
              recurringInvoice
            );

            if (emailResult.success) {
              console.log(
                `Email sent successfully for invoice ${invoiceNumber}:`,
                {
                  from: emailResult.from,
                  to: emailResult.to,
                  messageId: emailResult.messageId,
                }
              );
            } else {
              console.error(
                `Failed to send email for invoice ${invoiceNumber}:`,
                emailResult.error
              );
            }
          } catch (emailError) {
            console.error(
              `Email sending error for invoice ${invoiceNumber}:`,
              emailError
            );
            // Continue processing even if email fails
          }

          // Update the recurring invoice with new next_invoice_date
          await RecurringInvoiceCollection.updateOne(
            { _id: recurringInvoice._id },
            {
              $set: {
                next_invoice_date: newNextDateFormatted,
                status: "active",
                last_modified_date: today.toISOString(),
              },
            }
          );

          console.log(
            `Successfully processed recurring invoice: ${recurringInvoice.recurring_invoice_id}, created invoice: ${invoiceNumber}`
          );
        } else if (endDateFormatted && endDateFormatted <= todayFormatted) {
          // Handle expired recurring invoices using string comparison
          await RecurringInvoiceCollection.findOneAndUpdate(
            { _id: recurringInvoice._id },
            {
              $set: {
                next_invoice_date: null,
                status: "expired",
                status_formatted: "Expired",
                last_modified_date: today.toISOString(),
              },
            }
          );
          console.log(
            `Recurring invoice ${recurringInvoice.recurring_invoice_id} marked as expired`
          );
        }
      } catch (invoiceError) {
        console.error(
          `Error processing recurring invoice ${recurringInvoice.recurring_invoice_id}:`,
          invoiceError
        );
      }
    });

    // Wait for all promises to complete
    await Promise.all(updatePromises);

    console.log(
      `[${new Date().toISOString()}] Recurring invoice job completed`
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error in recurring invoice job:`,
      error
    );
  }
};

cron.schedule("0 0 * * *", () => {
  processRecurringInvoices();
  console.log("Scheduled recurring invoice task executed at midnight.");
});
