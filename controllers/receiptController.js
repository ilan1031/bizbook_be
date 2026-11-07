// Receipt capture: upload a photo or PDF of a receipt, check what was read from
// it, and turn it into an expense in one step.
const mongoose = require("mongoose");
const multer = require("multer");
const ST_CODES = require("../helpers/statusCodeHelpers");
const reader = require("../helpers/receiptReader");
const periodLock = require("../helpers/periodLock");
const Receipt = require("../model/receiptSchema");

const MAX_BYTES = 4 * 1024 * 1024;
const bad = (res, message, code = ST_CODES.BAD_REQUEST) => res.status(code).json({ status: false, success: false, message });
const orgOf = (req) => {
  const raw = String(req.query.org_id || req.body?.org_id || "");
  return /^\d+$/.test(raw) ? raw : null;
};
const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const strictDate = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
};

// The kind of file, from its first bytes (the name and declared type are not trusted).
const sniff = (b) => {
  if (b.length > 4 && b.slice(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (b.length > 8 && b[0] === 0x89 && b.slice(1, 4).toString("latin1") === "PNG") return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single("file");
const toRow = (r) => ({ _id: r._id, file_name: r.file_name, mime: r.mime, size: r.size, status: r.status, vendor: r.vendor, date: r.date, amount: r.amount, note: r.note, read_by_ai: r.read_by_ai, expense_number: r.expense_number, createdAt: r.createdAt });

class ReceiptController {
  // Multipart parsing with clear errors (used as route middleware).
  parse(req, res, next) {
    upload(req, res, (err) => {
      if (!err) return next();
      return bad(res, err.code === "LIMIT_FILE_SIZE" ? "That file is over 4 MB. Use a smaller photo." : "Couldn't read the upload");
    });
  }

  // POST /receipts  multipart: file, org_id
  async create(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!req.file?.buffer?.length) return bad(res, "Choose a photo or PDF of the receipt");
      const mime = sniff(req.file.buffer);
      if (!mime) return bad(res, "Only JPG, PNG, WebP or PDF receipts can be added");
      const found = (await reader.read({ mime, data: req.file.buffer })) || null;
      const r = await Receipt.create({
        organization_id: org, admin_id: res.locals.user_id, file_name: clean(req.file.originalname, 120), mime, size: req.file.size, data: req.file.buffer,
        vendor: found?.vendor || "", date: found?.date && strictDate(found.date) ? found.date : "", amount: found?.amount || 0, note: found?.note || "", read_by_ai: Boolean(found),
      });
      res.status(ST_CODES.CREATED || 201).json({ status: true, data: toRow(r), reader_ready: reader.isConfigured() });
    } catch (error) {
      console.error("receipt create error", error);
      return bad(res, "Couldn't save the receipt", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /receipts?org_id=&status=new|converted|all
  async list(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const q = { organization_id: org };
      const status = req.query.status || "new";
      if (status === "new" || status === "converted") q.status = status;
      const rows = await Receipt.find(q).sort({ createdAt: -1 }).limit(300).lean();
      res.status(ST_CODES.OK).json({ status: true, data: rows.map(toRow), reader_ready: reader.isConfigured() });
    } catch (error) {
      console.error("receipt list error", error);
      return bad(res, "Couldn't load receipts", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /receipts/lookups?org_id=  expense accounts and the accounts money can leave from
  async lookups(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: org }).lean();
      const accounts = coa?.chart_of_accounts || [];
      const pick = (types) => accounts.filter((a) => types.includes(a.account_type)).map((a) => ({ account_id: a.account_id, account_name: a.account_name }));
      res.status(ST_CODES.OK).json({ status: true, data: { expense_accounts: pick(["expense", "cost_of_goods_sold", "other_expense"]), paid_through: pick(["cash", "bank"]) } });
    } catch (error) {
      console.error("receipt lookups error", error);
      return bad(res, "Couldn't load accounts", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // GET /receipts/:id/file  the image or PDF itself
  async file(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Receipt not found", ST_CODES.NOT_FOUND);
      const r = await Receipt.findOne({ _id: req.params.id, organization_id: org }).select("+data").lean();
      if (!r) return bad(res, "Receipt not found", ST_CODES.NOT_FOUND);
      res.set({ "Content-Type": r.mime, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'", "Cache-Control": "private, max-age=300" });
      res.status(200).send(Buffer.from(r.data.buffer || r.data));
    } catch (error) {
      console.error("receipt file error", error);
      return bad(res, "Couldn't open the receipt", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // PATCH /receipts/:id  { vendor?, date?, amount?, note? }
  async update(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Receipt not found", ST_CODES.NOT_FOUND);
      const r = await Receipt.findOne({ _id: req.params.id, organization_id: org });
      if (!r) return bad(res, "Receipt not found", ST_CODES.NOT_FOUND);
      if (r.status !== "new") return bad(res, "This receipt is already an expense");
      if (req.body?.vendor !== undefined) r.vendor = clean(req.body.vendor, 100);
      if (req.body?.note !== undefined) r.note = clean(req.body.note, 200);
      if (req.body?.date !== undefined) {
        if (req.body.date !== "" && !strictDate(req.body.date)) return bad(res, "Enter a valid date");
        r.date = req.body.date;
      }
      if (req.body?.amount !== undefined) {
        const a = req.body.amount === "" ? 0 : Number(req.body.amount);
        if (!Number.isFinite(a) || a < 0 || a > 1e9) return bad(res, "Enter a valid amount");
        r.amount = Math.round(a * 100) / 100;
      }
      await r.save();
      res.status(ST_CODES.OK).json({ status: true, data: toRow(r) });
    } catch (error) {
      console.error("receipt update error", error);
      return bad(res, "Couldn't save", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // POST /receipts/:id/expense  { expense_account_id, expense_account_name, paid_through_account_id, paid_through_account_name, tax_percent? }
  async toExpense(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Receipt not found", ST_CODES.NOT_FOUND);
      const r = await Receipt.findOne({ _id: req.params.id, organization_id: org });
      if (!r) return bad(res, "Receipt not found", ST_CODES.NOT_FOUND);
      if (r.status !== "new") return bad(res, "This receipt is already an expense");
      if (!strictDate(r.date)) return bad(res, "Add the receipt date first");
      if (!(r.amount > 0)) return bad(res, "Add the receipt amount first");
      const b = req.body || {};
      if (!b.expense_account_id || !b.paid_through_account_id) return bad(res, "Choose the expense account and what it was paid from");
      const coa = await mongoose.model("Chart_of_account").findOne({ organization_id: org }).lean();
      const accounts = coa?.chart_of_accounts || [];
      const exp = accounts.find((a) => a.account_id === b.expense_account_id && ["expense", "cost_of_goods_sold", "other_expense"].includes(a.account_type));
      const paid = accounts.find((a) => a.account_id === b.paid_through_account_id && ["cash", "bank"].includes(a.account_type));
      if (!exp) return bad(res, "That isn't an expense account");
      if (!paid) return bad(res, "Pick a cash or bank account to pay from");
      try {
        await periodLock.assertUnlocked(res.locals.user_id, org, [r.date]);
      } catch (e) {
        if (e.code === "PERIOD_LOCKED") return bad(res, e.message);
        throw e;
      }
      const tax = Number(b.tax_percent) || 0;
      if (tax < 0 || tax > 100) return bad(res, "Choose a valid tax rate");

      // The normal expense flow does the pricing and the journal.
      const controller = require("./expensesController");
      let status = 200;
      let payload = null;
      const out = { locals: { user_id: res.locals.user_id }, status(c) { status = c; return this; }, json(p) { payload = p; return this; } };
      await controller.createExpense(
        {
          query: { org_id: org },
          body: {
            date: r.date, vendor_Name: r.vendor, notes: r.note || `Receipt ${r.file_name}`.trim(),
            paid_through_account_id: paid.account_id, paid_through_account_name: paid.account_name,
            lineItems: [{ account_id: exp.account_id, account_name: exp.account_name, amount: r.amount, description: r.note || r.vendor }],
            inclusive_exclusive: "inclusive", expense_tax_percent: tax ? `GST${tax} [${tax}%]` : "",
          },
        },
        out
      );
      if (status >= 300 || payload?.success === false) return bad(res, payload?.message || "Couldn't create the expense", status >= 500 ? ST_CODES.INTERNAL_SERVER_ERROR : ST_CODES.BAD_REQUEST);
      r.status = "converted";
      r.expense_id = String(payload.data?._id || "");
      r.expense_number = String(payload.data?.unique_EX_id || "");
      await r.save();
      res.status(ST_CODES.OK).json({ status: true, message: `Expense ${r.expense_number} created`, data: toRow(r) });
    } catch (error) {
      console.error("receipt to expense error", error);
      return bad(res, "Couldn't create the expense", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }

  // DELETE /receipts/:id  only receipts not yet turned into expenses
  async remove(req, res) {
    try {
      const org = orgOf(req);
      if (!org) return bad(res, "Organization ID is required");
      if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Receipt not found", ST_CODES.NOT_FOUND);
      const r = await Receipt.findOne({ _id: req.params.id, organization_id: org }).lean();
      if (!r) return bad(res, "Receipt not found", ST_CODES.NOT_FOUND);
      if (r.status !== "new") return bad(res, "This receipt is already an expense, so it can't be deleted.");
      await Receipt.deleteOne({ _id: r._id });
      res.status(ST_CODES.OK).json({ status: true, message: "Receipt deleted" });
    } catch (error) {
      console.error("receipt remove error", error);
      return bad(res, "Couldn't delete the receipt", ST_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}

module.exports = new ReceiptController();
