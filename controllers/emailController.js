const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
// Import the model this way:
const EmailLog = require("../model/emailLog");

// Configure nodemailer with Gmail credentials
const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || "gbharathitrs@gmail.com",
    pass: process.env.EMAIL_PASS || "isvhhcmhhcnlqaaq",
  },
  debug: true, // Enable debug output
});

// Verify connection configuration at startup
transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP Connection Error:", error);
  } else {
    // console.log("SMTP server is ready to take messages");
  }
});

class EmailController {
  formatEmailTemplate(orderData) {
    const {
      recipient_name = "Customer",
      sender_name = "",
      company_name = "",
      invoice_number = "",
      payment_date = "",
      amount = "",
      currency = "INR",
    } = orderData;

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .header {
          background-color: #007bff;
          color: white;
          text-align: center;
          padding: 20px 0;
        }
        .content {
          max-width: 600px;
          margin: 20px auto;
          padding: 20px;
          background-color: #f9f9f9;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .payment-details {
          background-color: #fffbe6;
          padding: 20px;
          border: 1px solid #ddd;
          border-radius: 8px;
          text-align: center;
        }
        .payment-details h2 {
          margin-bottom: 10px;
        }
        .payment-details p {
          margin: 5px 0;
        }
        .payment-details span {
          font-weight: bold;
        }
        .footer {
          margin-top: 20px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Payment Received</h1>
      </div>
      <div class="content">
        <p>Dear ${recipient_name},</p>
        <p>Thank you for your payment. It was a pleasure doing business with you. We look forward to working together again!</p>
        <div class="payment-details">
          <h2>Payment Received</h2>
          <p style="color: green;">₹${amount}</p>
          <hr>
          <p><span>Invoice No:</span> ${invoice_number}</p>
          <p><span>Payment Date:</span> ${payment_date}</p>
        </div>
        <div class="footer">
          <p>Regards,</p>
          <p>${sender_name}<br>${company_name}</p>
        </div>
      </div>
    </body>
    </html>
  `;
  }


  async sendEmail(req, res) {
    const {
      recipient_name,
      sender_name,
      company_name,
      invoice_number,
      payment_date,
      amount,
      currency,
    } = req.body;

    const emailBody =
      req.body.body ||
      this.formatEmailTemplate({
        recipient_name,
        sender_name,
        company_name,
        invoice_number,
        payment_date,
        amount,
        currency,
      });

    const mailOptions = {
      from: req.body.from_email,
      to: req.body.to_email,
      subject: req.body.subject,
      html: emailBody,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      res.status(200).json({
        status: true,
        message: "Email sent successfully",
        messageId: info.messageId,
      });
    } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({
        status: false,
        message: "Failed to send email",
        error: error.message,
      });
    }
  }

  // Get email logs for an organization
  async getEmailLogs(req, res) {
    try {
      const {
        organization_id,
        page = 1,
        limit = 10,
        order_id,
        status,
      } = req.query;

      if (!organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Organization ID is required",
        });
      }

      // Build query
      const query = { organization_id };

      // Add filters if provided
      if (order_id) query.order_id = order_id;
      if (status) query.status = status;

      // Count total documents for pagination
      const total = await EmailLog.countDocuments(query);

      // Get paginated results
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const emailLogs = await EmailLog.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select("-body"); // Exclude body for list view performance

      res.status(ST_CODES.OK).send({
        status: true,
        data: {
          logs: emailLogs,
          pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
        message: "Email logs retrieved successfully",
      });
    } catch (error) {
      console.error("Error fetching email logs:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Failed to retrieve email logs",
        error: error.message,
      });
    }
  }

  //  Get email log details by ID
  async getEmailLogById(req, res) {
    try {
      const { id } = req.params;
      const { organization_id } = req.query;

      if (!id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).send({
          status: false,
          message: "Email log ID and organization ID are required",
        });
      }

      const emailLog = await EmailLog.findOne({
        email_log_id: id,
        organization_id,
      });

      if (!emailLog) {
        return res.status(ST_CODES.NOT_FOUND).send({
          status: false,
          message: "Email log not found",
        });
      }

      res.status(ST_CODES.OK).send({
        status: true,
        data: emailLog,
        message: "Email log retrieved successfully",
      });
    } catch (error) {
      console.error("Error fetching email log:", error);
      res.status(ST_CODES.INTERNAL_SERVER_ERROR).send({
        status: false,
        message: "Failed to retrieve email log",
        error: error.message,
      });
    }
  }
}

module.exports = new EmailController();
