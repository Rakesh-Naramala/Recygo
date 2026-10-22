/* =====================================================
   ECOSCRAP — FRONTEND APPLICATION (app.js)
   Full-stack wiring: Seller · Buyer · Doorstep Handover
   ===================================================== */

'use strict';

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
const STATE = {
  seller: null,       // { id, name, phone }
  buyer: null,        // { id, name, phone }
  listing: null,      // current AI-scan + created listing
  aiResult: null,     // last Gemini classify response
  categories: [],     // [{id, name, display_name, standard_price_per_kg, icon, color}]
  buyerLat: null,
  buyerLng: null,
  map: null,          // Leaflet map instance
  markers: [],        // map markers
  currentOrder: null, // order loaded in handover tab
  weightData: null,   // gross/tare/net after weigh-in
};

// ──────────────────────────────────────────────
// TOAST NOTIFICATION
// ──────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slide-in 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ──────────────────────────────────────────────
// TAB SWITCHING
// ──────────────────────────────────────────────
function switchTab(tab) {
  ['seller', 'buyer', 'handover', 'admin'].forEach(t => {
    const content = document.getElementById(`content-${t}`);
    const tabBtn  = document.getElementById(`tab-${t}`);
    if (content) {
      content.classList.toggle('active', t === tab);
      content.classList.toggle('hidden', t !== tab);
    }
    if (tabBtn) {
      tabBtn.classList.toggle('active', t === tab);
    }
  });

  if (tab === 'buyer') {
    // If buyer persona not yet set, default to demo buyer
    if (!STATE.buyer) {
      STATE.buyer = { id: 3, name: 'Mohammed Kabadi', phone: '9876543220' };
      STATE.buyerLat = 12.9700;
      STATE.buyerLng = 77.5900;
      hide('buyer-reg-card');
      show('map-controls-card');
      show('nearby-card');
    }
    setTimeout(() => {
      initMap();
      loadNearbyListings();
    }, 150);
  }
  if (tab === 'handover') {
    if (!STATE.buyer) {
      STATE.buyer = { id: 3, name: 'Mohammed Kabadi', phone: '9876543220' };
    }
    loadBuyerOrderShortcuts();
  }
  if (tab === 'admin') {
    loadAdminDashboard();
  }
}

// ──────────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────────
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function val(id)  { return document.getElementById(id)?.value?.trim() || ''; }
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setLoading(btnId, loading, defaultText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="spinner"></span> Processing...`
    : defaultText;
}

// ──────────────────────────────────────────────
// CATEGORIES
// ──────────────────────────────────────────────
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    const data = await res.json();
    if (data.success) {
      STATE.categories = data.categories || data.data || [];
      populateCategorySelects();
      populateRateTable();
    }
  } catch (e) {
    console.warn('Could not load categories:', e.message);
  }
}

function populateCategorySelects() {
  const selects = ['listing-category', 'filter-category'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Keep first placeholder option
    const first = el.options[0];
    el.innerHTML = '';
    el.appendChild(first);
    STATE.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.icon} ${c.display_name}`;
      opt.dataset.name = c.name;
      opt.dataset.price = c.standard_price_per_kg;
      el.appendChild(opt);
    });
  });
  // Filter category uses name not id
  const filterSel = document.getElementById('filter-category');
  if (filterSel) {
    Array.from(filterSel.options).slice(1).forEach((opt, i) => {
      opt.value = STATE.categories[i]?.name || '';
    });
  }
}

function populateRateTable() {
  const body = document.getElementById('rate-table-body');
  if (!body) return;
  body.innerHTML = STATE.categories.map(c => `
    <div class="rate-row">
      <div class="rate-material">
        <span style="font-size:1.4rem">${c.icon}</span>
        <span>${c.display_name}</span>
      </div>
      <div class="rate-price">₹${parseFloat(c.standard_price_per_kg).toFixed(2)}/kg</div>
    </div>
  `).join('');
}

function toggleRateCard() {
  document.getElementById('rate-modal').classList.toggle('hidden');
}

