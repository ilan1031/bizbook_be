// Emails about a user's account: sign-in codes, sign-up alerts to the
// superadmin, and the "you're approved" notice. All return the mailer's
// { ok, channel?, error? } and never throw.
const mailer = require("./mailer");
const { appUrl, escapeHtml, layout } = mailer;

const maskEmail = (e) => {
  const [name, domain] = String(e || "").split("@");
  if (!domain) return "";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(name.length - 2, 1))}@${domain}`;
};

const button = (href, label) =>
  `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="background:#1b7a2f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(label)}</a></p>`;

// Whether sign-in codes can be delivered (a mailbox, or the log locally).
const canSendCodes = () => mailer.canSendMail();

const sendLoginCode = async (user, code) => {
  const r = await mailer.sendMail({
    to: user.email,
    subject: `${code} is your BizBooks sign-in code`,
    text: `Your BizBooks sign-in code is ${code}. It expires in 5 minutes. Don't share it with anyone.\n\nIf you didn't try to sign in, change your password.`,
    html: layout(
      "Your sign-in code",
      `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:8px 0 16px">${escapeHtml(code)}</p>
<p>It expires in 5 minutes. Don't share it with anyone.</p>
<p style="color:#6c718a;font-size:13px">If you didn't try to sign in, change your password.</p>`
    ),
  });
  return { ...r, sentTo: r.channel === "console" ? "the server log" : maskEmail(user.email) };
};

const sendSignupAlert = async (superadminEmail, newUser) => {
  const rows = [
    ["Name / company", newUser.company_name],
    ["Email", newUser.email],
    ["Mobile", newUser.mobile],
    ["State", newUser.state],
  ].filter(([, v]) => v);
  return mailer.sendMail({
    to: superadminEmail,
    subject: `New BizBooks sign-up waiting for approval: ${newUser.email}`,
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nApprove or decline them in Users & Access: ${appUrl("/admin/users")}`,
    html: layout(
      "A new account is waiting for your approval",
      `<table cellpadding="6" style="font-size:14px">${rows
        .map(([k, v]) => `<tr><td style="color:#6c718a">${escapeHtml(k)}</td><td><b>${escapeHtml(v)}</b></td></tr>`)
        .join("")}</table>
<p>They can't sign in until you activate the account and give them pages.</p>
${button(appUrl("/admin/users"), "Review in Users & Access")}`
    ),
  });
};

const sendApprovedEmail = async (user) =>
  mailer.sendMail({
    to: user.email,
    subject: "Your BizBooks account is approved",
    text: `Good news: your BizBooks account (${user.email}) has been approved. You can sign in and start using it now: ${appUrl("/organisation/login")}\n\nEach time you sign in we'll email you a 6-digit code.`,
    html: layout(
      "Your account is approved",
      `<p>Good news: your BizBooks account <b>${escapeHtml(user.email)}</b> has been approved, and you're ready to start.</p>
${button(appUrl("/organisation/login"), "Sign in to BizBooks")}
<p style="color:#6c718a;font-size:13px">Each time you sign in we'll email you a 6-digit code to confirm it's you.</p>`
    ),
  });

module.exports = { canSendCodes, sendLoginCode, sendSignupAlert, sendApprovedEmail, maskEmail };
