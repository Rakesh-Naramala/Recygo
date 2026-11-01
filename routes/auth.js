const express = require('express');
const router = express.Router();
const { pool, embeddedDb } = require('../db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const PRIME_ADMIN_PASSWORD = process.env.PRIME_ADMIN_PASSWORD || 'primeadmin123';

// POST /api/auth/register - Register new user with Name, Phone, Password, and Role
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, role = 'seller', lat, lng } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!phone || phone.trim().length < 10) {
      return res.status(400).json({ error: 'A valid 10-digit phone number is required' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters long' });
    }

    const cleanPhone = phone.trim();
    const cleanName = name.trim();
    const userRole = (role === 'buyer' || role === 'admin') ? role : 'seller';

    // Check if phone already registered in embedded store
    const existing = embeddedDb.data.users.find(u => u.phone === cleanPhone);
    if (existing) {
      return res.status(400).json({
        error: 'An account with this phone number already exists. Please login with your password.'
      });
    }

    const newId = embeddedDb.data.users.length
      ? Math.max(...embeddedDb.data.users.map(u => u.id)) + 1
      : 1;

    const newUser = {
      id: newId,
      name: cleanName,
      phone: cleanPhone,
      password: password,
      role: userRole,
      lat: parseFloat(lat) || 12.9716,
      lng: parseFloat(lng) || 77.5946,
      created_at: new Date().toISOString()
    };

    embeddedDb.data.users.push(newUser);
    embeddedDb.save();

    // Do not leak password in response
    const safeUser = { id: newUser.id, name: newUser.name, phone: newUser.phone, role: newUser.role };
    res.json({
      success: true,
      message: 'Registration successful! Welcome to RECYGO.',
      user: safeUser
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login - Login with Name or Phone, and Password
router.post('/login', async (req, res) => {
  try {
    const { credential, password } = req.body;

    if (!credential || !credential.trim()) {
      return res.status(400).json({ error: 'Please enter your Name or Phone number' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Please enter your password' });
    }

    const term = credential.trim().toLowerCase();
    const user = embeddedDb.data.users.find(u =>
      (u.phone && u.phone.trim().toLowerCase() === term) ||
      (u.name && u.name.trim().toLowerCase() === term)
    );

    if (!user) {
      return res.status(401).json({
        error: 'No account found matching that Name or Phone. Please register first for access.'
      });
    }

    // Check if user is blocked by admin
    if (user.is_blocked) {
      return res.status(403).json({
        error: 'Your account has been suspended by Admin. Please contact Admin Support at +91 99999 99999.'
      });
    }

    // Check password
    if (user.password && user.password !== password) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    const safeUser = { id: user.id, name: user.name, phone: user.phone, role: user.role };
    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      user: safeUser
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

function getMasterAdminPassword() {
  return (embeddedDb.data.settings && embeddedDb.data.settings.admin_master_password) || ADMIN_PASSWORD;
}

function getPrimeAdminPassword() {
  return (embeddedDb.data.settings && embeddedDb.data.settings.prime_admin_password) || PRIME_ADMIN_PASSWORD;
}

// POST /api/auth/change-my-password - User or Admin changes their own password
router.post('/change-my-password', async (req, res) => {
  try {
    const { user_id, current_password, new_password } = req.body;
    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    if (!new_password || new_password.trim().length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters long' });
    }

    const user = embeddedDb.data.users.find(u => u.id === parseInt(user_id));
    if (!user) {
      return res.status(404).json({ error: 'User account not found' });
    }

    if (user.password && current_password && user.password !== current_password) {
      return res.status(401).json({ error: 'Current password does not match' });
    }

    user.password = new_password.trim();
    embeddedDb.save();

    res.json({
      success: true,
      message: `Password updated successfully for ${user.name}!`
    });
  } catch (error) {
    console.error('Change my password error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/reset-password - Reset password using Name or Phone (for forgot password)
router.post('/reset-password', async (req, res) => {
  try {
    const { credential, new_password } = req.body;
    if (!credential || !credential.trim()) {
      return res.status(400).json({ error: 'Please enter your registered Name or 10-digit Phone' });
    }
    if (!new_password || new_password.trim().length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters long' });
    }

    const term = credential.trim().toLowerCase();
    const user = embeddedDb.data.users.find(u =>
      (u.phone && u.phone.trim().toLowerCase() === term) ||
      (u.name && u.name.trim().toLowerCase() === term)
    );

    if (!user) {
      return res.status(404).json({ error: 'No account found matching that Name or Phone. Please check your credentials.' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: 'This account has been suspended by Admin. Please contact Admin support.' });
    }

    user.password = new_password.trim();
    embeddedDb.save();

    res.json({
      success: true,
      message: `Password for ${user.name} has been reset successfully! You can now sign in with your new password.`
    });
  } catch (error) {
    console.error('Reset password error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/admin-login - Dedicated admin access with separate admin password (supports N admins)
router.post('/admin-login', async (req, res) => {
  try {
    const { password, credential } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Admin password is required' });
    }

    // ── Prime Admin check ──────────────────────────────────────────────
    const primePass = getPrimeAdminPassword();
    if (password === primePass) {
      const primeUser = embeddedDb.data.users.find(u => u.role === 'prime_admin') || {
        id: 1,
        name: 'Prime Admin',
        phone: '0000000000',
        role: 'prime_admin'
      };
      return res.json({
        success: true,
        message: `👑 Prime Admin access granted. Welcome, ${primeUser.name}! Full superuser controls unlocked.`,
        user: { id: primeUser.id, name: primeUser.name, phone: primeUser.phone, role: 'prime_admin' }
      });
    }

    // ── Also check if existing prime_admin user logs in by their stored password ──
    if (credential && credential.trim()) {
      const term = credential.trim().toLowerCase();
      const primeMatch = embeddedDb.data.users.find(u =>
        u.role === 'prime_admin' &&
        ((u.name && u.name.trim().toLowerCase() === term) || (u.phone && u.phone.trim().toLowerCase() === term)) &&
        u.password === password
      );
      if (primeMatch) {
        return res.json({
          success: true,
          message: `👑 Prime Admin access granted. Welcome, ${primeMatch.name}!`,
          user: { id: primeMatch.id, name: primeMatch.name, phone: primeMatch.phone, role: 'prime_admin' }
        });
      }
    }

    // ── Regular admin check ────────────────────────────────────────────
    const masterPass = getMasterAdminPassword();
    const isMasterPass = password === masterPass;
    let matchingAdmin = null;

    if (credential && credential.trim()) {
      const term = credential.trim().toLowerCase();
      matchingAdmin = embeddedDb.data.users.find(u =>
        u.role === 'admin' &&
        ((u.name && u.name.trim().toLowerCase() === term) || (u.phone && u.phone.trim().toLowerCase() === term)) &&
        u.password === password
      );
    } else {
      matchingAdmin = embeddedDb.data.users.find(u => u.role === 'admin' && u.password === password);
    }

    if (!isMasterPass && !matchingAdmin) {
      return res.status(401).json({
        error: 'Invalid Admin Password! Only verified administrators have access to platform controls.'
      });
    }

    const admin = matchingAdmin || embeddedDb.data.users.find(u => u.role === 'admin') || {
      id: 999,
      name: 'RECYGO Admin',
      phone: '9999999999',
      role: 'admin',
      password: masterPass
    };

    res.json({
      success: true,
      message: `Admin access verified. Welcome, ${admin.name}! Full platform controls unlocked.`,
      user: { id: admin.id, name: admin.name, phone: admin.phone, role: 'admin' }
    });
  } catch (error) {
    console.error('Admin login error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/prime-admin/block-admin - Prime Admin blocks/unblocks an admin account
router.patch('/prime-admin/block-admin/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_blocked, requesting_role } = req.body;

    if (requesting_role !== 'prime_admin') {
      return res.status(403).json({ error: 'Only Prime Admin can block or unblock administrator accounts.' });
    }

    const u = embeddedDb.data.users.find(user => user.id === parseInt(id));
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.role === 'prime_admin') return res.status(400).json({ error: 'Cannot block the Prime Admin account' });

    u.is_blocked = (is_blocked !== undefined) ? !!is_blocked : !u.is_blocked;
    embeddedDb.save();

    res.json({
      success: true,
      user: u,
      message: `Admin account "${u.name}" is now ${u.is_blocked ? '⛔ Blocked' : '✅ Active'}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/report-problem - Report a problem / file an issue
router.post('/report-problem', async (req, res) => {
  try {
    const { name, phone, issue_type, order_id, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Your name is required to submit a report' });
    }
    if (!phone || phone.trim().length < 10) {
      return res.status(400).json({ error: 'A valid contact phone number is required' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Please describe the problem you experienced' });
    }

    if (!Array.isArray(embeddedDb.data.reports)) {
      embeddedDb.data.reports = [];
    }

    const ticketNumber = 'TKT-' + Math.floor(1000 + Math.random() * 9000);
    const newReport = {
      id: embeddedDb.data.reports.length ? Math.max(...embeddedDb.data.reports.map(r => r.id)) + 1 : 1,
      ticket_number: ticketNumber,
      name: name.trim(),
      phone: phone.trim(),
      issue_type: issue_type || 'General Issue',
      order_id: order_id ? String(order_id).trim() : null,
      description: description.trim(),
      status: 'Open',
      created_at: new Date().toISOString()
    };

    embeddedDb.data.reports.unshift(newReport);
    embeddedDb.save();

    res.json({
      success: true,
      ticket_number: ticketNumber,
      message: `Problem report filed successfully. Support Ticket #${ticketNumber} created.`
    });
  } catch (error) {
    console.error('Report problem error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/reports - Get all reports (Admin access)
router.get('/reports', async (req, res) => {
  try {
    const reports = embeddedDb.data.reports || [];
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/auth/reports/:id/status - Update report status
router.patch('/reports/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const reports = embeddedDb.data.reports || [];
    const report = reports.find(r => r.id === parseInt(id));
    if (!report) {
      return res.status(404).json({ error: 'Report ticket not found' });
    }

    report.status = status || 'Resolved';
    report.updated_at = new Date().toISOString();
    embeddedDb.save();

    res.json({ success: true, message: `Ticket #${report.ticket_number} marked as ${report.status}`, report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
