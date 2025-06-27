const express = require("express");
const COA_Controllers = require("../controllers/COA_controller");
const authMiddleware = require("../middleware/userMiddleware");
const router = express.Router();

router.get("/coa-list-view", authMiddleware, COA_Controllers.COA_list);
router.get("/get-coa-list", authMiddleware, COA_Controllers.getCOAList);
router.get("/coa-details", authMiddleware, COA_Controllers.IndividualView);
router.get(
  "/get-coa-paid-through-account",
  authMiddleware,
  COA_Controllers.getPaidThroughAccount
);
router.post("/edit-coa", authMiddleware, COA_Controllers.edit_COA);
router.get("/get-coa-types", authMiddleware, COA_Controllers.getCOA_types);
router.post("/add-coa", authMiddleware, COA_Controllers.add_COA);
router.post("/update-coa-status", authMiddleware, COA_Controllers.updateStatus);
router.get(
  "/get-coa-transaction",
  authMiddleware,
  COA_Controllers.getIndividual_COA_transaction
);

module.exports = router;
