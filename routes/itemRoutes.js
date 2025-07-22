const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/userMiddleware");
const itemController = require("../controllers/itemController");


// Delete an item by ID
router.delete("/items/:id", authMiddleware, itemController.deleteItem);
// Create a new item
router.post("/items/newitems", authMiddleware, itemController.createItem);
// Get all items
router.get("/item/getitems", authMiddleware, itemController.getAllItems);
// Get a single item by ID
router.get("/item/singleitems/:id", authMiddleware, itemController.getItemById);
// Update an item by ID
router.put("/item/:id", authMiddleware, itemController.updateItem);
// Get item list for dropdown
router.get("/item/item/details", authMiddleware, itemController.itemList);

module.exports = router;