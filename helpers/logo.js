// Logos are stored inline as image data URLs (organisation logo, and the
// older per-template logo). Anything else, or anything too big, is refused.
// Data URL characters: a 300 KB (300 * 1024 bytes) image in base64, plus the
// "data:image/...;base64," prefix. Matches the 300 KB check on the screens.
const MAX_LOGO = Math.ceil((300 * 1024) / 3) * 4 + 40;

const LOGO_ERROR = "The logo must be a PNG, JPG, SVG or WebP image under about 300 KB";

const isValidLogo = (v) =>
  v === "" || (typeof v === "string" && v.length <= MAX_LOGO && /^data:image\/(png|jpe?g|svg\+xml|webp);base64,/.test(v));

module.exports = { MAX_LOGO, LOGO_ERROR, isValidLogo };
