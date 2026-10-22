const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/categories - Get all scrap categories with prices
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM categories ORDER BY standard_price_per_kg DESC'
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Categories error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
