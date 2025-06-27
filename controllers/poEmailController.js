
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const ST_CODES = require("../helpers/statusCodeHelpers");
const commonHelper = require("../helpers/commonHelpers");
const queryHelper = require("../helpers/query");
const POEmailLog = require("../model/poEmailModel");
const PurchaseOrder = require("../model/purchaseOrder");
const Organization = require("../model/organizationSchema");
const jwt = require("jsonwebtoken");
const apiHandler = require("../handler/api-handler");
// const contactDetails = require('../model/contactDetails');

// Create email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || "your-email@gmail.com",
    pass: process.env.EMAIL_PASS || "your-app-password"
  },
  debug: true // Enable debug output
});

transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP Connection Error:", error);
  } else {
    // console.log("SMTP server is ready to take messages");
  }
});

// Helper function for standard email template
function formatEmailTemplate(orderData) {
  const {
    recipient_name = "Customer",
    order_type = "Purchase Order",
    order_number = "",
    order_date = "",
    amount = "",
    currency = "INR",
    sender_name = "",
    company_name = ""
  } = orderData;

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
      <p>Dear ${recipient_name},</p>
      <p>The ${order_type.toLowerCase()} (${order_number}) is attached with this email.</p>
      <p>An overview of the ${order_type.toLowerCase()} is available below:</p>
      <hr style="border: 0; border-top: 1px solid #ccc; margin: 15px 0;">
      <h2 style="font-size: 16px; margin: 10px 0;">${order_type} # : ${order_number}</h2>
      <hr style="border: 0; border-top: 1px solid #ccc; margin: 15px 0;">
      <p style="margin: 10px 0;">
        <strong>Order Date:</strong> ${order_date}<br>
        <strong>Amount:</strong> ${currency === 'INR' ? '₹' : currency} ${amount}
      </p>
      <hr style="border: 0; border-top: 1px solid #ccc; margin: 15px 0;">
      <p>Please go through it and confirm the order. We look forward to working with you again.</p>
      <p style="margin-top: 15px;">Regards,<br>${sender_name}<br>${company_name}</p>
    </div>
  `;
}

// Helper function for portal invitation email template
function formatPortalInvitationTemplate(data) {
  const {
    name = "Customer",
    companyName = "Our Company",
    portalUrl = "#",
    activateUrl = "#",
    username = "",
  } = data;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Portal Invitation</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: white;
          border: 1px solid #e0e0e0;
        }
        .main-container{
          padding: 20px;
          background-color: #f9f9f9;
        }
        .header {
          text-align: left;
          margin-bottom: 25px;
        }
        .content {
          padding: 20px;
          border-radius: 4px;
        }
        .button {
          display: inline-block;
          padding: 10px 20px;
          margin: 20px 0;
          background-color: #26c281;
          color: white !important;
          text-decoration: none;
          border-radius: 4px;
          text-align: center;
        }
        .footer {
          margin-top: 20px;
          font-size: 12px;
          color: #666;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="main-container">
        <div class="header">
          <h4>Hi ${name},</h4>
        </div>
        <div class="content">
          <p>You are invited to ${companyName}'s client portal.</p>
          
          <p>In the portal you can view your invoices, estimates, payment history and make payment via secure payment gateways.</p>
        </div>
        <div class="container">
          <p>You can login to the portal any time by accessing the Portal URL found below.</p>
          <p>Portal URL : <a href="${portalUrl}">${portalUrl}</a></p>

          <p>Username: ${username}</p>
          
          <a href="${activateUrl}" class="button">Accept Invitation</a> 
        </div>
        <p>You can always reach out to us in case you require any assistance.</p>
      </div>
    </body>
    </html>
  `;
}

