// Credit notes (sales) and vendor credits (purchases), one controller for both.
//
//   Credit note    raise:  Dr line accounts (Sales...)   Cr Accounts Receivable
//                  refund: Dr Accounts Receivable        Cr Cash/Bank
//   Vendor credit  raise:  Dr Accounts Payable           Cr line accounts (COGS...)
//                  refund: Dr Cash/Bank                  Cr Accounts Payable
//
// Applying a credit to an invoice/bill moves value within receivables
// (payables), so it posts no journal: it lowers the invoice/bill balance and
// the credit's balance together, in one transaction.
const mongoose = require("mongoose");
const { CreditNote, VendorCredit } = require("../model/creditDocumentModels");
const InvoiceCollection = require("../model/invoice");
const commonHelper = require("../helpers/commonHelpers");
const ST_CODES = require("../helpers/statusCodeHelpers");
const { toPaise, fromPaise, postingStatusFor } = require("../helpers/accountingHelper");

const JournalCollection = () => mongoose.model("Journal");
const BillCollection = () => mongoose.model("PO_bill");
const ContactCollection = () => mongoose.model("Contact");
const ItemCollection = () => mongoose.model("Item");
const COACollection = () => mongoose.model("Chart_of_account");

const money = (n) => commonHelper.formatRupee(n);
const orgIds = (org) => [String(org), Number(org)].filter((v) => v !== "" && !Number.isNaN(v));

const KINDS = {
  sales: {
    Model: CreditNote,
    prefix: "CN",
    label: "Credit note",
    documentLabel: "invoice",
    contactType: "Customer",
    controlAccount: { id: "AC_019", name: "Accounts Receivable" },
    defaultLineAccount: { id: "AC_046", name: "Sales" },
    // Line accounts are debited (they reverse income).
    lineSide: "Debit",
    journalType: "Credit Note",
    refundType: "Credit Note Refund",
  },
  purchase: {
    Model: VendorCredit,
    prefix: "VC",
    label: "Vendor credit",
    documentLabel: "bill",
    contactType: "Vendor",
    controlAccount: { id: "AC_032", name: "Accounts Payable" },
    defaultLineAccount: { id: "AC_078", name: "Cost of Goods Sold" },
    lineSide: "Credit",
    journalType: "Vendor Credit",
    refundType: "Vendor Credit Refund",
  },
};
const other = (side) => (side === "Debit" ? "Credit" : "Debit");

const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, message });

const accountsOf = async (organization_id) => {
  const coa = await COACollection().findOne({ organization_id: String(organization_id) }).lean();
  return new Map((coa?.chart_of_accounts || []).map((a) => [a.account_id, a]));
};

// ---- documents a credit can be applied to --------------------------------
const salesDocs = {
  async open(organization_id, contact_id, session) {
    const invoices = await InvoiceCollection.find(
      {
        organization_id: { $in: orgIds(organization_id) },
        customer_id: contact_id,
        deleted_at: null,
        status: { $nin: ["draft", "Draft", "void", "Void", "paid", "Paid"] },
      },
      { invoice_id: 1, invoice_number: 1, date: 1, due_date: 1, total: 1, balance: 1 },
      { session }
    ).lean();
    return invoices
      .map((i) => ({
        document_id: i.invoice_id,
        document_number: i.invoice_number,
        date: i.date,
        due_date: i.due_date,
        total: i.total,
        balance: Number(i.balance ?? i.total ?? 0),
      }))
      .filter((d) => d.balance > 0);
  },
  async reduce(organization_id, document_id, amount, session) {
    const filter = { organization_id: { $in: orgIds(organization_id) }, invoice_id: document_id, deleted_at: null };
    const inv = await InvoiceCollection.findOne(filter, null, { session });
    const balance = toPaise(inv.balance ?? inv.total) - toPaise(amount);
    const paid = balance <= 0;
    await InvoiceCollection.updateOne(
      filter,
      {
        $set: {
          balance: fromPaise(Math.max(0, balance)),
          balance_formatted: money(fromPaise(Math.max(0, balance))),
          status: paid ? "paid" : "partially paid",
          status_formatted: paid ? "Paid" : "Partially Paid",
        },
        $inc: { credits_applied: amount },
      },
      { session }
    );
  },
};

