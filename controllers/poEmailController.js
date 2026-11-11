
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
const mailer = require("../helpers/mailer");
const ContactCollection = require("../model/contactModel");
const ContactPersonCollection = require("../model/contactPerson");
const portalEmails = require("../helpers/portalEmails");
// const contactDetails = require('../model/contactDetails');

// Create email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  debug: false
});

if (process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.NODE_ENV !== "test") {
  transporter.verify((error) => {
    if (error) console.error("SMTP Connection Error:", error.message);
  });
}

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
    activateUrl = "#",
    username = "",
    logoUrl = "",
  } = data;
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);

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
        body { background-color: #f7f7f7; }
        .page { width: 100%; background-color: #f7f7f7; }
        .card {
          width: 100%;
          max-width: 700px;
          margin: 0 auto;
          background-color: #fff;
        }
        .header { text-align: center; padding: 24px 20px 12px; }
        .logo { display: block; max-width: 160px; max-height: 64px; margin: 0 auto; }
        .content { padding: 16px 24px 8px; }
        .invite-box { border: 1px solid #dedede; padding: 22px; }
        .footer { padding: 10px 20px 22px; font-size: 12px; color: #666; text-align: center; }
        @media only screen and (max-width: 600px) {
          .content { padding: 12px 16px 8px !important; }
          .invite-box { padding: 16px !important; }
          .header { padding: 20px 16px 8px !important; }
        }
      </style>
    </head>
    <body>
      <table role="presentation" class="page" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#f7f7f7">
        <tr>
          <td align="center" style="padding:20px 12px">
            <table role="presentation" class="card" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:700px;background-color:#fff">
              <tr>
                <td class="header">
                  <p style="font-size:20px;font-weight:700;margin:0 0 10px">${escapeHtml(companyName)}</p>
                  ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="BizBooks" />` : ""}
                </td>
              </tr>
              <tr>
                <td class="content" style="padding:16px 24px 8px">
                  <p>Hi ${escapeHtml(name)},</p>
                  <p><strong>${escapeHtml(companyName)}</strong> has invited you to access its customer portal, powered by BizBooks.</p>
                  <p>Accept the invitation below to create your password. After signing in, you can view invoices, estimates and payment history, and make payments securely.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 24px 16px">
                  <table role="presentation" class="invite-box" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:1px solid #dedede;padding:22px">
                    <tr>
                      <td style="padding-bottom:20px">Your portal username: <strong>${escapeHtml(username)}</strong></td>
                    </tr>
                    <tr>
                      <td align="center">
                        <a href="${escapeHtml(activateUrl)}" style="display:inline-block;padding:14px 24px;background-color:#26c281;color:#fff;text-decoration:none;border-radius:4px;font-weight:700">
                          Accept ${escapeHtml(companyName)}'s Invitation
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 24px">
                  <p>If you have questions about this invitation, please contact ${escapeHtml(companyName)}.</p>
                </td>
              </tr>
              <tr>
                <td class="footer" style="padding:10px 20px 22px;font-size:12px;color:#666;text-align:center">This invitation was sent by ${escapeHtml(companyName)} via BizBooks.</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
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
        // Sent from the server's mailbox under the business name; the user's
        // address is the reply-to (see mailer.sendCustomerMail).
        const org = await Organization.findOne(
          { organization_id: { $in: [String(organization_id), Number(organization_id)] } },
          { org_name: 1 }
        ).lean();
        const info = await mailer.sendCustomerMail({
          to: mailOptions.to,
          cc: mailOptions.cc,
          bcc: mailOptions.bcc,
          subject: mailOptions.subject,
          html: mailOptions.html,
          businessName: org?.org_name || company_name,
          replyTo: from_email,
          attachments: mailOptions.attachments,
        });
        if (!info.ok) throw new Error(info.error);

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
  // POST /email/invite-portal  { contactId, contact_person_id?, email?, organizationId }
  // Emails a customer's contact person a link to set a portal password.
  // Without contact_person_id it invites the customer's primary contact (or
  // creates one from the customer's own email).
  async sendPortalInvite(req, res) {
    try {
      const user_id = res.locals?.user_id;
      const { contactId, contact_person_id } = req.body;
      const organizationId = String(req.body.organizationId || req.body.organization_id || "");
      if (!contactId || !organizationId) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "contactId and organizationId are required." });
      }

      // The request names the organisation as organizationId, which the
      // auth middleware's tenant check doesn't see, so check it here.
      const organization = await Organization.findOne({ organization_id: organizationId, admin_id: user_id }).lean();
      if (!organization) {
        return res.status(ST_CODES.FORBIDDEN || 403).json({ status: false, message: "You do not have access to this organization." });
      }

      const contact = await ContactCollection.findOne({ contact_id: String(contactId), organization_id: organizationId }).lean();
      if (!contact) return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Customer not found" });

      let person = contact_person_id
        ? await ContactPersonCollection.findOne({ contact_person_id: String(contact_person_id), contact_id: contact.contact_id }).lean()
        : (await ContactPersonCollection.findOne({ contact_id: contact.contact_id, is_primary_contact: true }).lean()) ||
          (await ContactPersonCollection.findOne({ contact_id: contact.contact_id, email: contact.email }).lean());
      if (contact_person_id && !person) {
        return res.status(ST_CODES.NOT_FOUND).json({ status: false, message: "Contact person not found" });
      }
      if (!person) {
        if (!contact.email) {
          return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "Add an email address for this customer first." });
        }
        person = (
          await ContactPersonCollection.create({
            contact_person_id: await commonHelper.generateUniqueId(ContactPersonCollection, "contact_person_id"),
            contact_id: contact.contact_id,
            organization_id: organizationId,
            admin_id: user_id,
            first_name: contact.contact_name,
            email: contact.email,
            is_primary_contact: true,
          })
        ).toObject();
      }

      const email = String(person.email || "").trim();
      if (!email) {
        return res.status(ST_CODES.BAD_REQUEST).json({ status: false, message: "This contact person has no email address." });
      }
      const name = [person.first_name, person.last_name].filter(Boolean).join(" ") || contact.contact_name || "there";

      // Already accepted: "Resend Portal Link" emails the sign-in link instead.
      if (person.is_portal_invitation_accepted) {
        const linkSent = await portalEmails.sendPortalLink({
          to: email,
          name,
          orgName: organization.org_name,
          orgEmail: organization.email,
          organizationId,
        });
        await queryHelper.insertData(POEmailLog, {
          email_log_id: await commonHelper.generateUniqueId(POEmailLog, "email_log_id"),
          from_email: organization.org_name,
          to_email: email,
          subject: `Your link to the ${organization.org_name} customer portal`,
          body: "",
          attachment_names: [],
          organization_id: organizationId,
          contact_id: contact.contact_id,
          email_type: "portal_link",
          status: linkSent.ok ? "sent" : "failed",
          error_message: linkSent.ok ? undefined : linkSent.error,
          created_by: user_id || "system",
        });
        if (!linkSent.ok) {
          return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ status: false, message: `Couldn't send the portal link: ${linkSent.error}` });
        }
        return res.status(ST_CODES.OK).json({
          status: true,
          message:
            linkSent.channel === "console"
              ? `Portal link for ${email} printed in the server log (email isn't set up on this server).`
              : `Portal link sent to ${email}`,
          data: { email, contact_person_id: person.contact_person_id },
        });
      }
      const inviteToken = generateInviteToken({
        clientId: contact.contact_id,
        clientPersonId: person.contact_person_id,
        name,
        email,
        org_name: organization.org_name,
        organization_id: organizationId,
      });

      const subject = `${organization.org_name} has invited you to their customer portal`;
      const emailLogId = await commonHelper.generateUniqueId(POEmailLog, "email_log_id");
      await queryHelper.insertData(POEmailLog, {
        email_log_id: emailLogId,
        from_email: organization.org_name,
        to_email: email,
        cc_emails: "",
        bcc_emails: "",
        subject,
        body: "",
        attachment_names: [],
        organization_id: organizationId,
        contact_id: contact.contact_id,
        email_type: "portal_invitation",
        status: "pending",
        created_by: user_id || "system",
      });

      const sent = await portalEmails.sendPortalInvite({
        to: email,
        name,
        orgName: organization.org_name,
        orgEmail: organization.email,
        organizationId,
        token: inviteToken,
      });
      await POEmailLog.findOneAndUpdate(
        { email_log_id: emailLogId },
        sent.ok ? { status: "sent", updated_at: new Date() } : { status: "failed", error_message: sent.error, updated_at: new Date() }
      );
      if (!sent.ok) {
        return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
          status: false,
          message: `Couldn't send the invitation email: ${sent.error}`,
        });
      }

      const now = new Date();
      await ContactPersonCollection.updateOne(
        { contact_person_id: person.contact_person_id },
        { $set: { can_invite: true, is_added_in_portal: true, is_portal_invitation_accepted: false, invited_by: String(user_id || ""), invited_at: now } }
      );
      await ContactCollection.updateOne(
        { contact_id: contact.contact_id, organization_id: organizationId },
        { $set: { portal_status: "enabled", portal_status_formatted: "Enabled", is_portal_enabled: true, invited_by: String(user_id || ""), invited_at: now } }
      );

      return res.status(ST_CODES.OK).json({
        status: true,
        message:
          sent.channel === "console"
            ? `Invitation for ${email} printed in the server log (email isn't set up on this server).`
            : `Portal invitation sent to ${email}`,
        data: { emailLogId, email, contact_person_id: person.contact_person_id },
      });
    } catch (error) {
      console.error("Portal invitation error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: "Couldn't send the portal invitation. Please try again later.",
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