// ──────────────────────────────────────────────
// SELLER — REGISTRATION
// ──────────────────────────────────────────────
async function registerSeller() {
  const name  = val('seller-name');
  const phone = val('seller-phone');
  if (!name || phone.length < 10) {
    showToast('Please enter a valid name and 10-digit phone number.', 'error');
    return;
  }

  const btn = document.getElementById('seller-reg-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Registering...';

  try {
    const position = await getPositionPromise().catch(() => null);
    const body = {
      name, phone,
      lat: position?.coords.latitude  || null,
      lng: position?.coords.longitude || null,
    };
    const res  = await fetch('/api/seller/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    STATE.seller = { id: data.user?.id || data.user, name, phone };
    // Resolve id when existing user returned
    if (data.existing && data.user?.id) STATE.seller.id = data.user.id;

    document.getElementById('nav-user-info').innerHTML =
      `<span class="live-dot"></span> ${name}`;
    hide('seller-reg-card');
    show('scanner-card');
    show('listing-card');
    loadMyListings();
    getLocation();
    showToast(`Welcome, ${name}! 🌿`, 'success');
  } catch (e) {
    showToast(e.message || 'Registration failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Continue →</span>';
  }
}

// ──────────────────────────────────────────────
// SELLER — IMAGE UPLOAD & AI SCAN
// ──────────────────────────────────────────────
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('image-preview').src = e.target.result;
    hide('upload-zone');
    show('image-preview-container');
    document.getElementById('scan-btn').disabled = false;
    STATE._imageFile = file;
    STATE._imageBase64 = e.target.result.split(',')[1];
    STATE._imageMime  = file.type || 'image/jpeg';
  };
  reader.readAsDataURL(file);
}

function resetImage() {
  document.getElementById('scrap-image').value = '';
  show('upload-zone');
  hide('image-preview-container');
  hide('ai-result');
  document.getElementById('scan-btn').disabled = true;
  STATE._imageBase64 = null;
  STATE.aiResult = null;
}

async function scanWithAI() {
  if (!STATE._imageBase64) return;
  const btn = document.getElementById('scan-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Scanning with Gemini AI...';

  try {
    const res = await fetch('/api/ai/classify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: STATE._imageBase64, mimeType: STATE._imageMime }),
    });
    const data = await res.json();
    const d = data.data;
    STATE.aiResult = d;

    // Find matching category
    const cat = STATE.categories.find(c => c.name === d.category);
    const rate = cat ? parseFloat(cat.standard_price_per_kg) : 0;
    const payout = (parseFloat(d.estimated_weight_kg) * rate).toFixed(2);

    setText('ai-material', d.display_name || d.category);
    setText('ai-weight',   `${d.estimated_weight_kg} kg`);
    setText('ai-rate',     `₹${rate.toFixed(2)}/kg`);
    setText('ai-payout',   `₹${payout}`);
    setText('ai-notes-text', d.material_notes || 'No notes.');
    document.getElementById('confidence-pill').textContent = `${d.confidence}% confident`;

    // Pre-fill listing form
    document.getElementById('listing-title').value = d.suggested_title || '';
    document.getElementById('listing-weight').value = d.estimated_weight_kg || '';
    if (cat) {
      const sel = document.getElementById('listing-category');
      Array.from(sel.options).forEach(o => {
        if (o.dataset.name === d.category) sel.value = o.value;
      });
    }
    updateEstimatedPayout();
    show('ai-result');
    show('listing-card');
    showToast('AI scan complete! ✨', 'success');
  } catch (e) {
    showToast('AI scan failed — please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">✨</span> Scan with AI';
  }
}

// ──────────────────────────────────────────────
// SELLER — PAYOUT ESTIMATOR
// ──────────────────────────────────────────────
function updateEstimatedPayout() {
  const sel    = document.getElementById('listing-category');
  const weight = parseFloat(val('listing-weight')) || 0;
  const opt    = sel?.selectedOptions[0];
  const price  = parseFloat(opt?.dataset.price) || 0;
  const payout = (weight * price).toFixed(2);
  setText('payout-display', `₹${payout}`);
}

// ──────────────────────────────────────────────
// SELLER — GEOLOCATION
// ──────────────────────────────────────────────
function getPositionPromise() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
  });
}