// Helper function to get order details
async function getOrderDetails(order_id, order_type) {
  try {
    if (order_type === "purchaseorder") {
      return await PurchaseOrder.findOne({ purchaseorder_id: order_id });
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }
}

// Helper function to generate invitation token
function generateInviteToken(contactData) {
  // Create a token payload with organization_id included
  const payload = {
    clientId: contactData.clientId,
    name: contactData.name,
    email: contactData.email,
    organization_id: contactData.organization_id,// Include organization_id in the token
    org_name:contactData.org_name,
    clientPersonId: contactData.clientPersonId,
  };

  // Generate token with 5 minutes expiry (300 seconds)
  const token = jwt.sign(
    payload,
    process.env.JWT_SECRET || "portal-invite-secret-key",
    // { expiresIn: "5m" }
    { expiresIn: "24h" }
  );

  return token;
}

const poEmailController = {
  async sendEmail(req, res) {
    try {
      // Get user_id from session
      const user_id = res.locals.user_id;
      
      // Get data from request body
      let bData = req.body;
      console.log(req.body,"-*-*-*-*-*-*-*-");
      
      const { organization_id } = req.body;
      
      // Validate required parameters
      if (!user_id || !organization_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required parameters: organization_id and user_id are mandatory."
        });
      }
      
      if (!bData || Object.keys(bData).length === 0) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Request body is empty."
        });
      }
      
      const { 
        from_email, 
        to_email, 
        cc_emails = [], 
        bcc_emails = [], 
        subject, 
        body, 
        attach_pdf,
        salesorder_id,
        purchaseorder_id,
        recipient_name,
        order_number,
        order_date,
        contact_id,
        amount,
        currency,
        email_type,
        sender_name,
        company_name
      } = bData;
      
      // Validate required email fields
      if (!from_email || !to_email || !subject) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required fields: from_email, to_email, and subject are required"
        });
      }
      
      // Determine order type and ID
      const actualOrderType = purchaseorder_id ? "purchaseorder" : "salesorder";
      const orderId = purchaseorder_id || salesorder_id || bData.order_id;
      const orderTypeLabel = purchaseorder_id ? "Purchase Order" : "Sales Order";
      
      // Generate unique ID for email log
      const emailLogId = await commonHelper.generateUniqueId(
        POEmailLog,
        "email_log_id"
      );
      
      // Get order details for template if needed and not provided
      let orderDetails = {};
      
      if (orderId && (!recipient_name || !order_date || !amount)) {
        const orderData = await getOrderDetails(orderId, actualOrderType);
        
        if (orderData) {
          // Extract order details based on order type
          if (actualOrderType === "purchaseorder") {
            orderDetails = {
              recipient_name: recipient_name || orderData.vendor_name || "Vendor",
              order_number: order_number || orderData.purchaseorder_number || orderId,
              order_date: order_date || orderData.purchaseorder_date,
              amount: amount || orderData.total_amount,
              currency: currency || orderData.currency || "INR"
            };
          } else {
            orderDetails = {
              recipient_name: recipient_name || "Customer",
              order_number: order_number || orderId,
              order_date: order_date || new Date().toLocaleDateString(),
              amount: amount || "0.00",
              currency: currency || "INR"
            };
          }
        }
      }

      // If body is provided, use it; otherwise format a template
      const emailBody = body || formatEmailTemplate({
        recipient_name: recipient_name || orderDetails.recipient_name || "Customer",
        order_type: orderTypeLabel,
        order_number: order_number || orderDetails.order_number || orderId,
        order_date: order_date || orderDetails.order_date || new Date().toLocaleDateString(),
        amount: amount || orderDetails.amount || "0.00",
        currency: currency || orderDetails.currency || "INR",
        sender_name: sender_name || res.locals?.user_name || "Sales Team",
        company_name: company_name || "Your Company"
      });

      // Prepare email options
      const mailOptions = {
        from: from_email,
        to: to_email,
        subject: subject,
        html: emailBody
      };

      // Add CC and BCC if provided
      if (cc_emails && cc_emails.length > 0) {
        mailOptions.cc = Array.isArray(cc_emails) ? cc_emails.join(",") : cc_emails;
      }

      if (bcc_emails && bcc_emails.length > 0) {
        mailOptions.bcc = Array.isArray(bcc_emails) ? bcc_emails.join(",") : bcc_emails;
      }

      // Create attachment paths array for tracking
      let attachmentNames = [];

      // Attach PDF if requested - with improved handling
      if (attach_pdf && orderId) {
        try {
          // For production, you'd have a real path to your PDFs
          const storageDir = path.join(__dirname, "../storage");
          if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
          }
          
          const orgDir = path.join(storageDir, organization_id);
          if (!fs.existsSync(orgDir)) {
            fs.mkdirSync(orgDir, { recursive: true });
          }
          
          const ordersDir = path.join(orgDir, `${actualOrderType}s`);
          if (!fs.existsSync(ordersDir)) {
            fs.mkdirSync(ordersDir, { recursive: true });
          }
          
          // Check if PDF exists - and continue without attachment if not found
          const pdfPath = path.join(ordersDir, `${orderId}.pdf`);
          
          if (fs.existsSync(pdfPath)) {
            const filename = `${actualOrderType === "purchaseorder" ? "PO" : "SO"}-${orderId}.pdf`;
            mailOptions.attachments = [
              {
                filename: filename,
                path: pdfPath,
                contentType: "application/pdf"
              }
            ];
            
            attachmentNames.push(filename);
          } else {
            console.log(`PDF not found at ${pdfPath}, continuing without attachment`);
            // Add a note to the email about missing attachment
            mailOptions.html = mailOptions.html + `
              <p style="color: #FF6600; margin-top: 20px; font-style: italic;">
                Note: The ${orderTypeLabel} PDF could not be attached to this email.
              </p>
            `;
          }
        } catch (attachError) {
          console.error("Error handling attachment:", attachError);
          // Continue without failing the entire email send process
        }
      }

      // Create email log entry
      const emailLogData = {
        email_log_id: emailLogId,
        from_email,
        to_email,
        cc_emails: mailOptions.cc || '',
        bcc_emails: mailOptions.bcc || '',
        subject,
        body: emailBody,
        attachment_names: attachmentNames,
        order_id: orderId,
        order_type: actualOrderType,
        organization_id,
        email_type,
        contact_id,
        status: 'pending',
        created_by: user_id
      };
      
      // Insert into database using queryHelper
      const addEmailLog = await queryHelper.insertData(POEmailLog, emailLogData);
      
      if (!addEmailLog.status) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to create email log entry",
          error: addEmailLog.msg
        });
      }
      
      // Send the email
      try {
        const info = await transporter.sendMail(mailOptions);
        
        // Update email log with success info
        await POEmailLog.findOneAndUpdate(
          { email_log_id: emailLogId },
          {
            status: 'sent',
            message_id: info.messageId,
            updated_at: new Date()
          }
        );
        
        // Success response
        return res.status(ST_CODES.OK).json({
          status: true,
          message: "Email sent successfully",
          data: {
            messageId: info.messageId,
            emailLogId: emailLogId
          }
        });
      } catch (emailError) {
        // Update email log with error info
        await POEmailLog.findOneAndUpdate(
          { email_log_id: emailLogId },
          {
            status: 'failed',
            error_message: emailError.message,
            updated_at: new Date()
          }
        );
        
        return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
          status: false,
          message: "Failed to send email",
          error: emailError.message
        });
      }
      
    } catch (error) {
      
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error: Unable to send email. Please try again later.",
        error: error.message
      });
    }
  },
  // Verify portal invitation with improved API usage
  async sendPortalInvite(req, res) {
  try {
    console.log("Portal Invitation Request Received");
    const user_id = res.locals?.user_id || req.session?.user_id;
    const authToken = req.headers.authorization;
    // Get data from request body
    const { 
      contactId,
      contact_person_id,
      email, 
      name,
      organizationId,
      companyName = "Our Company"
    } = req.body;
    // Validate required parameters
    if (!contactId || !email || !organizationId || !contact_person_id) {
      return res.status(ST_CODES.BAD_REQUEST).json({
        status: false,
        message: "Missing required parameters: contactId, email, and organizationId are mandatory."
      });
    }
    let contact_id = contactId;
    let organization_id = organizationId;
    // let token = authToken;
    let contact;
    try {
      const contactResponse = await apiHandler.getContactInformation(contact_id, organization_id, authToken);
      
      contact = contactResponse.data.data;
      // console.log(contact_id, organization_id, authToken,"contactResponsecontactResponsecontactResponse");
      
      // return
      if (!contact) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Contact not found"
        });
      }
    } catch (apiError) {
      return res.status(ST_CODES.NOT_FOUND).json({
        status: false,
        message: "Failed to retrieve contact information",
        error: apiError.message
      });
    }
    // Get contact person information
    let contactPerson;
    try {
    console.log(authToken,"---token---")
      const contactPersonResponse = await apiHandler.getContactPersonInformationById(contact_person_id, organization_id, authToken);
      contactPerson = contactPersonResponse.data.data;
      
      if (!contactPerson) {
        return res.status(ST_CODES.NOT_FOUND).json({
          status: false,
          message: "Contact person not found"
        });
      }
    } catch (apiError) {
      return res.status(ST_CODES.NOT_FOUND).json({
        status: false,
        message: "Failed to retrieve contact person information",
        error: apiError.message
      });
    }
    const organizationDetails = await Organization.findOne({organization_id:organizationId});
    
    // Generate a unique token for this invitation - including organization_id
    const inviteToken = generateInviteToken({
      clientId: contactId,
      clientPersonId: contact_person_id,
      name: name || contact.contact_name,
      email: email,
      org_name:organizationDetails.org_name,
      organization_id: organizationId  // Include organization_id in token
    });
    
    // Create portal URL with token
    const baseUrl = process.env.FRONTEND_URL;
    const portalUrl = `${baseUrl}/${organizationId}/login`;
    const activateUrl = `${baseUrl}/authentication/create-password?token=${inviteToken}`;
    
    // Prepare email data
    const emailData = {
      name: name || contact.contact_name,
      companyName: organizationDetails.org_name,
      portalUrl: portalUrl,
      activateUrl:activateUrl,
      username: email
    };
    
    // Create email content
    const emailHtml = formatPortalInvitationTemplate(emailData);
    
    // Generate unique ID for email log
    const emailLogId = await commonHelper.generateUniqueId(
      POEmailLog,
      "email_log_id"
    );
    
    // Prepare mail options
    const mailOptions = {
      from: process.env.EMAIL_FROM || `${companyName} <no-reply@yourcompany.com>`,
      to: email,
      subject: `${companyName} has invited you to join their portal`,
      html: emailHtml
    };
    
    // Create email log entry
    const emailLogData = {
      email_log_id: emailLogId,
      from_email: mailOptions.from,
      to_email: email,
      cc_emails: '',
      bcc_emails: '',
      subject: mailOptions.subject,
      body: emailHtml,
      attachment_names: [],
      organization_id: organizationId,
      contact_id: contactId,
      email_type: 'portal_invitation',
      status: 'pending',
      created_by: user_id || 'system'
    };
    
    // Insert into database using queryHelper
    const addEmailLog = await queryHelper.insertData(POEmailLog, emailLogData);
    
    if (!addEmailLog.status) {
      return res.status(ST_CODES.BAD_REQUEST).json({
        status: false,
        message: "Failed to create email log entry",
        error: addEmailLog.msg
      });
    }
    
    // Send the email
    try {
      const info = await transporter.sendMail(mailOptions);
      
      // Update email log with success info
      await POEmailLog.findOneAndUpdate(
        { email_log_id: emailLogId },
        {
          status: 'sent',
          message_id: info.messageId,
          updated_at: new Date()
        }
      );
      
      // Prepare update data for contact
      try {
        // Update contact information to reflect invitation status
        const contactUpdateData = {
          portal_status: 'enabled',
          portal_status_formatted: 'Enabled',
          is_portal_enabled: true,
          invited_by: user_id || 'system',
          invited_at: new Date().toISOString()
        };
        
        // Update the contact using the API
        const contactUpdateResponse = await apiHandler.updateContact(
          contactId,
          organizationId,
          contactUpdateData,
          authToken
        );
        console.log(contactPerson,"----contactPerson---")
        
        // Only proceed if we have the contact person details
        if (contactPerson && contactPerson.contact_person_id) {
          console.log("Updating contact person with ID:", contactPerson.contact_person_id);
          
          // Update contact person information
          const contactPersonUpdateData = {
            can_invite: true,  // Set to true after sending invitation
            is_added_in_portal:true,
            is_portal_invitation_accepted:false,
            invited_by: user_id || 'system',
            invited_at: new Date().toISOString()
          };
          console.log(contactPersonUpdateData,"----contactPersonUpdateData----")
          // Use API handler to update the contact person
          const updateResponse = await apiHandler.updateContactPerson(
            contactPerson.contact_person_id, 
            contactPersonUpdateData, 
            authToken
          );
          
        } else {
          console.log("Warning: No contact person details available for update");
        }
      } catch (contactUpdateError) {
        console.error("Error updating contact information:", contactUpdateError);
        // Don't fail the whole operation if contact update fails
      }
      
      // Success response
      return res.status(ST_CODES.OK).json({
        status: true,
        message: "Portal invitation sent successfully",
        data: {
          messageId: info.messageId,
          emailLogId: emailLogId,
          token: inviteToken
        }
      });
    } catch (emailError) {
      // Update email log with error info
      await POEmailLog.findOneAndUpdate(
        { email_log_id: emailLogId },
        {
          status: 'failed',
          error_message: emailError.message,
          updated_at: new Date()
        }
      );
      
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Failed to send portal invitation",
        error: emailError.message
      });
    }
    
  } catch (error) {
    console.error("Portal invitation error:", error);
    
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
      status: false,
      message: "Internal Server Error: Unable to send portal invitation. Please try again later.",
      error: error.message
    });
  }
},

