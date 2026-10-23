// The backend calls some of its own endpoints over HTTP (loading a contact
// for an email, creating a bill from a recurring profile...). Those calls go
// to this server on its real port and carry the user's token, so access
// rules still apply. They arrive from the loopback address, so the per-user
// IP-address check (which is about the person's device) is skipped for
// requests that also carry this process's secret header.
const crypto = require("crypto");

const HEADER = "x-internal-call";
const SECRET = crypto.randomBytes(24).toString("hex");

// Evaluated when used, after dotenv and the port are known.
const baseUrl = () => `http://127.0.0.1:${process.env.PORT || 4000}/api/v1/`;

const isLoopback = (ip) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(ip || ""));

// True for a request that came from this process's own HTTP client.
const isInternal = (req) => isLoopback(req.socket?.remoteAddress) && req.headers[HEADER] === SECRET;

// Adds the secret to every outgoing axios request aimed at this server.
const installAxiosHeader = (axios) =>
  axios.interceptors.request.use((config) => {
    const url = String(config.baseURL || "") + String(config.url || "");
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(url)) {
      const own = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\]):${process.env.PORT || 4000}/`);
      if (own.test(url)) {
        config.headers = config.headers || {};
        if (typeof config.headers.set === "function") config.headers.set(HEADER, SECRET);
        else config.headers[HEADER] = SECRET;
      }
    }
    return config;
  });

module.exports = { HEADER, baseUrl, isInternal, installAxiosHeader };
