// Reads a receipt (photo or PDF) and returns what is printed on it. Needs
// ANTHROPIC_API_KEY; without it, or when reading fails, it returns null and
// the receipt is filled in by hand. Tests can swap in a fake with setReader().
const MODEL = process.env.RECEIPT_MODEL || "claude-haiku-5-5";
const TIMEOUT_MS = 25000;

let override = null;
const setReader = (fn) => {
  override = fn;
};
const isConfigured = () => Boolean(override || process.env.ANTHROPIC_API_KEY);

const PROMPT =
  'Read this receipt or bill. Reply with only a JSON object: {"vendor": string, "date": "YYYY-MM-DD", "amount": number, "note": string}. ' +
  '"amount" is the final total paid, in rupees, as a number. "note" is a few words on what was bought. Use null for anything you cannot read.';

const read = async ({ mime, data }) => {
  if (override) return override({ mime, data });
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const block = mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mime, data: data.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: mime, data: data.toString("base64") } };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }] }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const text = (body.content || []).map((c) => c.text || "").join("");
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) return null;
    const out = JSON.parse(json[0]);
    return {
      vendor: typeof out.vendor === "string" ? out.vendor.slice(0, 100) : "",
      date: typeof out.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : "",
      amount: Number.isFinite(Number(out.amount)) && Number(out.amount) > 0 ? Number(out.amount) : 0,
      note: typeof out.note === "string" ? out.note.slice(0, 200) : "",
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { read, isConfigured, setReader };
