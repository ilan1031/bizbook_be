// Logos are stored inline as image data URLs (organisation logo, and the
// older per-template logo). Anything else, or anything too big, is refused.
const MAX_LOGO = 400 * 1024; // data URL characters, about 300 KB of image

const LOGO_ERROR = "The logo must be a PNG, JPG, SVG or WebP image under about 300 KB";

const isValidLogo = (v) =>
  v === "" || (typeof v === "string" && v.length <= MAX_LOGO && /^data:image\/(png|jpe?g|svg\+xml|webp);base64,/.test(v));

module.exports = { MAX_LOGO, LOGO_ERROR, isValidLogo };
