// Endpoints behind the top bar: global search, notifications and the
// signed-in user's own account (profile, password).
//
// They live under /api/v1/user/ (open to any active user), so each one
// checks page permissions itself: a user only finds or hears about records
// on pages they may view. The organisation is checked by authMiddleware.
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ST_CODES = require("../helpers/statusCodeHelpers");
const stockHelper = require("../helpers/stockHelper");
const Contact = require("../model/contactModel");
const Item = require("../model/Item");
const Estimate = require("../model/quotes");
const Invoice = require("../model/invoice");
const SalesOrder = require("../model/salesOrder");
const DeliveryChallan = require("../model/deliveryChallan");
const PurchaseOrder = require("../model/purchaseOrder");
const Bill = require("../model/billsSchema");
const Expense = require("../model/expenseModel");
const { CreditNote, VendorCredit } = require("../model/creditDocumentModels");
const { toPaise, fromPaise } = require("../helpers/accountingHelper");

const ContactPerson = require("../model/contactPerson");
const CustomerPayment = require("../model/customerPayment");
const Organization = require("../model/organizationSchema");
const TeamAudit = require("../model/teamAuditSchema");
const UsersCollection = mongoose.model("user");
const ClientCollection = mongoose.model("clients");

const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(?=.{8,})/;
const PER_TYPE = 5;
const RECENT_LIMIT = 10;
const DAY = 24 * 60 * 60 * 1000;