const purchaseDocs = {
  async open(organization_id, contact_id, session) {
    if (!mongoose.isValidObjectId(contact_id)) return [];
    const bills = await BillCollection().find(
      {
        organization_id: { $in: orgIds(organization_id) },
        vendor_id: contact_id,
        status_type: { $nin: ["DRAFT", "VOID", "PAID"] },
      },
      { bill_number: 1, billDate: 1, due_date: 1, total: 1, due_amt: 1 },
      { session }
    ).lean();
    return bills
      .map((b) => ({
        document_id: b.bill_number,
        document_number: b.bill_number,
        date: b.billDate,
        due_date: b.due_date,
        total: b.total,
        balance: Number(b.due_amt ?? b.total ?? 0),
      }))
      .filter((d) => d.balance > 0);
  },
  async reduce(organization_id, document_id, amount, session) {
    const filter = { organization_id: { $in: orgIds(organization_id) }, bill_number: document_id };
    const bill = await BillCollection().findOne(filter, null, { session });
    const due = toPaise(bill.due_amt ?? bill.total) - toPaise(amount);
    const paid = due <= 0;
    await BillCollection().updateOne(
      filter,
      {
        $set: {
          due_amt: fromPaise(Math.max(0, due)),
          balance: fromPaise(Math.max(0, due)),
          status: paid ? 3 : 0,
          status_type: paid ? "PAID" : "PARTIALLY PAID",
        },
        $inc: { vendor_credits_applied: amount },
      },
      { session }
    );
  },
};

