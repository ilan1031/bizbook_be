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
- **Pages and actions.** A user sees nothing until the superadmin grants pages, each with view / create / edit / delete. The same permissions are enforced on every API call (`helpers/rbac.js`, `middleware/userMiddleware.js`).
- **Device (IP) limit.** Each user may sign in from up to `ip_limit` IP addresses (default 2). The sign-up IP is the first one. A new IP within the limit is added on sign-in, after an SMS code when `LOGIN_OTP_ENABLED=true` and an SMS provider is set. Beyond the limit, sign-in is refused until the superadmin removes an old IP.
- **SMS.** `SMS_PROVIDER` selects how messages go out:
  - `console` logs them (development).
  - `fast2sms` is for India: a small free test credit, then pay per SMS, and business SMS needs DLT registration.
  - `twilio` is the third option.

  Messages: sign-up alerts to the superadmin, approval notices to users, and new-device codes.

## Tests

```bash
TEST_DB_URL="mongodb://127.0.0.1:27017/bizbooks_test?replicaSet=rs0" npm test
```

The tests drop and recreate their own databases (`bizbooks_test`, `bizbooks_test_ledger`), so never point `TEST_DB_URL` at real data. Bills use transactions, so MongoDB must run as a replica set. `tests/integration/ledger.test.js` runs a full bookkeeping cycle and checks that every journal balances and that the P&L, balance sheet and dashboard agree.

## Books: what counts

Every invoice, bill, payment, expense and manual journal posts a journal. A journal's `posting_status` follows its document: journals of **draft** or **void** invoices and bills, and of online (Razorpay) payments not yet captured, are kept but left out of every report until the document is posted.

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
