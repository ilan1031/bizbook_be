const test = require("node:test");
const assert = require("node:assert/strict");

const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test("mailer: without a mailbox, development logs the email and production refuses", async (t) => {
  const mailer = require("../../helpers/mailer");
  const logged = [];
  t.mock.method(console, "log", (...args) => logged.push(args.join(" ")));
  await withEnv({ EMAIL_USER: undefined, EMAIL_PASS: undefined, NODE_ENV: "development" }, async () => {
    assert.equal(mailer.isMailConfigured(), false);
    assert.equal(mailer.canSendMail(), true);
    const r = await mailer.sendMail({ to: "a@b.c", subject: "Hi", text: "Body" });
    assert.deepEqual(r, { ok: true, channel: "console" });
    assert.match(logged.join("\n"), /\[EMAIL:console\] to a@b\.c: Hi/);
  });
  await withEnv({ EMAIL_USER: undefined, EMAIL_PASS: undefined, NODE_ENV: "production" }, async () => {
    assert.equal(mailer.canSendMail(), false);
    const r = await mailer.sendMail({ to: "a@b.c", subject: "Hi", text: "Body" });
    assert.equal(r.ok, false);
  });
  assert.equal((await mailer.sendMail({ subject: "no recipient" })).ok, false);
});

test("mailer: links use the first FRONTEND_URL; HTML is escaped", async () => {
  const { appUrl, escapeHtml } = require("../../helpers/mailer");
  await withEnv({ FRONTEND_URL: "https://books.example.com/, https://other.example.com" }, async () => {
    assert.equal(appUrl("/admin/users"), "https://books.example.com/admin/users");
  });
  assert.equal(escapeHtml('<b>"x" & y</b>'), "&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
});

test("account emails: code, sign-up alert and approval notice", async (t) => {
  const mailer = require("../../helpers/mailer");
  const emails = require("../../helpers/accountEmails");
  const sent = [];
  t.mock.method(mailer, "sendMail", async (m) => {
    sent.push(m);
    return { ok: true, channel: "email" };
  });
  const code = await emails.sendLoginCode({ email: "user.one@test.local" }, "123456");
  assert.equal(code.sentTo, "us******@test.local");
  assert.match(sent[0].subject, /^123456 /);

  await emails.sendSignupAlert("boss@test.local", { email: "new@test.local", company_name: "<Acme>" });
  assert.equal(sent[1].to, "boss@test.local");
  assert.match(sent[1].html, /&lt;Acme&gt;/, "sign-up details are escaped");
  assert.match(sent[1].text, /\/admin\/users/);

  await emails.sendApprovedEmail({ email: "new@test.local" });
  assert.equal(sent[2].to, "new@test.local");
  assert.match(sent[2].subject, /approved/);
});

test("accountingHelper: paise conversion is exact", () => {
  const { toPaise, fromPaise, isDebitNormal } = require("../../helpers/accountingHelper");
  assert.equal(toPaise(0.1) + toPaise(0.2), toPaise(0.3));
  assert.equal(toPaise("4000.50"), 400050);
  assert.equal(fromPaise(400050), 4000.5);
  assert.equal(isDebitNormal("cash"), true);
  assert.equal(isDebitNormal("expense"), true);
  assert.equal(isDebitNormal("accounts_payable"), false);
  assert.equal(isDebitNormal("income"), false);
});
