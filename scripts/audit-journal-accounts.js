// Read-only audit of journal line items against each organisation's chart of
// accounts. Lists lines whose coa_account_id doesn't exist in the chart, or
// whose stored label doesn't match the account the ID points at (e.g. bills
// that posted "Accounts Payable" to AC_020 Furniture and Equipment before
// that mapping was fixed). Nothing is modified.
//
// Usage:  node scripts/audit-journal-accounts.js            (uses DB_Coll from .env)
//         node scripts/audit-journal-accounts.js <mongo-uri>
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

const nameKey = (name) =>
  String(name || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/s$/, "");

(async () => {
  const uri = process.argv[2] || process.env.DB_Coll;
  if (!uri) {
    console.error("No MongoDB URI: pass one as an argument or set DB_Coll in .env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const charts = new Map();
  for await (const coa of db.collection("chart_of_accounts").find({})) {
    charts.set(
      `${coa.organization_id}|${coa.admin_id}`,
      new Map((coa.chart_of_accounts || []).map((a) => [a.account_id, a]))
    );
  }

  const findings = new Map(); // key -> { org, id, label, actual, journals:Set, amount }
  let journalsChecked = 0;
  for await (const j of db.collection("journals").find({})) {
    journalsChecked++;
    const chart = charts.get(`${j.organization_id}|${j.admin_id}`);
    for (const line of j.line_items || []) {
      const acc = chart && chart.get(line.coa_account_id);
      let problem = null;
      if (!chart) problem = "organisation has no chart of accounts";
      else if (!acc) problem = "ID not in chart";
      else if (line.coa_account_name && nameKey(acc.account_name) !== nameKey(line.coa_account_name))
        problem = `ID is "${acc.account_name}" (${acc.account_type})`;
      if (!problem) continue;
      const key = `${j.organization_id}|${line.coa_account_id}|${line.coa_account_name}`;
      const f = findings.get(key) || {
        org: j.organization_id,
        id: line.coa_account_id || "(empty)",
        label: line.coa_account_name || "(none)",
        problem,
        journals: new Set(),
        types: new Set(),
        amount: 0,
      };
      f.journals.add(j.journal_id);
      f.types.add(j.type);
      f.amount += Number(line.amount) || 0;
      findings.set(key, f);
    }
  }

  console.log(`Checked ${journalsChecked} journals.`);
  if (!findings.size) {
    console.log("No mismatched journal lines found.");
  } else {
    console.log(`${findings.size} mismatched account mapping(s):\n`);
    for (const f of findings.values()) {
      console.log(
        `org ${f.org}: ${f.id} labelled "${f.label}" -> ${f.problem}\n` +
          `   ${f.journals.size} journal(s) [${[...f.types].join(", ")}], total ₹${f.amount.toFixed(2)}\n` +
          `   e.g. ${[...f.journals].slice(0, 5).join(", ")}`
      );
    }
  }
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
