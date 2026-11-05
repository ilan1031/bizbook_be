const express = require("express");
const Assets = require("../controllers/fixedAssetController");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

// Page permission "fixedAssets" (helpers/rbac.js): view reads, create adds,
// edit changes an asset or posts depreciation, delete removes or disposes.
router.get("/fixed-assets", authMiddleware, Assets.list);
router.post("/fixed-assets", authMiddleware, Assets.create);
router.get("/fixed-assets/depreciation/preview", authMiddleware, Assets.preview);
router.post("/fixed-assets/depreciation/run", authMiddleware, Assets.run);
router.get("/fixed-assets/:id/schedule", authMiddleware, Assets.schedule);
router.post("/fixed-assets/:id/dispose", authMiddleware, Assets.dispose);
router.patch("/fixed-assets/:id", authMiddleware, Assets.update);
router.delete("/fixed-assets/:id", authMiddleware, Assets.remove);

module.exports = router;
