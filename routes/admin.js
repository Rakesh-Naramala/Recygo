const express = require('express');
const router = express.Router();
const { pool, embeddedDb } = require('../db');

// GET /api/admin/stats - Complete platform metrics & impact
router.get('/stats', async (req, res) => {
  try {
    const categoriesRes = await pool.query('SELECT * FROM categories');
    const categories = categoriesRes.rows;

    // Get listings & orders directly from embedded store or query
    const listings = embeddedDb.data.listings || [];
    const orders = embeddedDb.data.orders || [];
    const users = embeddedDb.data.users || [];

    let totalRecycledKg = 0;
    let totalTurnoverInr = 0;
    let completedOrders = 0;

    orders.forEach(o => {
      if (o.status === 'picked_up' || o.payment_status === 'completed') {
        completedOrders++;
        totalRecycledKg += parseFloat(o.actual_weight || o.gross_weight || 0);
        totalTurnoverInr += parseFloat(o.final_amount || 0);
      }
    });

    // Also include completed listings without orders if any
    const activeListings = listings.filter(l => l.status === 'available').length;
    const co2SavedKg = parseFloat((totalRecycledKg * 1.5).toFixed(1));
    const treesEquivalent = parseFloat((co2SavedKg / 21.0).toFixed(1));
    const commissionInr = parseFloat((totalTurnoverInr * 0.10).toFixed(2)); // 10% platform commission

    res.json({
      success: true,
      stats: {
        total_recycled_kg: parseFloat(totalRecycledKg.toFixed(1)),
        co2_saved_kg: co2SavedKg,
        trees_equivalent: treesEquivalent,
        total_turnover_inr: parseFloat(totalTurnoverInr.toFixed(2)),
        platform_commission_inr: commissionInr,
        active_listings_count: activeListings,
        matched_listings_count: listings.filter(l => l.status === 'matched').length,
        completed_orders_count: completedOrders,
        total_listings: listings.length,
        total_orders: orders.length,
        total_users: users.length,
        sellers_count: users.filter(u => u.role === 'seller').length,
        buyers_count: users.filter(u => u.role === 'buyer').length,
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/listings - All listings with filters
router.get('/listings', async (req, res) => {
  try {
    const { status } = req.query;
    let listings = [...(embeddedDb.data.listings || [])];
    if (status && status !== 'all') {
      listings = listings.filter(l => l.status === status);
    }

    const enriched = listings.map(l => {
      const cat = embeddedDb.data.categories.find(c => c.id === l.category_id) || {};
      const seller = embeddedDb.data.users.find(u => u.id === l.seller_id) || { name: 'Unknown', phone: '—' };
      return {
        ...l,
        category_name: cat.display_name || cat.name || 'General',
        category_icon: cat.icon || '♻️',
        rate_per_kg: cat.standard_price_per_kg || 0,
        seller_name: seller.name,
        seller_phone: seller.phone,
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, count: enriched.length, listings: enriched });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/listings/:id/status - Change listing status
router.put('/listings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const l = embeddedDb.data.listings.find(item => item.id === parseInt(id));
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    l.status = status;
    embeddedDb.save();
    res.json({ success: true, listing: l });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/listings/:id - Delete listing
router.delete('/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idx = embeddedDb.data.listings.findIndex(item => item.id === parseInt(id));
    if (idx === -1) return res.status(404).json({ error: 'Listing not found' });
    embeddedDb.data.listings.splice(idx, 1);
    embeddedDb.save();
    res.json({ success: true, message: 'Listing deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/orders - All orders with audit data
router.get('/orders', async (req, res) => {
  try {
    const orders = (embeddedDb.data.orders || []).map(o => {
      const l = embeddedDb.data.listings.find(item => item.id === o.listing_id) || {};
      const cat = embeddedDb.data.categories.find(c => c.id === l.category_id) || {};
      const seller = embeddedDb.data.users.find(u => u.id === l.seller_id) || { name: 'Seller' };
      const buyer = embeddedDb.data.users.find(u => u.id === o.buyer_id) || { name: 'Buyer' };
      return {
        ...o,
        listing_title: l.title || 'Scrap Pickup',
        listing_address: l.address,
        category_name: cat.display_name || cat.name,
        category_icon: cat.icon || '♻️',
        seller_name: seller.name,
        seller_phone: seller.phone,
        buyer_name: buyer.name,
        buyer_phone: buyer.phone,
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/orders/:id/override - Admin override / resolve dispute
router.post('/orders/:id/override', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, final_amount, actual_weight, notes } = req.body;
    const o = embeddedDb.data.orders.find(item => item.id === parseInt(id));
    if (!o) return res.status(404).json({ error: 'Order not found' });

    if (status) o.status = status;
    if (final_amount !== undefined) o.final_amount = parseFloat(final_amount);
    if (actual_weight !== undefined) o.actual_weight = parseFloat(actual_weight);
    if (status === 'picked_up') {
      o.otp_verified = true;
      o.payment_status = 'completed';
      o.completed_at = new Date().toISOString();
      const l = embeddedDb.data.listings.find(item => item.id === o.listing_id);
      if (l) l.status = 'completed';
    }
    o.admin_notes = notes || 'Admin manual override executed';
    embeddedDb.save();

    res.json({ success: true, order: o });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/users - Users directory
router.get('/users', async (req, res) => {
  try {
    const users = (embeddedDb.data.users || []).map(u => {
      const userListings = embeddedDb.data.listings.filter(l => l.seller_id === u.id).length;
      const userOrders = embeddedDb.data.orders.filter(o => o.buyer_id === u.id).length;
      return {
        ...u,
        listings_count: userListings,
        orders_count: userOrders,
      };
    });
    res.json({ success: true, count: users.length, users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/users - Create new user or update role
router.post('/users', async (req, res) => {
  try {
    const { name, phone, role, lat, lng } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });

    let u = embeddedDb.data.users.find(item => item.phone === phone);
    if (u) {
      u.name = name;
      if (role) u.role = role;
      if (lat && lng) { u.lat = parseFloat(lat); u.lng = parseFloat(lng); }
    } else {
      const newId = embeddedDb.data.users.length ? Math.max(...embeddedDb.data.users.map(item => item.id)) + 1 : 1;
      u = {
        id: newId,
        name,
        phone,
        role: role || 'seller',
        lat: parseFloat(lat) || 12.9716,
        lng: parseFloat(lng) || 77.5946,
        created_at: new Date().toISOString()
      };
      embeddedDb.data.users.push(u);
    }
    embeddedDb.save();
    res.json({ success: true, user: u });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/categories/:id - Update scrap pricing
router.put('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { standard_price_per_kg, display_name } = req.body;
    const cat = embeddedDb.data.categories.find(c => c.id === parseInt(id));
    if (!cat) return res.status(404).json({ error: 'Category not found' });

    if (standard_price_per_kg !== undefined) {
      cat.standard_price_per_kg = parseFloat(standard_price_per_kg);
    }
    if (display_name) cat.display_name = display_name;

    embeddedDb.save();
    res.json({ success: true, category: cat });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/categories - Add new scrap category
router.post('/categories', async (req, res) => {
  try {
    const { name, display_name, standard_price_per_kg, icon, color } = req.body;
    if (!name || !standard_price_per_kg) {
      return res.status(400).json({ error: 'Name and price required' });
    }
    const newId = embeddedDb.data.categories.length ? Math.max(...embeddedDb.data.categories.map(c => c.id)) + 1 : 1;
    const newCat = {
      id: newId,
      name: name.toLowerCase().replace(/\s+/g, '_'),
      display_name: display_name || name,
      standard_price_per_kg: parseFloat(standard_price_per_kg),
      icon: icon || '♻️',
      color: color || '#10b981'
    };
    embeddedDb.data.categories.push(newCat);
    embeddedDb.save();
    res.json({ success: true, category: newCat });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/reset-demo - Full demo data reset
router.post('/reset-demo', async (req, res) => {
  try {
    const freshData = embeddedDb.reset();
    res.json({ success: true, message: 'Platform demo data reset successfully!', data: freshData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
