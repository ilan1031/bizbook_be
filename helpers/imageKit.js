const ImageKit = require("imagekit");

// The ImageKit client throws if its keys are missing, which used to crash the
// whole server on startup. Create it only when configured; otherwise image
// uploads fail with a clear error and everything else keeps working.
const configured =
  process.env.IMAGEKIT_PUBLIC_KEY &&
  process.env.IMAGEKIT_PRIVATE_KEY &&
  process.env.IMAGEKIT_URL_ENDPOINT;

const notConfigured = () => {
  throw new Error(
    "Image uploads are not configured (set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT)"
  );
};

const imagekit = configured
  ? new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    })
  : new Proxy({}, { get: () => notConfigured });

module.exports = imagekit;
