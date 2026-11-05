// Mail over an HTTPS provider (for hosts that block SMTP), the Render proxy
// default, and the CORS origin list. No network: fetch is stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");

const { apiProvider, buildPayload, httpTransport } = require("../../helpers/httpMail");
const { trustProxySetting, originMatchers, isOriginAllowed } = require("../../helpers/hostingConfig");

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};
const NO_MAIL = { BREVO_API_KEY: undefined, RESEND_API_KEY: undefined, EMAIL_PROVIDER: undefined, EMAIL_USER: undefined, EMAIL_PASS: undefined, EMAIL_FROM_ADDRESS: undefined, EMAIL_FROM: undefined, EMAIL_HOST: undefined, RENDER: undefined };

const stubFetch = (reply) => {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return reply(calls.length);
  };
  return { calls, restore: () => (global.fetch = real) };
};
const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

test("provider is chosen from the API key, and EMAIL_PROVIDER=smtp turns it off", () => {
  assert.equal(apiProvider({}), null);
  assert.equal(apiProvider({ BREVO_API_KEY: "k" }), "brevo");
  assert.equal(apiProvider({ RESEND_API_KEY: "k" }), "resend");
  assert.equal(apiProvider({ BREVO_API_KEY: "k", RESEND_API_KEY: "r", EMAIL_PROVIDER: "resend" }), "resend");
  assert.equal(apiProvider({ BREVO_API_KEY: "k", EMAIL_PROVIDER: "smtp" }), null);
});

test("Brevo and Resend request bodies carry sender, recipients, reply-to and attachments", () => {
  const data = {
    from: '"Acme Traders" <mail@acme.test>',
    to: ["a@x.test, b@x.test"],
    cc: "c@x.test",
    replyTo: "owner@acme.test",
    subject: "Invoice 7",
    html: "<p>hi</p>",
    text: "hi",
    attachments: [{ filename: "inv.pdf", content: Buffer.from("PDFDATA") }],
  };
  const brevo = buildPayload("brevo", data);
  assert.deepEqual(brevo.sender, { email: "mail@acme.test", name: "Acme Traders" });
  assert.deepEqual(brevo.to, [{ email: "a@x.test" }, { email: "b@x.test" }]);
  assert.deepEqual(brevo.cc, [{ email: "c@x.test" }]);
  assert.deepEqual(brevo.replyTo, { email: "owner@acme.test" });
  assert.equal(brevo.htmlContent, "<p>hi</p>");
  assert.equal(brevo.attachment[0].content, Buffer.from("PDFDATA").toString("base64"));

  const resend = buildPayload("resend", data);
  assert.equal(resend.from, "Acme Traders <mail@acme.test>");
  assert.deepEqual(resend.to, ["a@x.test", "b@x.test"]);
  assert.equal(resend.reply_to, "owner@acme.test");
  assert.equal(resend.attachments[0].filename, "inv.pdf");

  assert.throws(() => buildPayload("brevo", { ...data, from: "" }), /No sender/);
  assert.throws(() => buildPayload("brevo", { ...data, to: [] }), /No recipient/);
});

test("mailer sends over the HTTPS API and reports a provider refusal", async () => {
  await withEnv({ ...NO_MAIL, BREVO_API_KEY: "key-123", EMAIL_FROM_ADDRESS: "sender@acme.test", NODE_ENV: "production" }, async () => {
    delete require.cache[require.resolve("../../helpers/mailer")];
    const mailer = require("../../helpers/mailer");
    assert.equal(mailer.isMailConfigured(), true);
    assert.match(mailer.mailTarget(), /Brevo API \(HTTPS\)/);

    const ok = stubFetch(() => json(201, { messageId: "<m1@brevo>" }));
    try {
      const r = await mailer.sendMail({ to: "cust@x.test", subject: "Your code", text: "123456", fromName: "BizBooks" });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.channel, "email");
      assert.equal(ok.calls[0].url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(ok.calls[0].init.headers["api-key"], "key-123");
      assert.deepEqual(ok.calls[0].body.sender, { email: "sender@acme.test", name: "BizBooks" });
      assert.deepEqual(ok.calls[0].body.to, [{ email: "cust@x.test" }]);
    } finally {
      ok.restore();
    }

    const refused = stubFetch(() => json(401, { message: "Key not found" }));
    try {
      const r = await mailer.sendMail({ to: "cust@x.test", subject: "s", text: "t" });
      assert.equal(r.ok, false);
      assert.match(r.error, /Brevo refused the email \(401\): Key not found/);
    } finally {
      refused.restore();
    }

    // The same transport serves callers that use getTransporter() directly.
    const direct = stubFetch(() => json(201, { messageId: "<m2@brevo>" }));
    try {
      const info = await mailer.getTransporter().sendMail({ from: "A <sender@acme.test>", to: "z@x.test", subject: "s", html: "<b>x</b>" });
      assert.equal(info.messageId, "<m2@brevo>");
    } finally {
      direct.restore();
    }
  });
  delete require.cache[require.resolve("../../helpers/mailer")];
});

