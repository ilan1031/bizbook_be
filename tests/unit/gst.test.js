const test = require("node:test");
const assert = require("node:assert/strict");
const { stateCode, priceSalesDocument, invoiceJournalLines } = require("../../helpers/gstHelper");

test("stateCode recognises names, short codes, picker labels, numeric codes and GSTINs", () => {
  assert.equal(stateCode("Tamil Nadu"), "33");
  assert.equal(stateCode("tamilnadu"), "33");
  assert.equal(stateCode("TN"), "33");
  assert.equal(stateCode("[TN] - Tamil Nadu"), "33");
  assert.equal(stateCode("33"), "33");
  assert.equal(stateCode("29ABCDE1234F1Z5"), "29");
  assert.equal(stateCode("Delhi (NCT)"), "07");
  assert.equal(stateCode("Karnataka"), "29");
  assert.equal(stateCode(""), null);
  assert.equal(stateCode("Atlantis"), null);
});

const doc = (extra = {}) => ({
  line_items: [
    { name: "A", quantity: 2, rate: 1000, gst_rate: 18 },
    { name: "B", quantity: 1, rate: 500, gst_rate: 5 },
  ],
  ...extra,
});

test("same state: CGST + SGST, split evenly", () => {
  const d = priceSalesDocument(doc(), { sellerState: "33", placeOfSupply: "Tamil Nadu" });
  assert.equal(d.sub_total, 2500);
  assert.equal(d.supply_type, "intra");
  assert.equal(d.gst_total, 360 + 25);
  assert.equal(d.cgst_total + d.sgst_total, 385);
  assert.equal(d.igst_total, 0);
  assert.equal(d.total, 2885);
  assert.equal(d.line_items[0].cgst_amount, 180);
  assert.equal(d.line_items[1].sgst_amount, 12.5);
});

test("other state: IGST", () => {
  const d = priceSalesDocument(doc(), { sellerState: "33", placeOfSupply: "[KA] - Karnataka" });
  assert.equal(d.supply_type, "inter");
  assert.equal(d.igst_total, 385);
  assert.equal(d.cgst_total, 0);
});

test("overseas and SEZ are zero-rated", () => {
  for (const t of ["Overseas", "Special Economic Zone"]) {
    const d = priceSalesDocument(doc(), { sellerState: "33", placeOfSupply: "KA", gstTreatment: t });
    assert.equal(d.gst_total, 0, t);
    assert.equal(d.total, 2500, t);
  }
});

test("discount is taken before GST; TDS on the pre-GST value; odd paise split", () => {
  const d = priceSalesDocument(
    doc({ discount_percent: 10, tax_type: "TDS", tax_percentage: 10, adjustment: 1 }),
    { sellerState: "33", placeOfSupply: "TN" }
  );
  assert.equal(d.discount_amount, 250);
  // taxable 1800 @18% + 450 @5% = 324 + 22.5
  assert.equal(d.gst_total, 346.5);
  assert.equal(d.tax_total, 225);
  assert.equal(d.total, 2250 + 346.5 - 225 + 1);
  assert.equal(d.cgst_total + d.sgst_total, 346.5);
});

test("invoice journal from a priced document balances", () => {
  for (const extra of [{}, { discount_percent: 7, tax_type: "TCS", tax_percentage: 1, shipping_charge: 99.99, adjustment: -3.33 }]) {
    for (const pos of ["TN", "KA"]) {
      const d = priceSalesDocument(doc(extra), { sellerState: "33", placeOfSupply: pos });
      let net = 0;
      for (const l of invoiceJournalLines(d)) net += (l.creditOrDebit === "Debit" ? 1 : -1) * Math.round(l.amount * 100);
      assert.equal(net, 0, JSON.stringify({ extra, pos }));
    }
  }
});
