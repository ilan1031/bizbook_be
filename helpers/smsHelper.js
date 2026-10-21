// Sends SMS through the provider chosen by SMS_PROVIDER:
//   console  - (default) prints the message to the server log; for local dev
//   fast2sms - Fast2SMS (India). Needs FAST2SMS_API_KEY. New accounts get a
//              small free test credit; after that it's pay-per-SMS. Business
//              SMS to Indian numbers needs DLT registration (Fast2SMS helps).
//   twilio   - Twilio. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.
// Never throws: returns { ok, provider, error? } so a failed SMS can't break
// sign-up or login.
const axios = require("axios");

const provider = () => (process.env.SMS_PROVIDER || "console").toLowerCase();

const isConfigured = () => {
  switch (provider()) {
    case "fast2sms":
      return Boolean(process.env.FAST2SMS_API_KEY);
    case "twilio":
      return Boolean(
        process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM
      );
    case "console":
      return true;
    default:
      return false;
  }
};

const digitsOnly = (n) => String(n || "").replace(/\D/g, "");

// 10-digit Indian number for Fast2SMS.
const toIndianTen = (n) => digitsOnly(n).slice(-10);

// E.164 for Twilio, defaulting to SMS_DEFAULT_COUNTRY_CODE (91).
const toE164 = (n) => {
  const raw = String(n || "").trim();
  if (raw.startsWith("+")) return "+" + digitsOnly(raw);
  const d = digitsOnly(raw);
  const cc = digitsOnly(process.env.SMS_DEFAULT_COUNTRY_CODE || "91");
  return d.length === 10 ? `+${cc}${d}` : `+${d}`;
};

// options.otp: when set, Fast2SMS uses its OTP route (template message).
const sendSms = async (to, message, options = {}) => {
  const p = provider();
  try {
    if (!to || digitsOnly(to).length < 10) {
      return { ok: false, provider: p, error: "No valid mobile number" };
    }
    if (p === "console") {
      console.log(`[SMS:console] to ${to}: ${message}`);
      return { ok: true, provider: p };
    }
    if (!isConfigured()) {
      return { ok: false, provider: p, error: `SMS provider "${p}" is not configured` };
    }

    if (p === "fast2sms") {
      const body = options.otp
        ? { route: "otp", variables_values: String(options.otp), numbers: toIndianTen(to) }
        : { route: "q", message, numbers: toIndianTen(to), flash: 0 };
      const res = await axios.post("https://www.fast2sms.com/dev/bulkV2", body, {
        headers: { authorization: process.env.FAST2SMS_API_KEY },
        timeout: 10000,
      });
      if (res.data?.return === true) return { ok: true, provider: p };
      return { ok: false, provider: p, error: String(res.data?.message || "Send failed") };
    }

    if (p === "twilio") {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const params = new URLSearchParams({
        To: toE164(to),
        From: process.env.TWILIO_FROM,
        Body: message,
      });
      await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, params, {
        auth: { username: sid, password: process.env.TWILIO_AUTH_TOKEN },
        timeout: 10000,
      });
      return { ok: true, provider: p };
    }

    return { ok: false, provider: p, error: `Unknown SMS provider "${p}"` };
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    console.error(`[SMS:${p}] send failed:`, detail);
    return { ok: false, provider: p, error: String(detail) };
  }
};

module.exports = { sendSms, isConfigured, provider };
