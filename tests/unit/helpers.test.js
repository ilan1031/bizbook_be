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

test("mailer: customer email is checked, sent from the server mailbox, and never claims success when unsent", async () => {
  const mailer = require("../../helpers/mailer");
  const saved = { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS, node: process.env.NODE_ENV };
  try {
    process.env.EMAIL_USER = "";
    process.env.EMAIL_PASS = "";
    const base = { subject: "Quote", html: "<p>x</p>", businessName: "Acme" };
    assert.match((await mailer.sendCustomerMail({ ...base, to: "" })).error, /No recipient/);
    assert.match((await mailer.sendCustomerMail({ ...base, to: "nope" })).error, /isn't a valid email/);
    assert.match((await mailer.sendCustomerMail({ ...base, to: "a@b.co", cc: "bad" })).error, /"bad"/);
    assert.match((await mailer.sendCustomerMail({ to: "a@b.co", html: "x" })).error, /Subject/);
    // No mailbox locally: it's only logged, and the caller is told so.
    process.env.NODE_ENV = "development";
    const log = console.log;
    console.log = () => {};
    const unsent = await mailer.sendCustomerMail({ ...base, to: "a@b.co; c@d.co" });
    console.log = log;
    assert.equal(unsent.ok, false);
    assert.equal(unsent.channel, "console");
    assert.match(unsent.error, /nothing was sent/);
  } finally {
    process.env.EMAIL_USER = saved.user ?? "";
    process.env.EMAIL_PASS = saved.pass ?? "";
    process.env.NODE_ENV = saved.node;
  }
});

test("imageDataUrl: accepts valid images of every size, rejects everything else", () => {
  const validate = require("../../helpers/imageDataUrl");
  const png = (extra) =>
    "data:image/png;base64," + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(extra)]).toString("base64");
  // Base64 has no "=" padding when the size is a multiple of 3; both must pass.
  for (let extra = 0; extra < 12; extra++) assert.equal(validate(png(extra), "Logo"), null, `size ${8 + extra}`);
  assert.equal(validate("", "Logo"), null, "empty clears the image");
  assert.match(validate("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "Logo"), /PNG, JPG or WebP/);
  assert.match(validate("data:text/html;base64,PGI+", "Logo"), /PNG, JPG or WebP/);
  assert.match(validate("data:image/png;base64,@@@@", "Logo"), /PNG, JPG or WebP/);
  assert.match(validate("data:image/png;base64," + Buffer.from("hello world!").toString("base64"), "Logo"), /not a valid/);
  assert.match(validate(png(2 * 1024 * 1024), "Logo"), /smaller than 1 MB/);
});
