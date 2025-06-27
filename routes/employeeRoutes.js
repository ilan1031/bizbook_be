const express = require("express");
const router = express.Router();
const EmployeeController = require("../controllers/EmployeeController");
const authMiddleware = require("../middleware/userMiddleware");

// 📌 CREATE employee 
router.post("/employee",authMiddleware, EmployeeController.createEmployee);
// 📌 GET all employee 
router.get("/employee", authMiddleware,EmployeeController.getEmployee);
// 📌 UPDATE employee 
router.put("/employee/:id",authMiddleware, EmployeeController.updateEmployee);
// 📌 DELETE employee
router.delete("/employee/:id", authMiddleware,EmployeeController.deleteEmployee);
// 📌 GET employee 
router.get("/employee/:id",authMiddleware, EmployeeController.getEmployeeById);

module.exports = router;