// Verify portal invitation with improved API usage
async verifyPortalInvite(req, res) {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(ST_CODES.BAD_REQUEST).json({
        status: false,
        message: "Invalid or missing token"
      });
    }
    
    // Verify the token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "portal-invite-secret-key");
    } catch (jwtError) {
      return res.status(ST_CODES.UNAUTHORIZED).json({
        status: false,
        message: "Invalid or expired invitation link",
        error: jwtError.message
      });
    }
    
    // Log decoded information for debugging
    console.log("Decoded token information:", decoded);
    
    // Get organization_id from various sources if not in token
    if (!decoded.organization_id) {
      console.log("No organization_id in token. Checking alternatives.");
      
      // Try to get from query or body
      const orgFromReq = req.query.organization_id || req.body.organization_id;
      
      if (orgFromReq) {
        console.log("Using organization_id from request:", orgFromReq);
        decoded.organization_id = orgFromReq;
      } else {
        console.log("No organization_id available. Will try to proceed with contact_id only.");
      }
    }
    
    try {
      // If we have both contact_id and organization_id, we can update contact and contact person
      if (decoded.contact_id && decoded.organization_id && authToken) {
        // First, update the main contact record
        try {
          const contactUpdateData = {
            portal_status: 'enabled',
            portal_status_formatted: 'Enabled',
            portal_activated_at: new Date().toISOString(),
            is_added_in_portal: 'true'  // Set is_added_in_portal to true
          };
          
          const contactUpdateResponse = await apiHandler.updateContact(
            decoded.contact_id,
            decoded.organization_id,
            contactUpdateData,
            authToken
          );
          
          console.log("Contact update API response:", contactUpdateResponse.data);
          
          // Now try to get and update the contact person
          try {
            const contactPersonResponse = await apiHandler.getContactPersonInformation(
              decoded.contact_id, 
              decoded.organization_id, 
              authToken
            );
            
            const contactPerson = contactPersonResponse.data.data;
            
            if (contactPerson && contactPerson.contact_person_id) {
              console.log("Contact person found via API:", contactPerson.contact_person_id);
              
              // Update the contact person through API
              const updateData = {
                is_portal_invitation_accepted: true,  // Set to true after accepting invitation
                portal_activated_at: new Date().toISOString(),
                is_added_in_portal: true  // Also set is_added_in_portal for contact person
              };
              
              const updateResponse = await apiHandler.updateContactPerson(
                contactPerson.contact_person_id, 
                updateData, 
                authToken
              );
              
              console.log("Contact person update API response:", updateResponse.data);
            }
          } catch (personApiError) {
            console.error("Error updating contact person:", personApiError);
            // We already updated the main contact, so this is a partial success
          }
          
          // Success response
          return res.status(ST_CODES.OK).json({
            status: true,
            message: "Portal invitation accepted successfully",
            data: {
              email: decoded.email,
              contactId: decoded.contact_id,
              status: "Enabled",
              is_added_in_portal: true
            }
          });
        } catch (contactApiError) {
          console.error("Error updating contact:", contactApiError);
          return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
            status: false,
            message: "Failed to update contact via API",
            error: contactApiError.message
          });
        }
      } else {
        // Missing required information for API call
        return res.status(ST_CODES.BAD_REQUEST).json({
          status: false,
          message: "Missing required information to process invitation. Please make sure you have a valid token and authorization."
        });
      }
    } catch (error) {
      console.error("Error processing invitation:", error);
      
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Failed to process invitation. Please try again later.",
        error: error.message
      });
    }
  } catch (error) {
    return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
      status: false,
      message: "Failed to process invitation. Please try again later.",
      error: error.message
    });
  }
},

  async getEmailLogs(req, res) {
    try {
      const user_id = res.locals.user_id;
      const { 
        organization_id, 
        page = 1, 
        limit = 10, 
        order_id, 
        contact_id,
        order_type,
        status,
        start_date,
        end_date
      } = req.query;
  
      if (!user_id || !organization_id || !contact_id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required parameters: organization_id, contact_id, and user_id are mandatory."
        });
      }
  
      // Build query
      const query = { organization_id, contact_id };
      console.log(organization_id, contact_id);
      
      
      // Add filters if provided
      if (order_id) query.order_id = order_id;
      if (order_type) query.order_type = order_type;
      if (status) query.status = status;
      
      // Add date range filter if provided
      if (start_date || end_date) {
        query.created_at = {};
        if (start_date) {
          query.created_at.$gte = new Date(start_date);
        }
        if (end_date) {
          query.created_at.$lte = new Date(end_date);
        }
      }
  
      const limitInt = parseInt(limit, 10);
      const pageInt = parseInt(page, 10);
      const projection = { body: 0 }; // Exclude body for list view performance
      const sort = { created_at: -1 };
  
      // Use queryHelper for consistent data retrieval
      // Use queryHelper for consistent data retrieval
      const results = await queryHelper.findData(
        POEmailLog,
        query,
        projection,
        sort,
        limitInt,
        pageInt
      );
  
      // Fixed condition: Check if results exist and has data
      if (!results || !results.msg || results.msg.length === 0) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "No email logs found"
        });
      }
  
      return res.status(ST_CODES.OK).json({
        success: true,
        data: {
          logs: results.msg,
          pagination: {
            total: results.total || 0,
            page: pageInt,
            limit: limitInt,
            pages: Math.ceil((results.total || 0) / limitInt)
          }
        },
        message: "Email logs retrieved successfully"
      });
    } catch (error) {
      console.error("Error fetching email logs:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error: Unable to retrieve email logs. Please try again later.",
        error: error.message
      });
    }
  },

  async getEmailLogById(req, res) {
    try {
      const user_id = res.locals.user_id;
      const { id } = req.params;
      const { organization_id } = req.query;

      if (!user_id || !organization_id || !id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required parameters: organization_id, user_id, and email log ID are mandatory."
        });
      }

      const query = {
        email_log_id: id,
        organization_id
      };

      // Use queryHelper for consistent data retrieval
      const result = await queryHelper.findOne(POEmailLog, query);

      if (!result || !result.status) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Email log not found"
        });
      }

      return res.status(ST_CODES.OK).json({
        success: true,
        data: result.msg,
        message: "Email log retrieved successfully"
      });
    } catch (error) {
      console.error("Error fetching email log:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error: Unable to retrieve email log. Please try again later.",
        error: error.message
      });
    }
  },

  async resendEmail(req, res) {
    try {
      const user_id = res.locals.user_id;
      const { id } = req.params;
      const { organization_id } = req.query;

      if (!user_id || !organization_id || !id) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          success: false,
          message: "Missing required parameters: organization_id, user_id, and email log ID are mandatory."
        });
      }

      // Find the original email log
      const query = {
        email_log_id: id,
        organization_id
      };

      const result = await queryHelper.findOne(POEmailLog, query);

      if (!result || !result.status) {
        return res.status(ST_CODES.NOT_FOUND).json({
          success: false,
          message: "Email log not found"
        });
      }

      const originalLog = result.msg;

      // Create a new request body based on the original email
      req.body = {
        from_email: originalLog.from_email,
        to_email: originalLog.to_email,
        cc_emails: originalLog.cc_emails ? originalLog.cc_emails.split(',') : [],
        bcc_emails: originalLog.bcc_emails ? originalLog.bcc_emails.split(',') : [],
        subject: `Re: ${originalLog.subject}`,
        body: originalLog.body,
        attach_pdf: originalLog.attachment_names.length > 0,
        order_id: originalLog.order_id,
        order_type: originalLog.order_type,
        organization_id: originalLog.organization_id
      };

      // Use the sendEmail method with the new request
      return this.sendEmail(req, res);
    } catch (error) {
      console.error("Error resending email:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal Server Error: Unable to resend email. Please try again later.",
        error: error.message
      });
    }
  }
};

module.exports = poEmailController;