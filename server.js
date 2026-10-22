require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, initDatabase } = require('./db');

// Route imports
const aiRoutes = require('./routes/ai');
const sellerRoutes = require('./routes/seller');
const buyerRoutes = require('./routes/buyer');
const orderRoutes = require('./routes/order');
const categoryRoutes = require('./routes/category');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/ai', aiRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/buyer', buyerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/admin', adminRoutes);

// Healthcheck endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB and Start Server
async function startServer() {
  try {
    await initDatabase();
  } catch (error) {
    console.warn('⚠️ Non-fatal DB notice:', error.message);
  }

  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🌿 RECYGO Smart Platform is running live!`);
    console.log(`🌐 Web URL: http://localhost:${PORT}`);
    console.log(`👑 Admin Portal: http://localhost:${PORT}#admin`);
    console.log(`======================================================\n`);
  });
}

startServer();