const canView = (user, page) =>
  user.role === "superadmin" ||
  (Array.isArray(user.permissions?.[page]) && user.permissions[page].includes("view"));

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// organization_id is stored as a string in most collections, a number in a
// few; purchase orders call it org_id.
const orgFilter = (orgId, field = "organization_id") => ({
  [field]: { $in: [String(orgId), Number(orgId)].filter((v) => v !== "" && !Number.isNaN(v)) },
});

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const money = (n) => `₹${fromPaise(toPaise(n || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

// What the search box looks through. `fields` are matched case-insensitively;
// `href` builds the link to the record's own page.
const SEARCH_SOURCES = [
  {
    type: "customer", label: "Customers", page: "customers", model: Contact,
    filter: { contact_type: "Customer" }, fields: ["contact_name", "company_name", "email"],
    title: (d) => d.contact_name || d.company_name, subtitle: (d) => d.email || d.company_name,
    href: (d) => `/sales/customer/${d.contact_id}`,
  },
  {
    type: "vendor", label: "Vendors", page: "vendors", model: Contact,
    filter: { contact_type: "Vendor" }, fields: ["contact_name", "company_name", "email"],
    title: (d) => d.contact_name || d.company_name, subtitle: (d) => d.email || d.company_name,
    href: (d) => `/purchase/vendor/${d.contact_id}`,
  },
  {
    type: "item", label: "Items", page: "items", model: Item,
    fields: ["name", "item_name", "sku"],
    title: (d) => d.name || d.item_name, subtitle: (d) => d.sku || d.item_type_formatted,
    href: (d) => `/item/${d.item_id || d._id}`,
  },
  {
    type: "quote", label: "Quotes", page: "quotes", model: Estimate,
    fields: ["estimate_number", "customer_name", "reference_number"],
    title: (d) => d.estimate_number, subtitle: (d) => d.customer_name,
    href: (d) => `/sales/quotes/${d.quote_id}`,
  },
  {
    type: "salesOrder", label: "Sales Orders", page: "salesOrders", model: SalesOrder,
    fields: ["salesorder_number", "customer_name", "reference_number"],
    title: (d) => d.salesorder_number, subtitle: (d) => d.customer_name,
    href: (d) => `/sales/salesOrder/${d.salesorder_id}`,
  },
  {
    type: "deliveryChallan", label: "Delivery Challans", page: "deliveryChallans", model: DeliveryChallan,
    fields: ["deliverychallan_number", "customer_name", "reference_number"],
    title: (d) => d.deliverychallan_number, subtitle: (d) => d.customer_name,
    href: (d) => `/sales/deliveryChallan/${d.deliverychallan_id}`,
  },
  {
    type: "invoice", label: "Invoices", page: "invoices", model: Invoice,
    fields: ["invoice_number", "customer_name", "reference_number"],
    title: (d) => d.invoice_number, subtitle: (d) => d.customer_name,
    href: (d) => `/sales/invoices/${d.invoice_id}`,
  },
  {
    type: "creditNote", label: "Credit Notes", page: "creditNotes", model: CreditNote,
    fields: ["credit_number", "contact_name", "reference_number"],
    title: (d) => d.credit_number, subtitle: (d) => d.contact_name,
    href: (d) => `/sales/creditNotes/${d.credit_number}`,
  },
  {
    type: "purchaseOrder", label: "Purchase Orders", page: "purchaseOrders", model: PurchaseOrder, orgField: "org_id",
    fields: ["purchase_number", "reference_number"],
    title: (d) => d.purchase_number, subtitle: (d) => d.reference_number,
    href: (d) => `/purchase/purchaseorder/${d.purchase_number}`,
  },
  {
    type: "bill", label: "Bills", page: "bills", model: Bill,
    fields: ["bill_number", "reference_number"],
    title: (d) => d.bill_number, subtitle: (d) => d.reference_number,
    href: (d) => `/purchase/bills/${d.bill_number}`,
  },
  {
    type: "vendorCredit", label: "Vendor Credits", page: "vendorCredits", model: VendorCredit,
    fields: ["credit_number", "contact_name", "reference_number"],
    title: (d) => d.credit_number, subtitle: (d) => d.contact_name,
    href: (d) => `/purchase/vendorcredits/${d.credit_number}`,
  },
  {
    type: "expense", label: "Expenses", page: "expenses", model: Expense,
    fields: ["unique_EX_id", "invoice_number", "paid_through_account_name"],
    title: (d) => d.unique_EX_id, subtitle: (d) => d.paid_through_account_name,
    href: (d) => `/purchase/expense/${d.unique_EX_id}`,
  },
];

class WorkspaceController {
  // GET /user/search?organization_id=&q=
  async search(req, res) {
    try {
      const orgId = String(req.query.organization_id || req.query.org_id || "");
      const q = String(req.query.q || "").trim().slice(0, 100);
      if (!orgId) return res.status(ST_CODES.BAD_REQUEST).json({ message: "organization_id is required" });
      if (q.length < 2) return res.status(ST_CODES.OK).json({ data: [] });

      const re = new RegExp(escapeRegex(q), "i");
      const sources = SEARCH_SOURCES.filter((s) => canView(res.user, s.page));
      const groups = await Promise.all(
        sources.map(async (s) => {
          const docs = await s.model
            .find({ ...orgFilter(orgId, s.orgField), ...(s.filter || {}), $or: s.fields.map((f) => ({ [f]: re })) })
            .sort({ _id: -1 })
            .limit(PER_TYPE)
            .lean();
          return docs
            .map((d) => ({
              type: s.type,
              group: s.label,
              title: s.title(d) || "",
              subtitle: s.subtitle(d) || "",
              href: s.href(d),
            }))
            .filter((r) => r.title && !/\/(undefined|null)$/.test(r.href));
        })
      );
      return res.status(ST_CODES.OK).json({ data: groups.flat() });
    } catch (error) {
      console.error("workspace search error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Search failed" });
    }
  }

  // GET /user/notifications?organization_id=
  // Built from the current state of the books, so nothing is stored here.
  // Ids are stable: the organisation, then the event type (plus the record
  // for one-off events such as a payment or a team change). Counts and
  // amounts are never in an id, so a changed number does not make an item
  // unread again. The browser keeps read ids per user and organisation
  // (components/navbar/TopBarMenus.tsx).
  async notifications(req, res) {
    try {
      const orgId = String(req.query.organization_id || req.query.org_id || "");
      const user = res.user;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const soon = new Date(today.getTime() + 7 * DAY);
      const recent = new Date(Date.now() - 7 * DAY);
      const items = [];
      const add = (key, item) => items.push({ id: `${orgId || "none"}:${key}`, ...item });
      const earliest = (dates) => dates.filter(Boolean).reduce((a, b) => (a < b ? a : b), null);

      if (user.role === "superadmin") {
        const pending = await UsersCollection.find({ status: "pending" }).select("email createdAt").sort({ createdAt: -1 }).lean();
        if (pending.length) {
          add("signups", {
            severity: "warning",
            title: `${pending.length} sign-up${pending.length > 1 ? "s" : ""} waiting for approval`,
            detail: pending.slice(0, 3).map((u) => u.email).join(", "),
            href: "/admin/users",
            date: pending[0].createdAt,
          });
        }
      }

      if (orgId && canView(user, "invoices")) {
        const invoices = await Invoice.find(
          { ...orgFilter(orgId), status: { $nin: ["draft", "Draft", "void", "Void", "paid", "Paid"] } },
          { invoice_number: 1, invoice_id: 1, customer_name: 1, due_date: 1, balance: 1, total: 1 }
        ).lean();
        const overdue = invoices.filter((i) => {
          const due = toDate(i.due_date);
          return due && due < today && toPaise(i.balance ?? i.total) > 0;
        });
        if (overdue.length) {
          const amount = overdue.reduce((s, i) => s + toPaise(i.balance ?? i.total), 0);
          add("overdue-invoices", {
            severity: "error",
            title: `${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""} (${money(fromPaise(amount))})`,
            detail: overdue.slice(0, 3).map((i) => `${i.invoice_number} - ${i.customer_name}`).join(", "),
            href: overdue.length === 1 ? `/sales/invoices/${overdue[0].invoice_id}` : "/sales/invoices",
            date: earliest(overdue.map((i) => toDate(i.due_date))),
          });
        }
        const drafts = await Invoice.find({ ...orgFilter(orgId), status: { $in: ["draft", "Draft"] } }, { date: 1 }).lean();
        if (drafts.length) {
          add("draft-invoices", {
            severity: "info",
            title: `${drafts.length} draft invoice${drafts.length > 1 ? "s" : ""} not sent yet`,
            detail: "Drafts don't count in your books until they're sent.",
            href: "/sales/invoices",
            date: drafts.map((d) => toDate(d.date)).filter(Boolean).reduce((a, b) => (a > b ? a : b), null),
          });
        }
      }

      if (orgId && canView(user, "bills")) {
        const bills = await Bill.find(
          { ...orgFilter(orgId), status_type: { $nin: ["DRAFT", "VOID", "PAID"] } },
          { bill_number: 1, due_date: 1, balance: 1, total: 1, due_amt: 1 }
        ).lean();
        const open = bills.filter((b) => toPaise(b.balance ?? b.due_amt ?? b.total) > 0);
        const overdue = open.filter((b) => toDate(b.due_date) && toDate(b.due_date) < today);
        const dueSoon = open.filter((b) => toDate(b.due_date) && toDate(b.due_date) >= today && toDate(b.due_date) <= soon);
        for (const [list, kind, severity, label] of [
          [overdue, "overdue", "error", "overdue"],
          [dueSoon, "due-soon", "warning", "due in the next 7 days"],
        ]) {
          if (!list.length) continue;
          const amount = list.reduce((s, b) => s + toPaise(b.balance ?? b.due_amt ?? b.total), 0);
          add(`bills-${kind}`, {
            severity,
            title: `${list.length} bill${list.length > 1 ? "s" : ""} ${label} (${money(fromPaise(amount))})`,
            detail: list.slice(0, 3).map((b) => b.bill_number).join(", "),
            href: list.length === 1 ? `/purchase/bills/${list[0].bill_number}` : "/purchase/bills",
            date: earliest(list.map((b) => toDate(b.due_date))),
          });
        }
      }

      for (const [page, Model, href, label] of [
        ["creditNotes", CreditNote, "/sales/creditNotes", "credit note"],
        ["vendorCredits", VendorCredit, "/purchase/vendorcredits", "vendor credit"],
      ]) {
        if (!orgId || !canView(user, page)) continue;
        const open = await Model.find({ ...orgFilter(orgId), status: "open", balance: { $gt: 0 } }, { balance: 1 }).lean();
        if (!open.length) continue;
        const amount = open.reduce((s, c) => s + toPaise(c.balance), 0);
        add(`${page}-open`, {
          severity: "info",
          title: `${money(fromPaise(amount))} of ${label}s not yet applied`,
          detail: `${open.length} open ${label}${open.length > 1 ? "s" : ""}. Apply them to ${page === "creditNotes" ? "invoices" : "bills"} or refund them.`,
          href,
        });
      }

      // Customers who accepted a portal invitation in the last week.
      if (orgId && canView(user, "customers")) {
        const accepted = await ContactPerson.find(
          { organization_id: orgId, is_portal_invitation_accepted: true, portal_accepted_at: { $gte: recent } },
          { contact_id: 1, contact_person_id: 1, first_name: 1, last_name: 1, email: 1, portal_accepted_at: 1 }
        )
          .sort({ portal_accepted_at: -1 })
          .lean();
        if (accepted.length) {
          const names = new Map(
            (await Contact.find({ organization_id: orgId, contact_id: { $in: accepted.map((p) => p.contact_id) } }, { contact_id: 1, contact_name: 1 }).lean()).map(
              (c) => [c.contact_id, c.contact_name]
            )
          );
          for (const p of accepted) {
            const who = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email;
            const customer = names.get(p.contact_id) || "A customer";
            add(`portal-accepted-${p.contact_person_id}`, {
              severity: "success",
              title: `${customer} accepted your portal invitation`,
              detail: `${who} (${p.email}) can now sign in to the customer portal.`,
              href: `/sales/customer/${p.contact_id}`,
              date: p.portal_accepted_at,
            });
          }
        }
      }

      // Customer payments recorded in the last week (not online ones still waiting for capture).
      if (orgId && canView(user, "paymentsReceived")) {
        const payments = await CustomerPayment.find(
          { ...orgFilter(orgId), payment_status: "completed", deleted_at: null, createdAt: { $gte: recent } },
          { payment_id: 1, customer_id: 1, amount: 1, payment_mode: 1, createdAt: 1 }
        )
          .sort({ createdAt: -1 })
          .limit(RECENT_LIMIT)
          .lean();
        if (payments.length) {
          const names = new Map(
            (await Contact.find({ ...orgFilter(orgId), contact_id: { $in: payments.map((p) => p.customer_id).filter(Boolean) } }, { contact_id: 1, contact_name: 1 }).lean()).map(
              (c) => [c.contact_id, c.contact_name]
            )
          );
          for (const p of payments) {
            add(`payment-${p.payment_id}`, {
              severity: "success",
              title: `${money(p.amount)} received from ${names.get(p.customer_id) || "a customer"}`,
              detail: `Payment ${p.payment_id}${p.payment_mode ? ` by ${p.payment_mode}` : ""}.`,
              href: `/sales/paymentsReceived/${p.payment_id}`,
              date: p.createdAt,
            });
          }
        }
      }

      // Team: the organisation admin hears about people who joined and about role changes.
      if (orgId && !res.locals.member) {
        const org = await Organization.findOne(orgFilter(orgId, "organization_id"), { admin_id: 1 }).lean();
        if (org && String(org.admin_id) === String(user._id)) {
          const events = await TeamAudit.find({
            ...orgFilter(orgId, "organization_id"),
            action: { $in: ["invite_accepted", "role_changed"] },
            created_at: { $gte: recent },
          })
            .sort({ created_at: -1 })
            .limit(RECENT_LIMIT)
            .lean();
          for (const e of events) {
            const who = e.target_name || e.target_email || "A team member";
            if (e.action === "invite_accepted") {
              add(`team-joined-${e._id}`, {
                severity: "success",
                title: `${who} joined your team`,
                detail: [e.target_email, e.details].filter(Boolean).join(" · "),
                href: "/settings/users",
                date: e.created_at,
              });
            } else {
              add(`team-role-${e._id}`, {
                severity: "info",
                title: `${who}'s role changed`,
                detail: e.details || "",
                href: "/settings/users",
                date: e.created_at,
              });
            }
          }
        }
      }

      // Tracked items at or below their reorder level.
      if (orgId && canView(user, "inventory")) {
        const low = await stockHelper.lowStock(orgId);
        if (low.length) {
          const out = low.filter((i) => Number(i.stock_qty) <= 0).length;
          add("low-stock", {
            severity: out ? "error" : "warning",
            title: `${low.length} item${low.length > 1 ? "s" : ""} low on stock${out ? ` (${out} out of stock)` : ""}`,
            detail: low.slice(0, 3).map((i) => `${i.name || i.item_name}: ${i.stock_qty} left`).join(", "),
            href: "/inventory",
          });
        }
      }

      return res.status(ST_CODES.OK).json({ data: items });
    } catch (error) {
      console.error("workspace notifications error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Couldn't load notifications" });
    }
  }

  // GET /user/profile - the signed-in user's own account details.
  async profile(req, res) {
    // A team member sees their own account, not the organisation admin's.
    const u = res.locals.member ? await UsersCollection.findById(res.locals.actor_id).lean() : res.user;
    return res.status(ST_CODES.OK).json({
      data: {
        email: u.email,
        mobile: u.mobile,
        company_name: u.company_name || "",
        country: u.country || "",
        state: u.state || "",
        role: u.role || "user",
        status: u.status,
        ip_limit: u.ip_limit ?? 2,
        devices: (u.allowed_ips || []).map((e) => ({
          ip: e.ip,
          added_at: e.added_at,
          last_login_at: e.last_login_at,
          user_agent: e.user_agent || "",
        })),
        last_login_at: u.last_login_at,
        created_at: u.createdAt,
      },
    });
  }

  // PATCH /user/profile - company name, mobile, country, state.
  async updateProfile(req, res) {
    try {
      const body = req.body || {};
      const update = {};
      if (body.company_name !== undefined) {
        const name = String(body.company_name).trim();
        if (!name) return res.status(ST_CODES.BAD_REQUEST).json({ message: "Company name is required" });
        if (name.length > 120) return res.status(ST_CODES.BAD_REQUEST).json({ message: "Company name can be at most 120 characters" });
        update.company_name = name;
      }
      if (body.country !== undefined) update.country = String(body.country).trim().slice(0, 60);
      if (body.state !== undefined) update.state = String(body.state).trim().slice(0, 60);
      if (body.mobile !== undefined) {
        const mobile = String(body.mobile).replace(/\D/g, "");
        if (!/^\d{10}$/.test(mobile)) {
          return res.status(ST_CODES.BAD_REQUEST).json({ message: "Enter a valid mobile number (10 digits)" });
        }
        const taken = await UsersCollection.exists({ mobile, _id: { $ne: res.locals.actor_id || res.user._id } });
        if (taken) return res.status(ST_CODES.BAD_REQUEST).json({ message: "This mobile number is already registered to another account" });
        update.mobile = mobile;
      }
      if (!Object.keys(update).length) return res.status(ST_CODES.BAD_REQUEST).json({ message: "Nothing to update" });
      await UsersCollection.updateOne({ _id: res.locals.actor_id || res.user._id }, { $set: update });
      return res.status(ST_CODES.OK).json({ message: "Profile updated" });
    } catch (error) {
      console.error("workspace updateProfile error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Couldn't update the profile" });
    }
  }

  // POST /user/change-password and /client/change-password
  // { current_password, new_password } - the signed-in business user or
  // customer-portal client.
  async changePassword(req, res) {
    try {
      const isClient = res.locals.role === "client";
      if (isClient !== req.path.startsWith("/client/")) {
        return res.status(ST_CODES.FORBIDDEN).json({ message: "Not available for this account" });
      }
      const { current_password: current, new_password: next } = req.body || {};
      if (!current || !next) {
        return res.status(ST_CODES.BAD_REQUEST).json({ message: "Current and new password are required" });
      }
      const Model = isClient ? ClientCollection : UsersCollection;
      const user = await Model.findById(res.locals.actor_id || res.user._id).select("password");
      if (!user || !(await bcrypt.compare(String(current), user.password))) {
        return res.status(ST_CODES.BAD_REQUEST).json({ message: "Current password is incorrect" });
      }
      if (!PASSWORD_RULE.test(String(next))) {
        return res.status(ST_CODES.BAD_REQUEST).json({
          message: "Password must be at least 8 characters with an uppercase letter, a number and a special character.",
        });
      }
      if (String(next) === String(current)) {
        return res.status(ST_CODES.BAD_REQUEST).json({ message: "Choose a password different from the current one" });
      }
      user.password = await bcrypt.hash(String(next), 10);
      if (isClient) {
        await user.save();
        return res.status(ST_CODES.OK).json({ message: "Password changed" });
      }
      // Sessions issued before this moment stop working (see
      // middleware/userMiddleware.js); this one continues with a new token.
      const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      user.password_changed_at = changedAt;
      await user.save();
      const token = jwt.sign({ userId: user._id, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "10d" });
      return res.status(ST_CODES.OK).json({ message: "Password changed", token });
    } catch (error) {
      console.error("workspace changePassword error:", error);
      return res.status(ST_CODES.INTERNAL_SERVER_ERROR).json({ message: "Couldn't change the password" });
    }
  }
}

module.exports = new WorkspaceController();
module.exports.SEARCH_SOURCES = SEARCH_SOURCES;
