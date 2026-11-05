// Team emails: the invitation a person gets to join an organisation's team.
// Sent from the organisation's name (like the customer portal invite) and
// returns the mailer's { ok, channel?, error? }; never throws.
const mailer = require("./mailer");
const { escapeHtml, layout } = mailer;

const appBase = () =>
  String(process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");

const acceptUrl = (token) => `${appBase()}/team/accept-invite?token=${encodeURIComponent(token)}`;

const button = (href, label) =>
  `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="background:#1b7a2f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(label)}</a></p>`;

const sendTeamInvite = async ({ to, name, orgName, orgEmail, roleName, token, needsPassword, invitedBy }) => {
  const url = acceptUrl(token);
  const action = needsPassword ? "Accept the invitation and choose your password" : "Accept the invitation";
  const who = invitedBy ? ` (${invitedBy})` : "";
  return mailer.sendMail({
    to,
    fromName: orgName,
    replyTo: orgEmail || undefined,
    subject: `${orgName} invited you to join its team on BizBooks`,
    text:
      `Hi ${name},\n\n${orgName}${who} has invited you to join its team on BizBooks as ${roleName}.\n\n` +
      `${action} (the link works once, for 24 hours):\n${url}\n\n` +
      `If you weren't expecting this, you can ignore this email.`,
    html: layout(
      `Join the ${orgName} team`,
      `<p>Hi ${escapeHtml(name)},</p>
<p><b>${escapeHtml(orgName)}</b>${escapeHtml(who)} has invited you to join its team on BizBooks as <b>${escapeHtml(roleName)}</b>.</p>
${button(url, "Accept invitation")}
<p style="color:#6c718a;font-size:13px">${escapeHtml(action)}. The link works once, for 24 hours. If you weren't expecting this, you can ignore this email.</p>`
    ),
  });
};

module.exports = { sendTeamInvite, acceptUrl };