async function getLocation() {
  setText('location-status', 'Fetching location...');
  try {
    const pos = await getPositionPromise();
    STATE._sellerLat = pos.coords.latitude;
    STATE._sellerLng = pos.coords.longitude;
    setText('location-status',
      `📍 ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
  } catch {
    setState_UseDefault();
    setText('location-status', '⚠️ Location unavailable — using demo coords');
  }
}

function setState_UseDefault() {
  STATE._sellerLat = 12.9716;
  STATE._sellerLng = 77.5946;
}

// ──────────────────────────────────────────────
// SELLER — PUBLISH LISTING
// ──────────────────────────────────────────────
async function publishListing() {
  if (!STATE.seller?.id) {
    showToast('Please register first.', 'error'); return;
  }
  const catSel     = document.getElementById('listing-category');
  const categoryId = catSel.value;
  const title      = val('listing-title');
  const weight     = parseFloat(val('listing-weight'));

  if (!categoryId || !title || !weight || weight <= 0) {
    showToast('Please fill in title, category, and weight.', 'error'); return;
  }

  const lat = STATE._sellerLat;
  const lng = STATE._sellerLng;
  if (!lat || !lng) {
    showToast('Location not yet obtained. Try refreshing.', 'error'); return;
  }

  const btn = document.querySelector('#listing-card .btn-primary');
  btn.disabled = true;
  btn.textContent = 'Publishing...';

  try {
    const payload = {
      seller_id:          STATE.seller.id,
      category_id:        parseInt(categoryId),
      title,
      estimated_weight:   weight,
      lat, lng,
      address:            val('listing-address'),
      landmark:           val('listing-landmark'),
      gate_instructions:  val('listing-gate'),
      ai_confidence:      STATE.aiResult?.confidence || null,
      actual_photo_base64: STATE._imageBase64 || null,
    };
    const res = await fetch('/api/seller/listings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(`Listing published! Estimated payout: ₹${data.estimated_payout}`, 'success');
    show('my-listings-card');
    loadMyListings();

    // Reset scanner for next listing
    resetImage();
    hide('ai-result');
    document.getElementById('listing-title').value = '';
    document.getElementById('listing-weight').value = '';
    document.getElementById('listing-category').value = '';
    document.getElementById('listing-address').value = '';
    document.getElementById('listing-landmark').value = '';
    document.getElementById('listing-gate').value = '';
    updateEstimatedPayout();
  } catch (e) {
    showToast(e.message || 'Failed to publish listing.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Publish Listing';
  }
}

// ──────────────────────────────────────────────
// SELLER — MY LISTINGS
// ──────────────────────────────────────────────
async function loadMyListings() {
  if (!STATE.seller?.id) return;
  try {
    const res  = await fetch(`/api/seller/listings/${STATE.seller.id}`);
    const data = await res.json();
    if (!data.success) return;

    const list = document.getElementById('my-listings-list');
    if (!data.listings.length) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px">No listings yet.</p>';
      return;
    }

    // Compute impact stats
    let totalKg = 0, totalEarned = 0;
    data.listings.forEach(l => {
      if (l.status === 'completed') {
        totalKg     += parseFloat(l.estimated_weight) || 0;
        totalEarned += parseFloat(l.estimated_payout) || 0;
      }
    });
    setText('imp-kg',   `${totalKg.toFixed(1)} kg`);
    setText('imp-co2',  `${(totalKg * 1.5).toFixed(1)} kg`);
    setText('imp-earn', `₹${totalEarned.toFixed(0)}`);
    show('my-listings-card');
    show('impact-tracker');

    list.innerHTML = data.listings.map(l => `
      <div class="listing-item">
        <div class="listing-top">
          <div>
            <div class="listing-title">${l.icon || '♻️'} ${l.title}</div>
            <div class="listing-addr">${l.address || '—'}</div>
          </div>
          <span class="status-pill ${l.status}">${l.status}</span>
        </div>
        <div class="listing-footer">
          <span class="listing-weight">⚖️ ~${l.estimated_weight} kg · ${l.category_name}</span>
          <span class="listing-payout">₹${parseFloat(l.estimated_payout).toFixed(2)}</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('loadMyListings:', e);
  }
}

// ──────────────────────────────────────────────
// BUYER — REGISTRATION
// ──────────────────────────────────────────────
async function registerBuyer() {
  const name  = val('buyer-name');
  const phone = val('buyer-phone');
  if (!name || phone.length < 10) {
    showToast('Please enter a valid name and 10-digit phone number.', 'error'); return;
  }

  try {
    const position = await getPositionPromise().catch(() => null);
    STATE.buyerLat = position?.coords.latitude  || 12.9700;
    STATE.buyerLng = position?.coords.longitude || 77.5900;

    const res = await fetch('/api/buyer/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, lat: STATE.buyerLat, lng: STATE.buyerLng }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    STATE.buyer = { id: data.user?.id || data.user, name, phone };
    if (data.existing && data.user?.id) STATE.buyer.id = data.user.id;

    hide('buyer-reg-card');
    show('map-controls-card');
    show('nearby-card');
    initMap();
    loadNearbyListings();
    showToast(`Welcome, ${name}! 🗺️`, 'success');
  } catch (e) {
    showToast(e.message || 'Registration failed.', 'error');
  }
}

// ──────────────────────────────────────────────
// BUYER — LEAFLET MAP
// ──────────────────────────────────────────────
function initMap() {
  if (STATE.map) return; // already initialized

  const lat = STATE.buyerLat || 12.9716;
  const lng = STATE.buyerLng || 77.5946;

  STATE.map = L.map('map-container').setView([lat, lng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(STATE.map);

  // Buyer marker
  L.circleMarker([lat, lng], {
    radius: 10, color: '#3b82f6', fillColor: '#60a5fa',
    fillOpacity: 0.8, weight: 2,
  }).addTo(STATE.map).bindPopup('📍 Your Location');
}

async function loadNearbyListings() {
  const lat    = STATE.buyerLat || 12.9716;
  const lng    = STATE.buyerLng || 77.5946;
  const radius = document.getElementById('filter-radius')?.value || 15000;
  const cat    = document.getElementById('filter-category')?.value || '';

  const params = new URLSearchParams({ lat, lng, radius });
  if (cat) params.append('category', cat);

  try {
    const res  = await fetch(`/api/buyer/nearby-listings?${params}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    renderNearbyList(data.listings);
    plotMapMarkers(data.listings);
    setText('listing-count-badge', `${data.count} listing${data.count !== 1 ? 's' : ''} found`);
    setText('nearby-subtitle', `${data.count} pickups within ${(parseInt(radius)/1000).toFixed(0)} km`);
  } catch (e) {
    showToast('Could not load nearby listings.', 'error');
  }
}

function renderNearbyList(listings) {
  const list = document.getElementById('nearby-listings-list');
  if (!listings.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px">No listings found in this area.</p>';
    return;
  }
  list.innerHTML = listings.map(l => `
    <div class="listing-item" onclick="acceptListing(${l.id}, '${escHtml(l.title)}')">
      <div class="listing-top">
        <div>
          <span class="listing-material-tag">${l.icon || '♻️'} ${l.category_name}</span>
          <div class="listing-title" style="margin-top:6px">${escHtml(l.title)}</div>
          <div class="listing-addr">📍 ${escHtml(l.address || '')} · ${l.landmark ? '🏛️ ' + escHtml(l.landmark) : ''}</div>
        </div>
      </div>
      <div class="listing-footer">
        <span class="listing-weight">⚖️ ~${l.estimated_weight} kg · ${l.distance_km} km away</span>
        <span class="listing-payout">₹${parseFloat(l.estimated_payout).toFixed(2)}</span>
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px;width:100%"
        onclick="event.stopPropagation();acceptListing(${l.id}, '${escHtml(l.title)}')">
        ✅ Accept & Schedule Pickup
      </button>
    </div>
  `).join('');
}

function plotMapMarkers(listings) {
  // Clear old markers
  STATE.markers.forEach(m => STATE.map?.removeLayer(m));
  STATE.markers = [];

  const redIcon = L.divIcon({
    className: '',
    html: `<div style="
      background:#ef4444;width:14px;height:14px;
      border-radius:50%;border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.5)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7],
  });

  listings.forEach(l => {
    if (!l.lat || !l.lng) return;
    const m = L.marker([l.lat, l.lng], { icon: redIcon })
      .bindPopup(`
        <strong>${l.icon} ${escHtml(l.title)}</strong><br>
        ${escHtml(l.category_name)} · ~${l.estimated_weight} kg<br>
        <strong style="color:#22c55e">₹${parseFloat(l.estimated_payout).toFixed(2)}</strong><br>
        ${l.distance_km} km away<br>
        <button onclick="acceptListing(${l.id},'${escHtml(l.title)}')"
          style="margin-top:6px;background:#22c55e;border:none;color:#000;
                 padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:600">
          Accept
        </button>`)
      .addTo(STATE.map);
    STATE.markers.push(m);
  });

  if (listings.length && STATE.map) {
    const group = L.featureGroup(STATE.markers);
    STATE.map.fitBounds(group.getBounds().pad(0.2));
  }
}

async function acceptListing(listingId, title) {
  if (!STATE.buyer?.id) {
    showToast('Please register as a buyer first.', 'error'); return;
  }
  if (!confirm(`Accept pickup for:\n"${title}"?\n\nAn OTP will be generated for the seller.`)) return;

  try {
    const res = await fetch('/api/buyer/accept-listing', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer_id: STATE.buyer.id, listing_id: listingId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const otp = data.otp_for_seller;
    showToast(`Order created! 🎉 Seller's OTP: ${otp}. Share this with the seller.`, 'success', 8000);

    // Prompt copy
    if (navigator.clipboard) {
      navigator.clipboard.writeText(otp).catch(() => {});
    }

    // Auto-populate handover tab
    document.getElementById('order-id-input').value = data.order.id;
    loadBuyerOrderShortcuts();
    loadNearbyListings(); // refresh map
  } catch (e) {
    showToast(e.message || 'Failed to accept listing.', 'error');
  }
}

// ──────────────────────────────────────────────
// HANDOVER — ORDER SHORTCUTS
// ──────────────────────────────────────────────
async function loadBuyerOrderShortcuts() {
  if (!STATE.buyer?.id) return;
  try {
    const res  = await fetch(`/api/buyer/orders/${STATE.buyer.id}`);
    const data = await res.json();
    if (!data.success || !data.orders.length) return;

    const active = data.orders.filter(o => o.status !== 'picked_up' && o.status !== 'cancelled');
    if (!active.length) return;

    const shortcut = document.getElementById('buyer-orders-shortcut');
    const pills    = document.getElementById('buyer-order-pills');
    shortcut.classList.remove('hidden');
    pills.innerHTML = active.map(o => `
      <button class="order-pill" onclick="loadOrderById(${o.id})">
        Order #${o.id} — ${o.category_name || ''} ${o.icon || ''}
      </button>
    `).join('');
  } catch (e) {
    console.warn('Could not load buyer orders:', e.message);
  }
}

async function loadOrder() {
  const id = val('order-id-input');
  if (!id) { showToast('Please enter an Order ID.', 'error'); return; }
  await loadOrderById(parseInt(id));
}

async function loadOrderById(orderId) {
  try {
    const res  = await fetch(`/api/orders/${orderId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const o = data.order;
    STATE.currentOrder = o;

    // Populate order details
    setText('order-title',   o.title);
    setText('order-subtitle', `Order #${o.id} · ${o.category_name}`);
    setText('order-cat-icon', o.icon || '📦');
    setText('od-material',   o.category_name);
    setText('od-seller',     o.seller_name);
    setText('od-address',    o.address || '—');
    setText('od-landmark',   o.landmark || '—');
    setText('od-gate',       o.gate_instructions || '—');

    const badge = document.getElementById('order-status-badge');
    badge.textContent = o.status.replace('_', ' ');
    badge.style.background = o.status === 'picked_up'
      ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)';
    badge.style.color = o.status === 'picked_up'
      ? 'var(--green-400)' : 'var(--amber-400)';

    // Maps link
    if (o.seller_lat && o.seller_lng) {
      document.getElementById('nav-link').href =
        `https://www.google.com/maps/dir/?api=1&destination=${o.seller_lat},${o.seller_lng}`;
    }

    // Rate for calculator
    STATE._orderRate = parseFloat(o.final_rate || o.standard_price_per_kg);
    setText('calc-rate', `₹${STATE._orderRate.toFixed(2)}`);

    show('order-detail-card');

    if (o.status === 'picked_up') {
      hide('weigh-card');
      hide('otp-card');
      showToast('This order is already completed.', 'info');
    } else {
      show('weigh-card');
      hide('otp-card');
      hide('receipt-card');
    }

    showToast(`Order #${orderId} loaded ✔`, 'success');
  } catch (e) {
    showToast(e.message || 'Order not found.', 'error');
  }
}

// ──────────────────────────────────────────────
// HANDOVER — WEIGHT CALCULATOR
// ──────────────────────────────────────────────
const TARE_MAP = {
  none:         0,
  gunny_sack:   0.5,
  plastic_crate: 1.5,
  metal_drum:   5.0,
};

function calculateNet() {
  const gross    = parseFloat(document.getElementById('gross-weight').value) || 0;
  const tareType = document.getElementById('tare-type').value;

  let tare = 0;
  if (tareType === 'custom') {
    tare = parseFloat(document.getElementById('custom-tare').value) || 0;
    show('custom-tare-group');
  } else {
    tare = TARE_MAP[tareType] || 0;
    hide('custom-tare-group');
  }

  const net    = Math.max(0, gross - tare);
  const rate   = STATE._orderRate || 0;
  const payout = net * rate;

  setText('calc-gross',  `${gross.toFixed(1)} kg`);
  setText('calc-tare',   `- ${tare.toFixed(1)} kg`);
  setText('calc-net',    `${net.toFixed(1)} kg`);
  setText('calc-rate',   `₹${rate.toFixed(2)}`);
  setText('calc-payout', `₹${payout.toFixed(2)}`);

  STATE.weightData = { gross, tare, net, rate, payout, tareType };
}

// ──────────────────────────────────────────────
// HANDOVER — SCALE OCR
// ──────────────────────────────────────────────
async function handleScaleImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    const manual = STATE.weightData?.gross || 0;

    const resultEl = document.getElementById('scale-verify-result');
    resultEl.innerHTML = '<div class="scale-verify-box unreadable">🔍 Analysing scale photo…</div>';
    resultEl.classList.remove('hidden');

    try {
      const res = await fetch('/api/ai/verify-scale', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type, manualWeight: manual }),
      });
      const data = await res.json();
      const d = data.data;
      const cls = d.verdict === 'match' ? 'match' : d.verdict === 'mismatch' ? 'mismatch' : 'unreadable';
      const icon = cls === 'match' ? '✅' : cls === 'mismatch' ? '⚠️' : '🔆';
      resultEl.innerHTML = `
        <div class="scale-verify-box ${cls}">
          ${icon} <strong>AI Scale Read:</strong> ${d.display_value || '—'} 
          (${d.detected_weight_kg != null ? d.detected_weight_kg + ' kg' : 'unreadable'})
          · ${d.verdict?.toUpperCase()} · ${d.notes || ''}
        </div>`;
      STATE._scaleBase64 = base64;
      STATE._scaleVerified = d.verdict === 'match';
      if (cls === 'mismatch') {
        showToast(`⚠️ Scale mismatch! AI detected ${d.detected_weight_kg} kg vs manual ${manual} kg.`, 'error', 6000);
      }
    } catch {
      resultEl.innerHTML = '<div class="scale-verify-box unreadable">⚠️ Could not analyse scale — proceed manually.</div>';
    }
  };
  reader.readAsDataURL(file);
}