test("an API key without a verified sender address isn't treated as configured", async () => {
  await withEnv({ ...NO_MAIL, BREVO_API_KEY: "key-123", NODE_ENV: "production" }, async () => {
    delete require.cache[require.resolve("../../helpers/mailer")];
    const mailer = require("../../helpers/mailer");
    assert.equal(mailer.isMailConfigured(), false);
    const r = await mailer.sendMail({ to: "a@b.co", subject: "s", text: "t" });
    assert.equal(r.ok, false);
    assert.match(r.error, /BREVO_API_KEY|EMAIL_FROM_ADDRESS/);
  });
  delete require.cache[require.resolve("../../helpers/mailer")];
});

test("SMTP timeouts on Render say that Render blocks SMTP and what to set", async () => {
  await withEnv({ ...NO_MAIL, EMAIL_USER: "me@gmail.test", EMAIL_PASS: "x", RENDER: "true", NODE_ENV: "production" }, async () => {
    delete require.cache[require.resolve("../../helpers/mailer")];
    const mailer = require("../../helpers/mailer");
    const t = mailer.getTransporter();
    const real = t.sendMail;
    t.sendMail = async () => {
      throw new Error("Connection timeout");
    };
    const log = console.error;
    console.error = () => {};
    try {
      const r = await mailer.sendMail({ to: "a@b.co", subject: "s", text: "t" });
      assert.equal(r.ok, false);
      assert.match(r.error, /Connection timeout/);
      assert.match(r.error, /Render's free plan blocks SMTP ports/);
      assert.match(r.error, /BREVO_API_KEY/);
    } finally {
      console.error = log;
      t.sendMail = real;
    }
  });
  delete require.cache[require.resolve("../../helpers/mailer")];
});

test("trust proxy: explicit value wins, Render defaults to 1, elsewhere it stays off", () => {
  assert.equal(trustProxySetting({}), undefined);
  assert.equal(trustProxySetting({ RENDER: "true" }), 1);
  assert.equal(trustProxySetting({ TRUST_PROXY: "2" }), 2);
  assert.equal(trustProxySetting({ TRUST_PROXY: "loopback", RENDER: "true" }), "loopback");
});

test("CORS origins: exact entries, trailing slashes, wildcards, and no other site", () => {
  const m = originMatchers({
    FRONTEND_URL: "https://app.example.com/, https://*.vercel.app",
    PORTAL_URL: "https://portal.example.com",
  });
  assert.ok(isOriginAllowed("https://app.example.com", m));
  assert.ok(isOriginAllowed("https://portal.example.com", m));
  assert.ok(isOriginAllowed("https://bizbook-fe-git-uat-ilan.vercel.app", m));
  assert.ok(isOriginAllowed("http://localhost:3000", m));
  assert.ok(isOriginAllowed(undefined, m), "no Origin header (curl, server-to-server)");
  assert.ok(!isOriginAllowed("https://evil.example.com", m));
  assert.ok(!isOriginAllowed("https://app.example.com.evil.com", m));
  assert.ok(!isOriginAllowed("https://x.y.vercel.app", m), "a wildcard stands for one label only");
  assert.ok(!isOriginAllowed("https://vercel.app", m));
  assert.ok(!isOriginAllowed("http://app.example.com", m), "scheme must match");
});
