const express = require('express');
const authMiddleware = require('../middleware/userMiddleware');
const router = express.Router();

router.get('/verify-token', authMiddleware, (req, res) => {
  res.status(200).json({ message: 'Token is valid', success: true });
});

module.exports = router;
