const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// POST /api/buyer/register - Register a new buyer
router.post('/register', async (req, res) => {
  try {
    const { name, phone, lat, lng } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
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
       VALUES ($1, $2, 'buyer', ${locationSQL}) RETURNING *`,
      [name, phone]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/buyer/nearby-listings - Geospatial query for nearby listings
router.get('/nearby-listings', async (req, res) => {
  try {
    const { lat, lng, radius = 15000, category } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    let query = `
      SELECT 
        l.*,
        c.display_name as category_name,
        c.standard_price_per_kg,
        c.icon,
        c.color,
        u.name as seller_name,
        ROUND(ST_Distance(
          l.location,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        )::numeric / 1000, 2) AS distance_km,
        ST_Y(l.location::geometry) AS lat,
        ST_X(l.location::geometry) AS lng
      FROM listings l
      JOIN categories c ON l.category_id = c.id
      JOIN users u ON l.seller_id = u.id
      WHERE 
        l.status = 'available'
        AND ST_DWithin(
          l.location,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
    `;

    const params = [parseFloat(lat), parseFloat(lng), parseInt(radius)];

    if (category) {
      query += ` AND c.name = $4`;
      params.push(category);
    }

    query += ` ORDER BY distance_km ASC`;

    const result = await pool.query(query, params);
    res.json({ success: true, listings: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Nearby listings error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/buyer/accept-listing - Accept a listing and create an order
router.post('/accept-listing', async (req, res) => {
  try {
    const { buyer_id, listing_id } = req.body;
    if (!buyer_id || !listing_id) {
      return res.status(400).json({ error: 'buyer_id and listing_id are required' });
    }

    // Check listing is still available
    const listingResult = await pool.query(
      'SELECT * FROM listings WHERE id = $1 AND status = $2',
      [listing_id, 'available']
    );
    if (!listingResult.rows.length) {
      return res.status(400).json({ error: 'Listing not available or already taken' });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Create order
    const orderResult = await pool.query(
      `INSERT INTO orders (listing_id, buyer_id, otp_code, scheduled_at, status)
       VALUES ($1, $2, $3, NOW() + INTERVAL '2 hours', 'scheduled')
       RETURNING *`,
      [listing_id, buyer_id, otp]
    );

    // Update listing status
    await pool.query(
      'UPDATE listings SET status = $1, updated_at = NOW() WHERE id = $2',
      ['matched', listing_id]
    );

    res.json({
      success: true,
      order: orderResult.rows[0],
      otp_for_seller: otp,
      message: 'Order created. Share OTP with seller for final verification.'
    });
  } catch (error) {
    console.error('Accept listing error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/buyer/orders/:buyer_id - Get buyer's active/past orders
router.get('/orders/:buyer_id', async (req, res) => {
  try {
    const { buyer_id } = req.params;
    const result = await pool.query(
      `SELECT o.*, l.title, l.address, l.landmark, l.gate_instructions,
       c.display_name as category_name, c.icon, c.standard_price_per_kg,
       u.name as seller_name,
       ST_Y(l.location::geometry) AS seller_lat,
       ST_X(l.location::geometry) AS seller_lng
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       JOIN categories c ON l.category_id = c.id
       JOIN users u ON l.seller_id = u.id
       WHERE o.buyer_id = $1
       ORDER BY o.created_at DESC`,
      [buyer_id]
    );
    res.json({ success: true, orders: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
