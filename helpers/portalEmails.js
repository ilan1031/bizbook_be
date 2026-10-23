// Customer portal emails: the invitation a customer gets, and the notice the
// inviting user gets once the customer accepts. Both return the mailer's
// { ok, channel?, error? } and never throw.
const mailer = require("./mailer");
const { escapeHtml, layout } = mailer;

const button = (href, label) =>
  `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="background:#1b7a2f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(label)}</a></p>`;

// Where the customer portal is served: PORTAL_URL, else the app itself.
const portalBase = () =>
  String(process.env.PORTAL_URL || process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");

const portalLoginUrl = (organizationId) => `${portalBase()}/portal/${organizationId}/login`;
const portalActivateUrl = (token) => `${portalBase()}/portal/create-password?token=${encodeURIComponent(token)}`;

const sendPortalInvite = async ({ to, name, orgName, orgEmail, organizationId, token }) => {
  const activateUrl = portalActivateUrl(token);
  const loginUrl = portalLoginUrl(organizationId);
  return mailer.sendMail({
    to,
    fromName: orgName,
    replyTo: orgEmail || undefined,
    subject: `${orgName} has invited you to their customer portal`,
    text:
      `Hi ${name},\n\n${orgName} has invited you to their customer portal, where you can see your quotes, ` +
      `invoices and payments.\n\nAccept the invitation and set your password (the link works for 24 hours):\n${activateUrl}\n\n` +
      `After that, sign in any time at ${loginUrl} with ${to}.`,
    html: layout(
      `You're invited to the ${orgName} customer portal`,
      `<p>Hi ${escapeHtml(name)},</p>
<p><b>${escapeHtml(orgName)}</b> has invited you to their customer portal, where you can see your quotes, invoices and payments.</p>
${button(activateUrl, "Accept invitation")}
<p style="color:#6c718a;font-size:13px">The link works for 24 hours. After that, sign in any time at <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a> with <b>${escapeHtml(to)}</b>.</p>`
    ),
  });
};

const sendInviteAccepted = async ({ to, personName, personEmail, customerName, orgName, contactUrl }) =>
  mailer.sendMail({
    to,
    subject: `${customerName} accepted your customer portal invitation`,
    text:
      `${personName} (${personEmail}) from ${customerName} accepted your invitation to the ${orgName} customer portal ` +
      `and can now sign in.\n\nSee the customer: ${contactUrl}`,
    html: layout(
      "Portal invitation accepted",
      `<p><b>${escapeHtml(personName)}</b> (${escapeHtml(personEmail)}) from <b>${escapeHtml(customerName)}</b> accepted your invitation to the ${escapeHtml(orgName)} customer portal and can now sign in.</p>
${button(contactUrl, "View customer")}`
    ),
  });

module.exports = { sendPortalInvite, sendInviteAccepted, portalLoginUrl, portalActivateUrl };
