const nodemailer = require("nodemailer");
const OrganizationCollection = require("../model/organizationSchema");
const ContactPersonCollection = require("../model/contactPerson");
require("dotenv").config();

// Email template for recurring invoice notification
const generateInvoiceEmailTemplate = (templateData) => {
  const {
    customerName,
    invoiceNumber,
    invoiceDate,
    recurringProfileName,
    organizationName,
    viewInvoiceUrl,
  } = templateData;

  const subject = `New auto-generated invoice for the recurring profile: ${recurringProfileName}`;

  const htmlTemplate = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Invoice Generated</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                margin: 0;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .email-container {
                max-width: 1000px;
                margin: 0 auto;
                background-color: #ffffff;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                border-bottom: 2px solid #e0e0e0;
                margin-bottom: 20px;
                padding-bottom: 15px;
            }
            .highlight {
                background-color: #fff3cd;
                padding: 2px 4px;
                border-radius: 3px;
                color: #856404;
                font-weight: bold;
            }
            .invoice-details {
                background-color: #f8f9fa;
                padding: 15px;
                border-left: 4px solid #007bff;
                margin: 20px 0;
            }
            .invoice-details p {
                margin: 5px 0;
            }
            .view-button {
                display: inline-block;
                background-color: #28a745;
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 5px;
                font-weight: bold;
                margin: 20px 0;
                text-decoration: none;
            }
            .view-button:hover {
                background-color: #218838;
            }
            .note-section {
                background-color: #fff3cd;
                border: 1px solid #ffeaa7;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
            }
            .footer {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #e0e0e0;
                color: #666;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <h2>New Auto-Generated Invoice</h2>
            </div>
            
            <p>Dear customer,</p>
            
            <p>The <span class="highlight">recurring</span> invoice (${invoiceNumber}) for your customer, ${customerName}, has been saved in your ${organizationName} account. You can review the invoice and send it to your customer.</p>
            
            <p>Here's an overview of the auto-generated invoice:</p>
            
            <div class="invoice-details">
                <p><strong>Invoice#:</strong> ${invoiceNumber}</p>
                <p><strong>Date:</strong> ${invoiceDate}</p>
                <p><strong><span class="highlight">Recurring</span> Profile:</strong> ${recurringProfileName}</p>
            </div>
            
            ${
              viewInvoiceUrl
                ? `<a href="${viewInvoiceUrl}" class="view-button">View Invoice</a>`
                : ""
            }
            
            <div class="note-section">
                <p><strong>Note:</strong> You've configured the <span class="highlight">recurring</span> invoices to be saved as drafts and an email notification to be sent to you when they are generated. You can change this configuration in ${organizationName} Settings.</p>
            </div>
            
            <div class="footer">
                <p>Regards,<br>The ${organizationName} Team</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const textTemplate = `
    Dear customer,

    The recurring invoice (${invoiceNumber}) for your customer, ${customerName}, has been saved in your ${organizationName} account. You can review the invoice and send it to your customer.

    Here's an overview of the auto-generated invoice:

    Invoice#: ${invoiceNumber}
    Date: ${invoiceDate}
    Recurring Profile: ${recurringProfileName}

    Note: You've configured the recurring invoices to be saved as drafts and an email notification to be sent to you when they are generated. You can change this configuration in ${organizationName} Settings.

    Regards,
    The ${organizationName} Team
  `;

  return {
    subject,
    html: htmlTemplate,
    text: textTemplate,
  };
};

// Get organization email by organization_id
const getOrganizationEmail = async (organizationId) => {
  try {
    const organization = await OrganizationCollection.findOne({
      organization_id: organizationId,
    });

    if (!organization || !organization.email) {
      throw new Error(`No email found for organization: ${organizationId}`);
    }

    return {
      email: organization.email,
      name:
        organization.organization_name || organization.name || "Organization",
    };
  } catch (error) {
    console.error(
      `Error getting organization email for ${organizationId}:`,
      error
    );
    throw error;
  }
};

// Get primary contact person email by customer_id
const getPrimaryContactEmail = async (customer_id) => {
  try {
    const primaryContact = await ContactPersonCollection.findOne({
      contact_id: customer_id,
      is_primary_contact: true,
    });
    if (!primaryContact || !primaryContact.email) {
      throw new Error(
        `No primary contact email found for customer: ${customer_id}`
      );
    }

    return {
      email: primaryContact.email,
      name:
        primaryContact.first_name && primaryContact.last_name
          ? `${primaryContact.first_name} ${primaryContact.last_name}`
          : primaryContact.contact_person_name || "Customer",
    };
  } catch (error) {
    console.error(
      `Error getting primary contact email for customer ${customer_id}:`,
      error
    );
    throw error;
  }
};

// Configure email transporter (you'll need to configure this based on your email service)
const createEmailTransporter = () => {
  // Temporary hardcoded configuration for testing
  const config = {
    host: "smtp.gmail.com", // Hardcoded for testing
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || "your-email@gmail.com", // Replace with your email
      pass: process.env.SMTP_PASSWORD || "your-app-password", // Replace with your app password
    },
  };

  console.log("SMTP Config:", {
    host: config.host,
    port: config.port,
    user: config.auth.user,
    hasPassword: !!config.auth.pass,
  });

  return nodemailer.createTransport(config);
};

// Send invoice notification email
const sendInvoiceNotificationEmail = async (
  invoiceData,
  recurringInvoiceData
) => {
  try {
    // Get organization email (from address)
    const organizationInfo = await getOrganizationEmail(
      invoiceData.organization_id
    );

    // Get primary contact email (to address)
    const contactInfo = await getPrimaryContactEmail(invoiceData.customer_id);

    // Prepare template data
    const templateData = {
      customerName: invoiceData.customer_name,
      invoiceNumber: invoiceData.invoice_number,
      invoiceDate: invoiceData.date_formatted,
      recurringProfileName:
        recurringInvoiceData.profile_name || "Demo Recurring",
      organizationName: organizationInfo.name,
      viewInvoiceUrl: process.env.INVOICE_VIEW_BASE_URL
        ? `${process.env.INVOICE_VIEW_BASE_URL}/${invoiceData.invoice_id}`
        : null,
    };

    // Generate email template
    const emailTemplate = generateInvoiceEmailTemplate(templateData);

    // Create transporter
    const transporter = createEmailTransporter();

    // Email options
    const mailOptions = {
      from: {
        name: organizationInfo.name,
        address: organizationInfo.email,
      },
      to: {
        name: contactInfo.name,
        address: contactInfo.email,
      },
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    };

    // Send email
    const result = await transporter.sendMail(mailOptions);

    console.log(`Invoice notification email sent successfully:`, {
      invoiceNumber: invoiceData.invoice_number,
      from: organizationInfo.email,
      to: contactInfo.email,
      messageId: result.messageId,
    });

    return {
      success: true,
      messageId: result.messageId,
      from: organizationInfo.email,
      to: contactInfo.email,
    };
  } catch (error) {
    console.error("Error sending invoice notification email:", error);

    return {
      success: false,
      error: error.message,
      invoiceNumber: invoiceData?.invoice_number || "Unknown",
    };
  }
};

module.exports = {
  generateInvoiceEmailTemplate,
  getOrganizationEmail,
  getPrimaryContactEmail,
  sendInvoiceNotificationEmail,
};