// ──────────────────────────────────────────────
// HANDOVER — SUBMIT WEIGHT
// ──────────────────────────────────────────────
async function submitWeight() {
  if (!STATE.currentOrder) { showToast('No order loaded.', 'error'); return; }
  if (!STATE.weightData || STATE.weightData.gross <= 0) {
    showToast('Please enter the gross weight.', 'error'); return;
  }

  const orderId = STATE.currentOrder.id;
  try {
    const res = await fetch(`/api/orders/${orderId}/weigh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gross_weight:       STATE.weightData.gross,
        tare_type:          STATE.weightData.tareType,
        custom_tare:        STATE.weightData.tare,
        scale_photo_base64: STATE._scaleBase64 || null,
        scale_verified:     STATE._scaleVerified || false,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // Update OTP summary
    const c = data.calculation;
    setText('sum-weight', `${c.actual_weight} kg`);
    setText('sum-rate',   `₹${c.rate_per_kg}/kg`);
    setText('sum-amount', `₹${c.final_amount.toFixed(2)}`);

    show('otp-card');
    hide('weigh-card');
    showToast('Weight confirmed! Ask seller for OTP.', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to submit weight.', 'error');
  }
}

// ──────────────────────────────────────────────
// HANDOVER — OTP VERIFY & COMPLETE
// ──────────────────────────────────────────────
async function verifyOTP() {
  const otp = val('otp-input');
  if (!otp || otp.length < 4) { showToast('Please enter the 4-digit OTP.', 'error'); return; }
  if (!STATE.currentOrder) { showToast('No order loaded.', 'error'); return; }

  const btn = document.querySelector('#otp-card .btn-success');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Verifying...';

  try {
    const res = await fetch(`/api/orders/${STATE.currentOrder.id}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_code: otp }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const r = data.receipt;
    renderReceipt(r);
    hide('otp-card');
    hide('weigh-card');
    show('receipt-card');
    showToast('Transaction complete! 🎉', 'success');
  } catch (e) {
    showToast(e.message || 'OTP verification failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔓 Verify & Complete Transaction';
  }
}

function renderReceipt(r) {
  const body = document.getElementById('receipt-body');
  body.innerHTML = `
    <div class="calc-row"><span>Order ID</span><span>#${r.order_id}</span></div>
    <div class="calc-row"><span>Net Weight</span><span>${r.actual_weight} kg</span></div>
    <div class="calc-row"><span>Rate / kg</span><span>₹${r.rate_per_kg}</span></div>
    <div class="calc-row payout"><span>💰 Amount Paid</span><span>₹${parseFloat(r.final_amount).toFixed(2)}</span></div>
    <div class="calc-row" style="font-size:0.78rem;color:var(--text-muted)">
      <span>Completed</span><span>${new Date(r.completed_at).toLocaleString('en-IN')}</span>
    </div>`;
  setText('receipt-co2',    `${r.co2_saved_kg} kg`);
  setText('receipt-energy', `${(parseFloat(r.co2_saved_kg) * 2.7).toFixed(1)} kWh`);
}

function resetHandover() {
  hide('order-detail-card');
  hide('weigh-card');
  hide('otp-card');
  hide('receipt-card');
  STATE.currentOrder = null;
  STATE.weightData   = null;
  STATE._scaleBase64 = null;
  document.getElementById('order-id-input').value = '';
  document.getElementById('otp-input').value = '';
  document.getElementById('gross-weight').value = '';
  document.getElementById('tare-type').value = 'none';
  calculateNet();
  loadBuyerOrderShortcuts();
}

// ──────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ──────────────────────────────────────────────
// PERSONA & ROLE SWITCHER
// ──────────────────────────────────────────────
function switchPersona(persona) {
  if (persona === 'seller') {
    STATE.seller = { id: 1, name: 'Rajesh Kumar', phone: '9876543210' };
    const nameInput = document.getElementById('seller-name');
    const phoneInput = document.getElementById('seller-phone');
    if (nameInput) nameInput.value = 'Rajesh Kumar';
    if (phoneInput) phoneInput.value = '9876543210';
    hide('seller-reg-card');
    show('scanner-card');
    show('listing-card');
    loadMyListings();
    getLocation();
    document.getElementById('nav-user-info').querySelector('.live-dot')?.setAttribute('title', 'Rajesh (Seller) Online');
    switchTab('seller');
    showToast('Switched to Seller persona: Rajesh Kumar 📦', 'info');
  } else if (persona === 'buyer') {
    STATE.buyer = { id: 3, name: 'Mohammed Kabadi', phone: '9876543220' };
    STATE.buyerLat = 12.9700;
    STATE.buyerLng = 77.5900;
    const nameInput = document.getElementById('buyer-name');
    const phoneInput = document.getElementById('buyer-phone');
    if (nameInput) nameInput.value = 'Mohammed Kabadi';
    if (phoneInput) phoneInput.value = '9876543220';
    hide('buyer-reg-card');
    show('map-controls-card');
    show('nearby-card');
    switchTab('buyer');
    showToast('Switched to Buyer persona: Mohammed Kabadi 🏪', 'info');
  } else if (persona === 'admin') {
    switchTab('admin');
    showToast('Admin Mode: Full Platform Access Granted 👑', 'success');
  }
}

// ──────────────────────────────────────────────
// ADMIN — DASHBOARD & METRICS
// ──────────────────────────────────────────────
let currentAdminSubtab = 'rates';

function switchAdminSubtab(sub) {
  currentAdminSubtab = sub;
  ['rates', 'listings', 'orders', 'users'].forEach(s => {
    document.getElementById(`subtab-${s}`)?.classList.toggle('active', s === sub);
    document.getElementById(`admin-view-${s}`)?.classList.toggle('hidden', s !== sub);
  });

  if (sub === 'rates')    loadAdminRates();
  if (sub === 'listings') loadAdminListings();
  if (sub === 'orders')   loadAdminOrders();
  if (sub === 'users')    loadAdminUsers();
}

async function loadAdminDashboard() {
  try {
    const res = await fetch('/api/admin/stats');
    const data = await res.json();
    if (data.success) {
      const s = data.stats;
      setText('adm-recycled', `${s.total_recycled_kg} kg`);
      setText('adm-turnover', `₹${s.total_turnover_inr.toLocaleString('en-IN')}`);
      setText('adm-commission', `₹${s.platform_commission_inr.toLocaleString('en-IN')}`);
      setText('adm-co2', `${s.co2_saved_kg} kg`);
      setText('adm-trees', `~${s.trees_equivalent} trees saved`);
      setText('adm-active-listings', `${s.active_listings_count}`);
      setText('adm-matched-sub', `${s.matched_listings_count} in pickup`);
      setText('adm-completed-orders', `${s.completed_orders_count}`);
      setText('adm-users-sub', `${s.total_users} registered (${s.sellers_count}S / ${s.buyers_count}B)`);
    }
  } catch (e) {
    console.warn('Could not load admin stats:', e.message);
  }
  switchAdminSubtab(currentAdminSubtab);
}

// ──────────────────────────────────────────────
// ADMIN — RATES MANAGER
// ──────────────────────────────────────────────
async function loadAdminRates() {
  const tbody = document.getElementById('admin-rates-table-body');
  if (!tbody) return;
  try {
    const res = await fetch('/api/categories');
    const data = await res.json();
    const categories = data.data || data.categories || [];
    STATE.categories = categories;

    if (!categories.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px;">No categories found.</td></tr>';
      return;
    }

    tbody.innerHTML = categories.map(c => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.3rem;">${c.icon || '♻️'}</span>
            <strong>${escHtml(c.display_name)}</strong>
          </div>
        </td>
        <td style="color:var(--text-muted);font-family:monospace;">${escHtml(c.name)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:var(--text-secondary);">₹</span>
            <input type="number" id="rate-input-${c.id}" class="rate-edit-input" value="${parseFloat(c.standard_price_per_kg).toFixed(2)}" step="0.5" min="0.5" />
            <span style="color:var(--text-muted);font-size:0.75rem;">/kg</span>
          </div>
        </td>
        <td>
          <button class="btn-action success" onclick="saveCategoryRate(${c.id})">💾 Save Rate</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--red-400);text-align:center;">Failed to load rates: ${e.message}</td></tr>`;
  }
}

async function saveCategoryRate(id) {
  const input = document.getElementById(`rate-input-${id}`);
  if (!input) return;
  const newPrice = parseFloat(input.value);
  if (isNaN(newPrice) || newPrice <= 0) {
    showToast('Please enter a valid price per kg.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/admin/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standard_price_per_kg: newPrice }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // Update local cache
    const cat = STATE.categories.find(c => c.id === id);
    if (cat) cat.standard_price_per_kg = newPrice;
    populateCategorySelects();
    populateRateTable();
    showToast(`Updated rate to ₹${newPrice.toFixed(2)}/kg! 🏷️`, 'success');
  } catch (e) {
    showToast(`Failed to update rate: ${e.message}`, 'error');
  }
}

function showAddCategoryModal() {
  document.getElementById('add-category-modal')?.classList.remove('hidden');
}
function hideAddCategoryModal() {
  document.getElementById('add-category-modal')?.classList.add('hidden');
}

async function submitNewCategory() {
  const name  = val('new-cat-name');
  const price = parseFloat(val('new-cat-price'));
  const icon  = val('new-cat-icon') || '♻️';

  if (!name || isNaN(price) || price <= 0) {
    showToast('Please provide a category name and positive price.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, display_name: name, standard_price_per_kg: price, icon }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    hideAddCategoryModal();
    document.getElementById('new-cat-name').value = '';
    document.getElementById('new-cat-price').value = '';
    loadCategories();
    loadAdminRates();
    showToast(`Added ${name} (₹${price}/kg) to market catalog! ✨`, 'success');
  } catch (e) {
    showToast(`Failed to add category: ${e.message}`, 'error');
  }
}

// ──────────────────────────────────────────────
// ADMIN — LISTINGS AUDIT
// ──────────────────────────────────────────────
async function loadAdminListings() {
  const tbody = document.getElementById('admin-listings-table-body');
  if (!tbody) return;
  const statusFilter = document.getElementById('admin-listing-filter')?.value || 'all';

  try {
    const res = await fetch(`/api/admin/listings?status=${statusFilter}`);
    const data = await res.json();
    const listings = data.listings || [];

    if (!listings.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;">No listings matching filter.</td></tr>';
      return;
    }

    tbody.innerHTML = listings.map(l => `
      <tr>
        <td style="font-weight:700;">#${l.id}</td>
        <td>
          <div style="font-weight:600;">${l.category_icon || '♻️'} ${escHtml(l.title)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${escHtml(l.address || 'Location provided')}</div>
        </td>
        <td>
          <div>${escHtml(l.seller_name || 'Seller')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${escHtml(l.seller_phone || '—')}</div>
        </td>
        <td>${l.estimated_weight} kg</td>
        <td style="font-weight:600;color:var(--green-400);">₹${parseFloat(l.estimated_payout || 0).toFixed(2)}</td>
        <td><span class="status-pill ${l.status}">${l.status}</span></td>
        <td>
          <div class="action-btn-group">
            ${l.status !== 'available' ? `<button class="btn-action success" onclick="updateListingStatus(${l.id}, 'available')" title="Mark Available">Available</button>` : ''}
            ${l.status !== 'completed' ? `<button class="btn-action" onclick="updateListingStatus(${l.id}, 'completed')" title="Mark Completed">Complete</button>` : ''}
            <button class="btn-action danger" onclick="deleteListing(${l.id})" title="Delete Listing">✕</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red-400);text-align:center;">Failed: ${e.message}</td></tr>`;
  }
}

async function updateListingStatus(id, newStatus) {
  try {
    const res = await fetch(`/api/admin/listings/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast(`Listing #${id} status changed to ${newStatus}`, 'success');
    loadAdminListings();
    loadAdminDashboard();
  } catch (e) {
    showToast(e.message || 'Status update failed', 'error');
  }
}

async function deleteListing(id) {
  if (!confirm(`Are you sure you want to delete listing #${id}?`)) return;
  try {
    const res = await fetch(`/api/admin/listings/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast(`Listing #${id} deleted`, 'info');
    loadAdminListings();
    loadAdminDashboard();
  } catch (e) {
    showToast(e.message || 'Delete failed', 'error');
  }
}

// ──────────────────────────────────────────────
// ADMIN — ORDERS & DOORSTEP AUDIT
// ──────────────────────────────────────────────
async function loadAdminOrders() {
  const tbody = document.getElementById('admin-orders-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/orders');
    const data = await res.json();
    const orders = data.orders || [];

    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:16px;">No orders found.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td style="font-weight:700;">#${o.id}</td>
        <td>
          <div style="font-weight:600;">${o.category_icon || '📦'} ${escHtml(o.listing_title || 'Scrap')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${escHtml(o.category_name || '')}</div>
        </td>
        <td>
          <div style="font-size:0.8rem;"><strong>Buyer:</strong> ${escHtml(o.buyer_name || 'Buyer')}</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);"><strong>Seller:</strong> ${escHtml(o.seller_name || 'Seller')}</div>
        </td>
        <td>
          <div><strong>Net:</strong> ${o.actual_weight != null ? o.actual_weight + ' kg' : 'Pending'}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">Gross: ${o.gross_weight || '—'} (Tare: -${o.tare_deduction || 0})</div>
        </td>
        <td style="font-weight:700;color:var(--green-400);">
          ${o.final_amount != null ? '₹' + parseFloat(o.final_amount).toFixed(2) : '—'}
        </td>
        <td>
          <span style="font-family:monospace;background:rgba(255,255,255,0.08);padding:3px 8px;border-radius:4px;font-weight:700;letter-spacing:1px;">
            ${o.otp_code}
          </span>
          <div style="font-size:0.7rem;color:${o.otp_verified ? 'var(--green-400)' : 'var(--amber-400)'};">
            ${o.otp_verified ? '✓ Verified' : '⏳ Pending'}
          </div>
        </td>
        <td><span class="status-pill ${o.status}">${o.status}</span></td>
        <td>
          <div class="action-btn-group">
            ${o.status !== 'picked_up' ? `
              <button class="btn-action success" onclick="adminOverrideOrder(${o.id}, 'picked_up')" title="Force Complete Settlement">
                ✓ Settle
              </button>` : '<span style="color:var(--green-400);font-size:0.75rem;">Completed</span>'
            }
            <button class="btn-action" onclick="inspectOrderInHandover(${o.id})" title="Open Doorstep Screen">
              ⚖️ Doorstep
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red-400);text-align:center;">Failed: ${e.message}</td></tr>`;
  }
}

async function adminOverrideOrder(orderId, status) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes: 'Admin manual settlement override' }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(`Order #${orderId} marked as completed by Admin! ✅`, 'success');
    loadAdminOrders();
    loadAdminDashboard();
  } catch (e) {
    showToast(e.message || 'Override failed', 'error');
  }
}

function inspectOrderInHandover(orderId) {
  document.getElementById('order-id-input').value = orderId;
  switchTab('handover');
  loadOrder();
  showToast(`Loaded Order #${orderId} in Doorstep Weigh-in Station ⚖️`, 'info');
}

// ──────────────────────────────────────────────
// ADMIN — USERS DIRECTORY
// ──────────────────────────────────────────────
async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    const users = data.users || [];

    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;">No users found.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => `
      <tr>
        <td style="font-weight:700;">#${u.id}</td>
        <td><strong>${escHtml(u.name)}</strong></td>
        <td style="font-family:monospace;">${escHtml(u.phone)}</td>
        <td>
          <span class="admin-badge ${u.role}">${u.role}</span>
        </td>
        <td style="font-size:0.8rem;color:var(--text-secondary);">
          ${u.role === 'seller' ? `${u.listings_count} listings posted` : u.role === 'buyer' ? `${u.orders_count} orders claimed` : 'System Administrator'}
        </td>
        <td>
          <button class="btn-action ${u.role === 'seller' ? 'success' : ''}" onclick="switchPersona('${u.role}')">
            ⚡ Switch to ${u.role.toUpperCase()}
          </button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red-400);text-align:center;">Failed: ${e.message}</td></tr>`;
  }
}

