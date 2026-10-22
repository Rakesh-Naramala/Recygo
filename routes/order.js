const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// POST /api/orders/:order_id/weigh - Record weight and process settlement
router.post('/:order_id/weigh', async (req, res) => {
  try {
    const { order_id } = req.params;
    const {
      gross_weight, tare_type, scale_photo_base64,
      scale_verified, detected_weight, final_rate_override
    } = req.body;

    // Determine tare deduction
    const TARE_MAP = {
      none: 0,
      gunny_sack: 0.5,
      plastic_crate: 1.5,
      metal_drum: 5.0,
      custom: parseFloat(req.body.custom_tare) || 0
    };
    const tare = TARE_MAP[tare_type] || 0;
    const actualWeight = Math.max(0, parseFloat(gross_weight) - tare);

    // Get order with listing info
    const orderResult = await pool.query(
      `SELECT o.*, l.category_id, c.standard_price_per_kg 
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       JOIN categories c ON l.category_id = c.id
       WHERE o.id = $1`,
      [order_id]
    );

    if (!orderResult.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];
    const ratePerKg = parseFloat(final_rate_override || order.standard_price_per_kg);
    const finalAmount = actualWeight * ratePerKg;

    const scaleStatus = scale_photo_base64
      ? (scale_verified ? 'verified' : 'manual')
      : 'pending';

    await pool.query(
      `UPDATE orders SET
        gross_weight = $1,
        tare_type = $2,
        tare_deduction = $3,
        actual_weight = $4,
        final_rate = $5,
        final_amount = $6,
        scale_photo_status = $7,
        scale_photo_base64 = $8,
        status = 'in_progress'
       WHERE id = $9`,
      [
        gross_weight, tare_type || 'none', tare, actualWeight,
        ratePerKg, finalAmount, scaleStatus,
        scale_photo_base64 || null, order_id
      ]
    );

    res.json({
      success: true,
      calculation: {
        gross_weight: parseFloat(gross_weight),
        tare_type: tare_type || 'none',
        tare_deduction: tare,
        actual_weight: actualWeight,
        rate_per_kg: ratePerKg,
        final_amount: finalAmount,
        scale_status: scaleStatus
      }
    });
  } catch (error) {
    console.error('Weigh error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/orders/:order_id/complete - Verify OTP and complete transaction
router.post('/:order_id/complete', async (req, res) => {
  try {
    const { order_id } = req.params;
    const { otp_code } = req.body;

    const orderResult = await pool.query(
      `SELECT o.*, l.seller_id, l.id as lid
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE o.id = $1`,
      [order_id]
    );

    if (!orderResult.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    if (order.otp_code !== otp_code.toString()) {
      return res.status(400).json({ error: 'Invalid OTP. Please check with seller.' });
    }

    if (!order.actual_weight) {
      return res.status(400).json({ error: 'Weight not recorded. Please complete weighing first.' });
    }

    // Complete the order
    await pool.query(
      `UPDATE orders SET
        otp_verified = TRUE,
        payment_status = 'completed',
        status = 'picked_up',
        completed_at = NOW()
       WHERE id = $1`,
      [order_id]
    );

    // Update listing status to completed
    await pool.query(
      'UPDATE listings SET status = $1, updated_at = NOW() WHERE id = $2',
      ['completed', order.lid]
    );

    res.json({
      success: true,
      message: 'Transaction completed successfully!',
      receipt: {
        order_id: order_id,
        actual_weight: order.actual_weight,
        rate_per_kg: order.final_rate,
        final_amount: order.final_amount,
        payment_status: 'completed',
        co2_saved_kg: (parseFloat(order.actual_weight) * 1.5).toFixed(2),
        completed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Complete order error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/:order_id - Get order details
router.get('/:order_id', async (req, res) => {
  try {
    const { order_id } = req.params;
    const result = await pool.query(
      `SELECT o.*, l.title, l.address, l.landmark, l.gate_instructions,
       c.display_name as category_name, c.icon, c.standard_price_per_kg,
       s.name as seller_name, b.name as buyer_name,
       ST_Y(l.location::geometry) AS seller_lat,
       ST_X(l.location::geometry) AS seller_lng
       FROM orders o
       JOIN listings l ON o.listing_id = l.id
       JOIN categories c ON l.category_id = c.id
       JOIN users s ON l.seller_id = s.id
       JOIN users b ON o.buyer_id = b.id
       WHERE o.id = $1`,
      [order_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