// ---- helpers --------------------------------------------------------------
// Validates and prices the lines; returns { lines, total } or { error }.
const buildLines = (kind, rawLines, accounts) => {
  if (!Array.isArray(rawLines) || !rawLines.length) return { error: "Add at least one line." };
  const lines = [];
  let total = 0;
  for (const [i, raw] of rawLines.entries()) {
    const n = i + 1;
    const name = String(raw?.name || "").trim();
    const quantity = Number(raw?.quantity ?? 1);
    const rate = Number(raw?.rate);
    if (!name) return { error: `Line ${n}: enter an item or description.` };
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Line ${n}: quantity must be more than 0.` };
    if (!Number.isFinite(rate) || rate <= 0) return { error: `Line ${n}: rate must be more than 0.` };
    const accountId = raw.account_id || kind.defaultLineAccount.id;
    const account = accounts.get(accountId);
    if (!account || account.is_active === false) return { error: `Line ${n}: choose a valid account.` };
    const amount = toPaise(quantity * rate);
    total += amount;
    lines.push({
      item_id: String(raw.item_id || ""),
      name,
      description: String(raw.description || ""),
      quantity,
      rate,
      amount: fromPaise(amount),
      account_id: account.account_id,
      account_name: account.account_name,
    });
  }
  if (total <= 0) return { error: "The total must be more than 0." };
  return { lines, total: fromPaise(total) };
};

const raiseJournalLines = (kind, credit) => {
  const byAccount = new Map();
  for (const l of credit.line_items) {
    const prev = byAccount.get(l.account_id) || { name: l.account_name, paise: 0 };
    prev.paise += toPaise(l.amount);
    byAccount.set(l.account_id, prev);
  }
  const lines = [...byAccount].map(([id, { name, paise }]) => ({
    coa_account_id: id,
    coa_account_name: name,
    creditOrDebit: kind.lineSide,
    amount: fromPaise(paise),
    amount_formatted: money(fromPaise(paise)),
  }));
  lines.push({
    coa_account_id: kind.controlAccount.id,
    coa_account_name: kind.controlAccount.name,
    creditOrDebit: other(kind.lineSide),
    amount: credit.total,
    amount_formatted: money(credit.total),
  });
  return lines;
};

const journalBase = (kind, credit, admin_id) => ({
  organization_id: String(credit.organization_id),
  admin_id,
  journal_date: credit.date,
  journal_date_formatted: commonHelper.formatDateString(credit.date),
  total_amount: credit.total,
  total_amount_formatted: money(credit.total),
  type: kind.journalType,
  reference_number: credit.credit_number,
  ...(kind === KINDS.sales ? { customer_name: credit.contact_name } : { vendor_name: credit.contact_name }),
});

const newJournalId = () => commonHelper.generateUniqueId(JournalCollection(), "journal_id", 5, "JL");
const used = (credit) => credit.applications.length > 0 || credit.refunds.length > 0;

// ---- controller -------------------------------------------------------------
const makeController = (kind) => {
  const docs = kind === KINDS.sales ? salesDocs : purchaseDocs;
  const find = (req) =>
    kind.Model.findOne({ organization_id: String(req.query.org_id), credit_number: req.params.id });

  const resolveContact = async (organization_id, contact_id) => {
    const query =
      kind === KINDS.sales
        ? { contact_id, contact_type: "Customer" }
        : mongoose.isValidObjectId(contact_id)
        ? { _id: contact_id, contact_type: "Vendor" }
        : null;
    if (!query) return null;
    return ContactCollection().findOne({ ...query, organization_id: String(organization_id), deleted_at: null }).lean();
  };

  return {
    // Customers/vendors, items and accounts for the form.
    async lookups(req, res) {
      try {
        const organization_id = String(req.query.org_id || "");
        if (!organization_id) return bad(res, "org_id is required");
        const [contacts, items, accounts] = await Promise.all([
          ContactCollection()
            .find(
              { organization_id, contact_type: kind.contactType, deleted_at: null },
              { contact_id: 1, contact_name: 1, company_name: 1, email: 1 }
            )
            .sort({ contact_name: 1 })
            .lean(),
          ItemCollection()
            .find(
              { organization_id, deleted_at: null, status: { $ne: "inactive" } },
              { item_id: 1, name: 1, rate: 1, purchase_rate: 1, description: 1 }
            )
            .sort({ name: 1 })
            .lean(),
          accountsOf(organization_id),
        ]);
        return res.status(ST_CODES.OK).json({
          status: true,
          data: {
            contacts: contacts.map((c) => ({
              id: kind === KINDS.sales ? c.contact_id : String(c._id),
              name: c.contact_name,
              company_name: c.company_name || "",
              email: c.email || "",
            })),
            items: items.map((i) => ({
              item_id: i.item_id,
              name: i.name,
              rate: kind === KINDS.sales ? i.rate : i.purchase_rate ?? i.rate,
              description: i.description || "",
            })),
            accounts: [...accounts.values()]
              .filter((a) => a.is_active !== false)
              .map((a) => ({ account_id: a.account_id, account_name: a.account_name, account_type: a.account_type })),
            default_account_id: kind.defaultLineAccount.id,
          },
        });
      } catch (error) {
        console.error(`${kind.label} lookups error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    async list(req, res) {
      try {
        const organization_id = String(req.query.org_id || "");
        if (!organization_id) return bad(res, "org_id is required");
        const query = { organization_id };
        if (["draft", "open", "closed", "void"].includes(req.query.status)) query.status = req.query.status;
        if (req.query.search) {
          const re = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
          query.$or = [{ credit_number: re }, { contact_name: re }, { reference_number: re }];
        }
        const credits = await kind.Model.find(query, { applications: 0, refunds: 0, line_items: 0 })
          .sort({ date: -1, createdAt: -1 })
          .limit(Math.min(Number(req.query.limit) || 200, 500))
          .lean();
        return res.status(ST_CODES.OK).json({ status: true, data: credits });
      } catch (error) {
        console.error(`${kind.label} list error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    async get(req, res) {
      try {
        const credit = await find(req).lean();
        if (!credit) return bad(res, `${kind.label} not found`, ST_CODES.NOT_FOUND);
        const journals = await JournalCollection()
          .find({ organization_id: credit.organization_id, journal_id: { $in: [credit.journal_id, ...credit.refunds.map((r) => r.journal_id)].filter(Boolean) } })
          .lean();
        return res.status(ST_CODES.OK).json({ status: true, data: { ...credit, journals } });
      } catch (error) {
        console.error(`${kind.label} get error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    async create(req, res) {
      try {
        const organization_id = String(req.query.org_id || "");
        const body = req.body || {};
        if (!organization_id) return bad(res, "org_id is required");
        const contact = await resolveContact(organization_id, body.contact_id);
        if (!contact) return bad(res, `Choose a ${kind.contactType.toLowerCase()}.`);
        if (!body.date || Number.isNaN(new Date(body.date).getTime())) return bad(res, "Pick a valid date.");
        const accounts = await accountsOf(organization_id);
        const built = buildLines(kind, body.line_items, accounts);
        if (built.error) return bad(res, built.error);
        const status = body.status === "draft" ? "draft" : "open";

        const credit_number = await commonHelper.generateUniqueId(kind.Model, "credit_number", 5, kind.prefix);
        const journal_id = await newJournalId();
        const credit = new kind.Model({
          organization_id,
          admin_id: res.locals.user_id,
          credit_number,
          contact_id: body.contact_id,
          contact_name: contact.contact_name,
          date: new Date(body.date),
          reference_number: String(body.reference_number || "").slice(0, 100),
          notes: String(body.notes || "").slice(0, 2000),
          line_items: built.lines,
          total: built.total,
          balance: built.total,
          status,
          journal_id,
        });
        await mongoose.connection.transaction(async (session) => {
          await JournalCollection().create(
            [
              {
                ...journalBase(kind, credit, res.locals.user_id),
                journal_id,
                line_items: raiseJournalLines(kind, credit),
                posting_status: postingStatusFor(status),
              },
            ],
            { session }
          );
          await credit.save({ session });
        });
        return res.status(ST_CODES.CREATED).json({ status: true, message: `${kind.label} created`, data: credit });
      } catch (error) {
        console.error(`${kind.label} create error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    // Edits are allowed until the credit has been applied or refunded.
    async update(req, res) {
      try {
        const credit = await find(req);
        if (!credit) return bad(res, `${kind.label} not found`, ST_CODES.NOT_FOUND);
        if (used(credit)) return bad(res, `This ${kind.label.toLowerCase()} has been used, so it can't be edited.`);
        if (credit.status === "void") return bad(res, `A void ${kind.label.toLowerCase()} can't be edited.`);
        const body = req.body || {};
        const contact = await resolveContact(credit.organization_id, body.contact_id || credit.contact_id);
        if (!contact) return bad(res, `Choose a ${kind.contactType.toLowerCase()}.`);
        const date = body.date ? new Date(body.date) : credit.date;
        if (Number.isNaN(date.getTime())) return bad(res, "Pick a valid date.");
        const built = buildLines(kind, body.line_items, await accountsOf(credit.organization_id));
        if (built.error) return bad(res, built.error);

        Object.assign(credit, {
          contact_id: body.contact_id || credit.contact_id,
          contact_name: contact.contact_name,
          date,
          reference_number: String(body.reference_number ?? credit.reference_number).slice(0, 100),
          notes: String(body.notes ?? credit.notes).slice(0, 2000),
          line_items: built.lines,
          total: built.total,
          balance: built.total,
        });
        if (body.status === "open" || body.status === "draft") credit.status = body.status;
        await mongoose.connection.transaction(async (session) => {
          await JournalCollection().updateOne(
            { journal_id: credit.journal_id, organization_id: credit.organization_id },
            {
              $set: {
                ...journalBase(kind, credit, credit.admin_id),
                line_items: raiseJournalLines(kind, credit),
                posting_status: postingStatusFor(credit.status),
              },
            },
            { session }
          );
          await credit.save({ session });
        });
        return res.status(ST_CODES.OK).json({ status: true, message: `${kind.label} updated`, data: credit });
      } catch (error) {
        console.error(`${kind.label} update error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    // open (from draft), draft (back from open) or void - only while unused.
    async setStatus(req, res) {
      try {
        const credit = await find(req);
        if (!credit) return bad(res, `${kind.label} not found`, ST_CODES.NOT_FOUND);
        const status = req.body?.status;
        if (!["open", "draft", "void"].includes(status)) return bad(res, "Unknown status");
        if (used(credit)) return bad(res, `This ${kind.label.toLowerCase()} has been used, so its status can't change.`);
        if (credit.status === "void" && status !== "open") return bad(res, `This ${kind.label.toLowerCase()} is void.`);
        credit.status = status;
        await mongoose.connection.transaction(async (session) => {
          await JournalCollection().updateOne(
            { journal_id: credit.journal_id, organization_id: credit.organization_id },
            { $set: { posting_status: postingStatusFor(status) } },
            { session }
          );
          await credit.save({ session });
        });
        return res.status(ST_CODES.OK).json({ status: true, message: `${kind.label} marked ${status}`, data: credit });
      } catch (error) {
        console.error(`${kind.label} status error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    async remove(req, res) {
      try {
        const credit = await find(req);
        if (!credit) return bad(res, `${kind.label} not found`, ST_CODES.NOT_FOUND);
        if (used(credit)) return bad(res, `This ${kind.label.toLowerCase()} has been used; void it instead of deleting.`);
        await mongoose.connection.transaction(async (session) => {
          await JournalCollection().deleteOne({ journal_id: credit.journal_id, organization_id: credit.organization_id }, { session });
          await kind.Model.deleteOne({ _id: credit._id }, { session });
        });
        return res.status(ST_CODES.OK).json({ status: true, message: `${kind.label} deleted` });
      } catch (error) {
        console.error(`${kind.label} delete error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    // The contact's invoices/bills that still have something due.
    async openDocuments(req, res) {
      try {
        const credit = await find(req).lean();
        if (!credit) return bad(res, `${kind.label} not found`, ST_CODES.NOT_FOUND);
        const documents = await docs.open(credit.organization_id, credit.contact_id);
        return res.status(ST_CODES.OK).json({ status: true, data: documents });
      } catch (error) {
        console.error(`${kind.label} open documents error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    // body: { applications: [{ document_id, amount }] }
    async apply(req, res) {
      try {
        const requested = (Array.isArray(req.body?.applications) ? req.body.applications : [])
          .map((a) => ({ document_id: String(a?.document_id || ""), paise: toPaise(a?.amount) }))
          .filter((a) => a.document_id && a.paise > 0);
        if (!requested.length) return bad(res, "Enter an amount to apply.");

        let result;
        await mongoose.connection.transaction(async (session) => {
          const credit = await kind.Model.findOne(
            { organization_id: String(req.query.org_id), credit_number: req.params.id },
            null,
            { session }
          );
          if (!credit) throw Object.assign(new Error(`${kind.label} not found`), { status: 404 });
          if (credit.status !== "open") throw Object.assign(new Error(`Only an open ${kind.label.toLowerCase()} can be applied.`), { status: 400 });
          const total = requested.reduce((s, a) => s + a.paise, 0);
          if (total > toPaise(credit.balance)) {
            throw Object.assign(new Error(`Only ${money(credit.balance)} of this credit is left.`), { status: 400 });
          }
          const open = new Map((await docs.open(credit.organization_id, credit.contact_id, session)).map((d) => [d.document_id, d]));
          for (const a of requested) {
            const doc = open.get(a.document_id);
            if (!doc) throw Object.assign(new Error(`That ${kind.documentLabel} isn't open for this contact.`), { status: 400 });
            if (a.paise > toPaise(doc.balance)) {
              throw Object.assign(new Error(`${doc.document_number} has only ${money(doc.balance)} due.`), { status: 400 });
            }
            await docs.reduce(credit.organization_id, a.document_id, fromPaise(a.paise), session);
            credit.applications.push({ document_id: a.document_id, document_number: doc.document_number, amount: fromPaise(a.paise), date: new Date() });
          }
          credit.balance = fromPaise(toPaise(credit.balance) - total);
          if (toPaise(credit.balance) === 0) credit.status = "closed";
          await credit.save({ session });
          result = credit;
        });
        return res.status(ST_CODES.OK).json({ status: true, message: "Credit applied", data: result });
      } catch (error) {
        if (error.status) return bad(res, error.message, error.status);
        console.error(`${kind.label} apply error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },

    // body: { amount, date, account_id, mode, reference_number }
    async refund(req, res) {
      try {
        const body = req.body || {};
        const paise = toPaise(body.amount);
        if (paise <= 0) return bad(res, "Enter the refund amount.");
        if (!body.date || Number.isNaN(new Date(body.date).getTime())) return bad(res, "Pick a valid date.");

        let result;
        await mongoose.connection.transaction(async (session) => {
          const credit = await kind.Model.findOne(
            { organization_id: String(req.query.org_id), credit_number: req.params.id },
            null,
            { session }
          );
          if (!credit) throw Object.assign(new Error(`${kind.label} not found`), { status: 404 });
          if (credit.status !== "open") throw Object.assign(new Error(`Only an open ${kind.label.toLowerCase()} can be refunded.`), { status: 400 });
          if (paise > toPaise(credit.balance)) {
            throw Object.assign(new Error(`Only ${money(credit.balance)} of this credit is left.`), { status: 400 });
          }
          const account = (await accountsOf(credit.organization_id)).get(body.account_id);
          if (!account || !["cash", "bank"].includes(account.account_type)) {
            throw Object.assign(new Error("Choose a cash or bank account."), { status: 400 });
          }
          const amount = fromPaise(paise);
          const journal_id = await newJournalId();
          // Refund reverses the control account and moves the cash.
          const control = {
            coa_account_id: kind.controlAccount.id,
            coa_account_name: kind.controlAccount.name,
            creditOrDebit: kind.lineSide,
            amount,
            amount_formatted: money(amount),
          };
          const cash = {
            coa_account_id: account.account_id,
            coa_account_name: account.account_name,
            creditOrDebit: other(kind.lineSide),
            amount,
            amount_formatted: money(amount),
          };
          await JournalCollection().create(
            [
              {
                ...journalBase(kind, credit, res.locals.user_id),
                journal_id,
                journal_date: new Date(body.date),
                journal_date_formatted: commonHelper.formatDateString(body.date),
                total_amount: amount,
                total_amount_formatted: money(amount),
                type: kind.refundType,
                line_items: [control, cash],
              },
            ],
            { session }
          );
          credit.refunds.push({
            amount,
            date: new Date(body.date),
            account_id: account.account_id,
            account_name: account.account_name,
            mode: String(body.mode || "").slice(0, 40),
            reference_number: String(body.reference_number || "").slice(0, 100),
            journal_id,
          });
          credit.balance = fromPaise(toPaise(credit.balance) - paise);
          if (toPaise(credit.balance) === 0) credit.status = "closed";
          await credit.save({ session });
          result = credit;
        });
        return res.status(ST_CODES.OK).json({ status: true, message: "Refund recorded", data: result });
      } catch (error) {
        if (error.status) return bad(res, error.message, error.status);
        console.error(`${kind.label} refund error:`, error);
        return bad(res, "Something went wrong", ST_CODES.INTERNAL_SERVER_ERROR);
      }
    },
  };
};

module.exports = {
  creditNotes: makeController(KINDS.sales),
  vendorCredits: makeController(KINDS.purchase),
};