// ──────────────────────────────────────────────
// ADMIN — RESET DEMO DATA
// ──────────────────────────────────────────────
async function seedDemoData() {
  if (!confirm('Reset platform data to clean live demo dataset? (Will seed sample Bangalore sellers, buyers, listings & rates)')) return;
  try {
    const res = await fetch('/api/admin/reset-demo', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast('Platform demo dataset seeded & reset successfully! 🌿', 'success');
    loadCategories();
    loadAdminDashboard();
    if (STATE.buyer) loadNearbyListings();
    if (STATE.seller) loadMyListings();
  } catch (e) {
    showToast(e.message || 'Reset failed', 'error');
  }
}

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCategories();
  // Close rate modal on overlay click
  document.getElementById('rate-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('rate-modal')) toggleRateCard();
  });
  // Close add category modal on overlay click
  document.getElementById('add-category-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-category-modal')) hideAddCategoryModal();
  });

  // Check URL hash for direct tab navigation e.g. #admin, #buyer
  const hash = (window.location.hash || '').replace('#', '');
  if (['seller', 'buyer', 'handover', 'admin'].includes(hash)) {
    switchTab(hash);
    const personaSel = document.getElementById('persona-switcher');
    if (personaSel && (hash === 'admin' || hash === 'seller' || hash === 'buyer')) {
      personaSel.value = hash;
    }
  }
});

