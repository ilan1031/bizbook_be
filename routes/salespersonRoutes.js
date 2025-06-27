const express = require("express");
const router = express.Router();
const SalespersonController = require("../controllers/SalespersonController");
const authMiddleware = require("../middleware/userMiddleware");

// 📌 CREATE sales person 
router.post("/salesperson/new",authMiddleware, SalespersonController.createSalesperson);
// 📌 GET all sales person 
router.get("/salesperson/getsalesperson", authMiddleware,SalespersonController.getSalespersons);
// 📌 UPDATE Sales Person 
router.put("/salesperson/update/:_id",authMiddleware, SalespersonController.updateSalesperson);
// 📌 DELETE Sales Person
router.delete("/salesperson/delete/:_id", authMiddleware,SalespersonController.deleteSalesperson);

module.exports = router;
