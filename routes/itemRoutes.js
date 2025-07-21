const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/userMiddleware");
const itemController = require("../controllers/itemController");

router.post("/items/newitems", authMiddleware,itemController.createItem);
router.get("/item/getitems", authMiddleware,itemController.getAllItems);
router.get("/item/singleitems/:id", authMiddleware,itemController.getItemById);
router.put("/item/:id", authMiddleware,itemController.updateItem);

//items drop down 
router.get("/item/item/details",authMiddleware,itemController.itemList);

module.exports = router;