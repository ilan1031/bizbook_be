// A Razorpay client created on first use (the constructor throws without keys).
// Tests can swap in a fake with setClient().
const Razorpay = require("razorpay");

let client = null;

const isConfigured = () => Boolean(client || (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET));

const getClient = () => {
  if (client) return client;
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay is not configured (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)");
  }
  client = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  return client;
};

const setClient = (fake) => {
  client = fake;
};

module.exports = { isConfigured, getClient, setClient };
