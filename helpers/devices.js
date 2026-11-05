// Approved devices. A device is recognised by an id the browser keeps and sends
// as the X-Device-Id header, not by its IP address: an address can change from
// one request to the next (IPv4/IPv6, a proxy, a mobile network), which used to
// sign people out straight after they signed in. Entries saved before this
// existed have no id; they are matched by address once and then adopt the id.
// A request with no id (an old client, a script) falls back to the address.
const { getClientIp } = require("./rbac");

const DEVICE_RE = /^[A-Za-z0-9-]{16,64}$/;

const deviceIdOf = (req) => {
  const v = String(req.headers?.["x-device-id"] || "").trim();
  return DEVICE_RE.test(v) ? v : "";
};

// The approved entry for this request, or undefined.
const findDevice = (user, req) => {
  const list = user.allowed_ips || [];
  const id = deviceIdOf(req);
  if (id) {
    return list.find((e) => e.device_id === id) || list.find((e) => !e.device_id && e.ip === getClientIp(req));
  }
  return list.find((e) => e.ip === getClientIp(req));
};

// A new entry for this request's device.
const newDevice = (req) => ({
  ip: getClientIp(req),
  device_id: deviceIdOf(req) || undefined,
  user_agent: String(req.headers["user-agent"] || "").slice(0, 200),
});

module.exports = { deviceIdOf, findDevice, newDevice };
