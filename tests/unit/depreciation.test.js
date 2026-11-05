const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSchedule, dueEntries } = require("../../helpers/depreciation");

const base = { cost: 120000, salvage_value: 0, depreciation_start_date: "2026-01-15", method: "straight_line", useful_life_months: 12 };
const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);

test("straight line: equal months that add up to exactly cost less salvage", () => {
  const rows = buildSchedule(base);
  assert.equal(rows.length, 12);
  assert.ok(rows.every((r) => r.amount === 1000000), "10,000.00 a month, in paise");
  assert.equal(rows[0].month, "2026-01");
  assert.equal(rows[11].month, "2026-12");
  assert.equal(rows[11].book_value, 0);
  assert.equal(sum(rows), 12000000);
});

test("straight line: the rounding remainder lands on the last month and salvage is kept", () => {
  const rows = buildSchedule({ ...base, cost: 100, salvage_value: 0, useful_life_months: 3 });
  assert.deepEqual(rows.map((r) => r.amount), [3333, 3333, 3334]);
  const withSalvage = buildSchedule({ ...base, cost: 1000, salvage_value: 100, useful_life_months: 9 });
  assert.equal(sum(withSalvage), 90000);
  assert.equal(withSalvage.at(-1).book_value, 10000, "book value ends at the salvage value");
});

test("written-down value: a fixed share of what is left, never below salvage", () => {
  const rows = buildSchedule({ ...base, method: "wdv", cost: 100000, rate: 12, useful_life_months: 0 });
  assert.equal(rows[0].amount, 100000, "1% a month of 1,000.00 in paise: 10,000,000 * 1% = 100,000");
  assert.ok(rows[1].amount < rows[0].amount, "falls as the book value falls");
  assert.ok(rows.every((r) => r.book_value >= 0));
  const floor = buildSchedule({ ...base, method: "wdv", cost: 100000, salvage_value: 90000, rate: 60, useful_life_months: 0 });
  assert.equal(floor.at(-1).book_value, 9000000, "stops at the salvage value");
});

test("nothing to depreciate gives an empty schedule", () => {
  assert.deepEqual(buildSchedule({ ...base, cost: 100, salvage_value: 100 }), []);
  assert.deepEqual(buildSchedule({ ...base, useful_life_months: 0 }), []);
});

test("due months are those up to the month asked for that are not posted yet", () => {
  const asset = { ...base, postings: [{ month: "2026-01" }, { month: "2026-02" }] };
  assert.deepEqual(dueEntries(asset, "2026-04-10").map((r) => r.month), ["2026-03", "2026-04"]);
  assert.deepEqual(dueEntries(asset, "2026-02-28"), []);
  assert.equal(dueEntries({ ...base, postings: [] }, "2030-01-01").length, 12, "never more than the schedule");
});
