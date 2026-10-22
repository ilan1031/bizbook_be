# BizBooks API

Express + MongoDB backend for BizBooks.

## Run locally

```bash
npm install
cp .env.example .env   # then fill in DB_Coll, JWT_SECRET, SUPERADMIN_*
npm run dev            # auto-restarts on changes; `npm start` for production
```

The API listens on `PORT` (default 4000). `GET /api-health` reports server and database status.

## Access control

- **Superadmin.** The account in `SUPERADMIN_EMAIL` is created (or promoted) on startup. It can always sign in and manages everyone else under **Users & Access** in the app.
- **Sign-up needs approval.** New accounts start as *pending* and can't sign in until the superadmin activates them. Inactive accounts are refused too, including any sessions that are already open.
- **Pages and actions.** A user sees nothing until the superadmin switches pages on, each with view / create / edit / delete, plus **convert** on quotes, sales orders and delivery challans. Import, Tally vouchers, the AI assistant and the **Customer Portal** are pages too: with the portal off, that user's customers can't sign in to it. Portal sign-ins can only reach the portal's own endpoints. The same permissions are enforced on every API call (`helpers/rbac.js`, `middleware/userMiddleware.js`).
- **Device (IP) limit.** Each user may sign in from up to `ip_limit` IP addresses (default 2). The sign-up IP is the first one. A new IP within the limit is added on sign-in (after the emailed code). Beyond the limit, sign-in is refused until the superadmin removes an old IP.
- **Sign-in codes by email.** With `LOGIN_OTP_ENABLED=true`, every sign-in (the superadmin's included) needs a 6-digit code emailed to the user. Set `LOGIN_OTP_MODE=new_device` to ask only from a new IP. In production, codes need `EMAIL_USER` / `EMAIL_PASS`; without them codes are off rather than locking anyone out. Locally, without them, emails are printed in the server log.
- **Account emails.** Every sign-up emails the superadmin (with a link to Users & Access), and activating a pending user emails them that they're approved. Same mailbox settings.
- **Gmail setup.** In the Google account you'll send from: turn on 2-Step Verification, open https://myaccount.google.com/apppasswords, create an app password (any name, e.g. BizBooks), and put the 16 letters in `EMAIL_PASS` with the address in `EMAIL_USER`. Check it with `node scripts/test-email.js you@example.com` or **Send test email** under Users & Access.

## Tests

```bash
TEST_DB_URL="mongodb://127.0.0.1:27017/bizbooks_test?replicaSet=rs0" npm test
```

The tests drop and recreate their own databases (`bizbooks_test`, `bizbooks_test_ledger`), so never point `TEST_DB_URL` at real data. Bills use transactions, so MongoDB must run as a replica set. `tests/integration/ledger.test.js` runs a full bookkeeping cycle and checks that every journal balances and that the P&L, balance sheet and dashboard agree.

## Books: what counts

Every invoice, bill, payment, expense and manual journal posts a journal. A journal's `posting_status` follows its document: journals of **draft** or **void** invoices and bills, and of online (Razorpay) payments not yet captured, are kept but left out of every report until the document is posted.

**Credit notes and vendor credits** (`/api/v1/credit-notes`, `/api/v1/vendor-credits`) post a journal when raised:
- A credit note debits the line accounts (Sales by default) and credits Accounts Receivable.
- A vendor credit debits Accounts Payable and credits the line accounts (COGS by default).

Applying a credit to an invoice or bill lowers both balances and posts no journal. A refund posts against a cash or bank account. A credit can be edited, voided or deleted only until it has been applied or refunded.

For data created before this rule, run once:

```bash
node scripts/backfill-posting-status.js           # dry run: lists what would change
node scripts/backfill-posting-status.js --apply   # writes it
```

## Deploy on Render

1. **Create the service.** New → Blueprint, pick this repo; `render.yaml` sets up the web service. Or create a Web Service by hand: build `npm install`, start `npm start`.
2. **Fill in the environment variables** Render asks for:
   - `DB_Coll`: the Atlas connection string.
   - `FRONTEND_URL`: your Vercel URL, without a trailing slash.
   - `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`.
   - Any integrations you use.

   `TRUST_PROXY=1` is already set; it's required for correct client IPs behind Render's proxy.
3. **Allow Render to reach the database.** In Atlas → Network Access, allow Render's outbound IPs, or `0.0.0.0/0`.

Uploaded files are stored on local disk (`uploads/`), which is temporary on Render. Use a persistent disk or move uploads to ImageKit for production.
