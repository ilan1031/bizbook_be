// Copies helpers/fieldRules.js to the frontend (src/utils/fieldRules.ts) so the
// browser and the server use one rule set.   node scripts/sync-field-rules.js
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../helpers/fieldRules.js"), "utf8");
const target = path.join(__dirname, "../../bizbooks-frontend/src/utils/fieldRules.ts");
const body = src
  .replace(/^module\.exports = \{([^}]*)\};\s*$/m, (_, names) => `export { ${names.trim()} };`)
  .replace("// One rule set for every input field in BizBooks.", "// GENERATED from bizbooks-backend/helpers/fieldRules.js by scripts/sync-field-rules.js. Edit that file, not this one.\n// One rule set for every input field in BizBooks.");
fs.writeFileSync(target, `// @ts-nocheck\n${body}`);
console.log("written", target);
