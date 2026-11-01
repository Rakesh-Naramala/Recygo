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
        total_reports: (embeddedDb.data.reports || []).length,
        pending_reports: (embeddedDb.data.reports || []).filter(r => r.status === 'Open').length,
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

// GET /api/admin/reports - Get all submitted problem reports
router.get('/reports', async (req, res) => {
  try {
    const reports = embeddedDb.data.reports || [];
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/reports/:id - Update report status
router.patch('/reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const reports = embeddedDb.data.reports || [];
    const report = reports.find(r => r.id === parseInt(id));
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    report.status = status || 'Resolved';
    report.resolved_at = new Date().toISOString();
    embeddedDb.save();
    res.json({ success: true, report, message: `Report #${report.ticket_number || report.id} updated to ${report.status}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/users/:id/block - Block or unblock a seller, buyer, or admin (prime_admin only for admins)
router.patch('/users/:id/block', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_blocked, requesting_role } = req.body;
    const u = embeddedDb.data.users.find(user => user.id === parseInt(id));
    if (!u) return res.status(404).json({ error: 'User not found' });

    // Admin can block sellers/buyers but NOT other admins or prime_admin
    if (u.role === 'admin' && requesting_role !== 'prime_admin') {
      return res.status(403).json({ error: 'Only Prime Admin can block or unblock administrator accounts.' });
    }
    if (u.role === 'prime_admin') {
      return res.status(400).json({ error: 'Cannot block the Prime Admin account.' });
    }

    u.is_blocked = (is_blocked !== undefined) ? !!is_blocked : !u.is_blocked;
    embeddedDb.save();
    res.json({
      success: true,
      user: u,
      message: `${u.name} is now ${u.is_blocked ? '⛔ Blocked' : '✅ Active'}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id/password - Change password of seller or buyer on request
router.patch('/users/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;
    if (!new_password || new_password.trim().length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters long' });
    }
    const u = embeddedDb.data.users.find(user => user.id === parseInt(id));
    if (!u) return res.status(404).json({ error: 'User not found' });

    u.password = new_password.trim();
    embeddedDb.save();
    res.json({
      success: true,
      message: `Password for ${u.name} (${u.role}) updated successfully!`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/create-admin - Add N number of admins
router.post('/create-admin', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Admin name is required' });
    if (!phone || phone.trim().length < 10) return res.status(400).json({ error: 'Valid 10-digit phone number is required' });
    if (!password || password.trim().length < 4) return res.status(400).json({ error: 'Admin password must be at least 4 characters' });

    const cleanPhone = phone.trim();
    const cleanName = name.trim();
    const existing = embeddedDb.data.users.find(u => u.phone === cleanPhone);

    if (existing) {
      if (existing.role === 'admin') {
        return res.status(400).json({ error: 'An admin with this phone number already exists' });
      }
      existing.role = 'admin';
      existing.name = cleanName;
      existing.password = password.trim();
      embeddedDb.save();
      return res.json({
        success: true,
        user: { id: existing.id, name: existing.name, phone: existing.phone, role: 'admin' },
        message: `${cleanName} promoted to Admin successfully!`
      });
    }

    const newId = embeddedDb.data.users.length ? Math.max(...embeddedDb.data.users.map(u => u.id)) + 1 : 1;
    const newAdmin = {
      id: newId,
      name: cleanName,
      phone: cleanPhone,
      password: password.trim(),
      role: 'admin',
      lat: 12.9716,
      lng: 77.5946,
      created_at: new Date().toISOString()
    };
    embeddedDb.data.users.push(newAdmin);
    embeddedDb.save();

    const totalAdmins = embeddedDb.data.users.filter(u => u.role === 'admin').length;
    res.json({
      success: true,
      user: { id: newAdmin.id, name: newAdmin.name, phone: newAdmin.phone, role: 'admin' },
      message: `New Admin "${cleanName}" added successfully! (Total admins: ${totalAdmins})`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper for platform feature settings
function getPlatformSettings() {
  if (!embeddedDb.data.settings) {
    embeddedDb.data.settings = {
      ai_scanner_enabled: true,
      scale_ocr_enabled: true,
      instant_payout_preview: true,
      public_registration: true,
      commission_percent: 10,
      maintenance_mode: false,
    };
    embeddedDb.save();
  }
  return embeddedDb.data.settings;
}

// GET /api/admin/settings - Get platform feature flags & parameters
router.get('/settings', async (req, res) => {
  try {
    const settings = getPlatformSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/settings - Change any platform feature flags & parameters
router.put('/settings', async (req, res) => {
  try {
    const settings = getPlatformSettings();
    const allowedKeys = [
      'ai_scanner_enabled',
      'scale_ocr_enabled',
      'instant_payout_preview',
      'public_registration',
      'commission_percent',
      'maintenance_mode'
    ];

    allowedKeys.forEach(k => {
      if (req.body[k] !== undefined) {
        if (typeof req.body[k] === 'boolean') {
          settings[k] = req.body[k];
        } else if (k === 'commission_percent') {
          settings[k] = Math.max(0, Math.min(100, parseFloat(req.body[k]) || 10));
        }
      }
    });

    embeddedDb.save();
    res.json({ success: true, settings, message: 'Platform features and controls updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/change-master-password - Change master admin password
router.post('/change-master-password', async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.trim().length < 4) {
      return res.status(400).json({ error: 'Master Admin password must be at least 4 characters long' });
    }
    const settings = getPlatformSettings();
    settings.admin_master_password = new_password.trim();
    embeddedDb.save();

    // Also update default admin account password
    const defaultAdmin = embeddedDb.data.users.find(u => u.role === 'admin');
    if (defaultAdmin) {
      defaultAdmin.password = new_password.trim();
      embeddedDb.save();
    }

    res.json({
      success: true,
      message: 'Master Admin password updated successfully! Use this new password for admin access.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
