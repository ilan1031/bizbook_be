// Base URLs for the backend's calls to its own API (see helpers/internalCall.js).
// They follow the real PORT, so they also work where the port isn't 4000
// (Render sets its own).
const { baseUrl } = require("../helpers/internalCall");

module.exports = {
  get COMMON_BACKEND_URL() {
    return baseUrl();
  },
  get PO_BACKEND_URL() {
    return baseUrl();
  },
  get SO_BACKEND_URL() {
    return baseUrl();
  },
};
