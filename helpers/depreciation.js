// Depreciation schedules for fixed assets. Everything is whole paise, month by
// month, so the schedule always adds up to exactly the depreciable amount.
//
//   straight_line - (cost - salvage) spread evenly over useful_life_months;
//                   the last month takes the rounding remainder.
//   wdv           - written-down value: each month takes rate%/12 of what is
//                   left, never taking the book value below the salvage value.
const dayjs = require("dayjs");

const MAX_MONTHS = 1200;
const toPaise = (v) => Math.round(Number(v || 0) * 100);

// [{ index, month: "YYYY-MM", date: "YYYY-MM-DD" (month end), amount, accumulated, book_value }] in paise.
const buildSchedule = (asset) => {
  const cost = toPaise(asset.cost);
  const salvage = toPaise(asset.salvage_value);
  const start = dayjs(asset.depreciation_start_date).startOf("month");
  const out = [];
  let accumulated = 0;
  const push = (index, amount) => {
    accumulated += amount;
    const monthStart = start.add(index, "month");
    out.push({ index, month: monthStart.format("YYYY-MM"), date: monthStart.endOf("month").format("YYYY-MM-DD"), amount, accumulated, book_value: cost - accumulated });
  };

  if (asset.method === "wdv") {
    const rate = Number(asset.rate || 0) / 100 / 12;
    for (let i = 0; i < MAX_MONTHS; i++) {
      const book = cost - accumulated;
      let amount = Math.round(book * rate);
      if (book - amount < salvage) amount = book - salvage;
      if (amount <= 0) break;
      push(i, amount);
    }
    return out;
  }

  const life = Math.max(Math.floor(Number(asset.useful_life_months || 0)), 0);
  const depreciable = Math.max(cost - salvage, 0);
  if (!life || !depreciable) return out;
  const each = Math.floor(depreciable / life);
  for (let i = 0; i < Math.min(life, MAX_MONTHS); i++) push(i, i === life - 1 ? depreciable - each * (life - 1) : each);
  return out;
};

// Schedule rows not yet posted, up to and including the month of `upTo`.
const dueEntries = (asset, upTo) => {
  const lastMonth = dayjs(upTo).format("YYYY-MM");
  const posted = new Set((asset.postings || []).map((p) => p.month));
  return buildSchedule(asset).filter((row) => row.month <= lastMonth && !posted.has(row.month));
};

module.exports = { buildSchedule, dueEntries, MAX_MONTHS };
