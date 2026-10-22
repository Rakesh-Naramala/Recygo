const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// POST /api/seller/register - Register a new seller
router.post('/register', async (req, res) => {
  try {
    const { name, phone, lat, lng } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      // Update location if provided
      if (lat && lng) {
        await pool.query(
          'UPDATE users SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE phone = $3',
          [lng, lat, phone]
        );
      }
      return res.json({ success: true, user: existing.rows[0], existing: true });
    }

    const locationSQL = lat && lng
      ? `ST_SetSRID(ST_MakePoint(${parseFloat(lng)}, ${parseFloat(lat)}), 4326)::geography`
      : 'NULL';

    const result = await pool.query(
      `INSERT INTO users (name, phone, role, location) 
       VALUES ($1, $2, 'seller', ${locationSQL}) RETURNING *`,
      [name, phone]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('Seller register error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/seller/listings - Create a new listing
router.post('/listings', async (req, res) => {
  try {
    const {
      seller_id, category_id, title, description,
      estimated_weight, lat, lng, address, landmark,
      gate_instructions, ai_confidence, actual_photo_base64
    } = req.body;

    if (!seller_id || !category_id || !title || !estimated_weight || !lat || !lng) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get category price
    const catResult = await pool.query('SELECT standard_price_per_kg FROM categories WHERE id = $1', [category_id]);
    if (!catResult.rows.length) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const pricePerKg = parseFloat(catResult.rows[0].standard_price_per_kg);
    const estimatedPayout = parseFloat(estimated_weight) * pricePerKg;

    const result = await pool.query(
      `INSERT INTO listings (
        seller_id, category_id, title, description, estimated_weight,
        location, address, landmark, gate_instructions,
        estimated_payout, ai_confidence, actual_photo_base64, status
      ) VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
        $8, $9, $10, $11, $12, $13, 'available'
      ) RETURNING *`,
      [
        seller_id, category_id, title, description || '', estimated_weight,
        parseFloat(lng), parseFloat(lat), address || '', landmark || '',
        gate_instructions || '', estimatedPayout, ai_confidence || null,
        actual_photo_base64 || null
      ]
    );

    res.json({ success: true, listing: result.rows[0], estimated_payout: estimatedPayout });
  } catch (error) {
    console.error('Create listing error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/seller/listings/:seller_id - Get listings for a seller
router.get('/listings/:seller_id', async (req, res) => {
  try {
    const { seller_id } = req.params;
    const result = await pool.query(
      `SELECT l.*, c.display_name as category_name, c.standard_price_per_kg, c.icon, c.color,
       u.name as seller_name
       FROM listings l
       JOIN categories c ON l.category_id = c.id
       JOIN users u ON l.seller_id = u.id
       WHERE l.seller_id = $1
       ORDER BY l.created_at DESC`,
      [seller_id]
    );
    res.json({ success: true, listings: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/seller/orders/:seller_id - Get orders for seller's listings
router.get('/orders/:seller_id', async (req, res) => {
  try {
    const { seller_id } = req.params;
    const result = await pool.query(
      `SELECT o.*, l.title, l.address, c.display_name as category_name, c.icon,
       u.name as buyer_name
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       JOIN categories c ON l.category_id = c.id
       JOIN users u ON o.buyer_id = u.id
       WHERE l.seller_id = $1
       ORDER BY o.created_at DESC`,
      [seller_id]
    );
    res.json({ success: true, orders: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
