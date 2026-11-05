// Settings that depend on where the API is hosted.

// How many reverse-proxy hops Express should trust for the client's IP
// (req.ip, which the per-user IP allow-list and the rate limiter use).
//   TRUST_PROXY=1 (or a number / "loopback" ...) sets it explicitly;
//   on Render (RENDER is always set there) it defaults to 1, because every
//   request there arrives through Render's proxy with X-Forwarded-For - left
//   unset, express-rate-limit rejects every request and all clients look
//   like one IP;
//   anywhere else it stays off, so a client can't fake its address.
const trustProxySetting = (env = process.env) => {
  if (env.TRUST_PROXY) {
    const hops = Number(env.TRUST_PROXY);
    return Number.isNaN(hops) ? env.TRUST_PROXY : hops;
  }
  return env.RENDER ? 1 : undefined;
};

// CORS: the origins allowed to call the API from a browser. FRONTEND_URL and
// PORTAL_URL may each list several, comma-separated. An entry may use "*" for
// one hostname label, e.g. https://*.vercel.app for Vercel preview URLs.
const originMatchers = (env = process.env) =>
  [...new Set([...String(env.FRONTEND_URL || "").split(","), ...String(env.PORTAL_URL || "").split(","), "http://localhost:3000"])]
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .map((entry) =>
      entry.includes("*")
        ? new RegExp("^" + entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^./]+") + "$", "i")
        : entry
    );

const isOriginAllowed = (origin, matchers) =>
  !origin || matchers.some((m) => (typeof m === "string" ? m === origin : m.test(origin)));

module.exports = { trustProxySetting, originMatchers, isOriginAllowed };
