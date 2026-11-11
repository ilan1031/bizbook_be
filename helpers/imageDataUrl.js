const MAX_IMAGE_BYTES = 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/; // padding is absent when the size is a multiple of 3

const validateImageDataUrl = (value, label) => {
  if (value === "") return null;
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) {
    return `${label} must be an image smaller than 1 MB`;
  }

  const match = value.match(IMAGE_DATA_URL);
  if (!match) return `${label} must be a PNG, JPG or WebP image`;

  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    return `${label} must be an image smaller than 1 MB`;
  }

  const mime = match[1];
  const validSignature =
    (mime === "png" &&
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "jpeg" &&
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (mime === "webp" &&
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP");

  return validSignature ? null : `${label} is not a valid PNG, JPG or WebP image`;
};

module.exports = validateImageDataUrl;
