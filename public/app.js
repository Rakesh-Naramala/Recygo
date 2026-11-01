/* =====================================================
   ECOSCRAP — FRONTEND APPLICATION (app.js)
   Full-stack wiring: Seller · Buyer · Doorstep Handover
   ===================================================== */

'use strict';

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
const STATE = {
  currentUser: null,  // { id, name, phone, role }
  isAdmin: false,     // separate admin password verified
  isPrimeAdmin: false, // prime admin superuser access
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
  if (tab === 'admin' && !STATE.isAdmin) {
    const modalInput = document.getElementById('modal-admin-password');
    if (modalInput) modalInput.value = '';
    show('admin-password-modal');
    showToast('Admin password required to enter platform management 👑', 'info');
    return;
  }

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

    const nameEl = document.getElementById('nav-user-name');
    if (nameEl) nameEl.textContent = `${name} (📦 Seller)`;
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
// NOTE: escHtml is defined once below (line ~1270) using String() for full safety.

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
  ['rates', 'listings', 'orders', 'users', 'reports', 'settings'].forEach(s => {
    document.getElementById(`subtab-${s}`)?.classList.toggle('active', s === sub);
    document.getElementById(`admin-view-${s}`)?.classList.toggle('hidden', s !== sub);
  });

  if (sub === 'rates')    loadAdminRates();
  if (sub === 'listings') loadAdminListings();
  if (sub === 'orders')   loadAdminOrders();
  if (sub === 'users')    loadAdminUsers();
  if (sub === 'reports')  loadAdminReports();
  if (sub === 'settings') loadPlatformSettings();
}

async function loadAdminDashboard() {
  // Show/hide prime admin banner and update page title
  const banner = document.getElementById('prime-admin-banner');
  if (banner) {
    if (STATE.isPrimeAdmin) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  }
  const titleEl = document.getElementById('admin-page-title');
  if (titleEl) {
    titleEl.textContent = STATE.isPrimeAdmin ? '👑👑 Prime Admin Control Center' : '👑 Admin Control Center';
  }

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

      const rBadge = document.getElementById('admin-reports-count-badge');
      if (rBadge && s.pending_reports !== undefined) {
        rBadge.textContent = s.pending_reports;
      }
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
// ESCAPING UTILITY (single canonical definition)
// ──────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ──────────────────────────────────────────────
// ADMIN — USERS DIRECTORY & CONTROLS
// ──────────────────────────────────────────────
async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    const users = data.users || [];

    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;">No users found.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const isBlocked = !!u.is_blocked;
      const isAdminUser = u.role === 'admin' || u.role === 'prime_admin';
      const isPrimeAdminUser = u.role === 'prime_admin';
      const viewerIsPrime = STATE.isPrimeAdmin;

      return `
        <tr${isBlocked ? ' style="opacity:0.6;"' : ''}>
          <td style="font-weight:700;">#${u.id}</td>
          <td>
            <strong>${escHtml(u.name)}</strong>
            ${isPrimeAdminUser ? '<span style="color:var(--amber-400);font-size:0.75rem;margin-left:4px;">(Prime Admin)</span>' : ''}
            ${isBlocked ? '<span style="color:var(--red-400);font-size:0.75rem;margin-left:4px;">(Suspended)</span>' : ''}
          </td>
          <td>
            <a href="tel:${escHtml(u.phone)}" style="font-family:monospace;color:var(--green-400);text-decoration:none;">
              📞 ${escHtml(u.phone)}
            </a>
          </td>
          <td>
            <span class="admin-badge ${u.role === 'prime_admin' ? 'prime' : u.role}">${u.role === 'prime_admin' ? '👑👑 PRIME ADMIN' : u.role.toUpperCase()}</span>
          </td>
          <td>
            <span class="status-pill ${isBlocked ? 'open' : 'resolved'}">
              ${isBlocked ? '⛔ Blocked' : '✅ Active'}
            </span>
          </td>
          <td style="font-size:0.8rem;color:var(--text-secondary);">
            ${u.role === 'seller' ? `${u.listings_count || 0} listings posted` : u.role === 'buyer' ? `${u.orders_count || 0} orders claimed` : u.role === 'prime_admin' ? '👑 Superuser Administrator' : 'Platform Administrator'}
          </td>
          <td>
            <div class="action-btn-group">
              ${isPrimeAdminUser ? `
                <span style="font-size:0.75rem;color:var(--amber-400);font-weight:600;padding:4px 6px;">
                  👑👑 Prime Admin
                </span>
              ` : isAdminUser ? `
                ${
                  viewerIsPrime ? `
                    ${isBlocked ? `
                      <button class="btn-action success" onclick="toggleBlockUser(${u.id}, false, true)" title="Unblock this admin account">
                        ✅ Unblock Admin
                      </button>
                    ` : `
                      <button class="btn-action danger" onclick="toggleBlockUser(${u.id}, true, true)" title="Block this admin account">
                        ⛔ Block Admin
                      </button>
                    `}
                  ` : `
                    <span style="font-size:0.75rem;color:var(--amber-400);font-weight:600;padding:4px 6px;">
                      👑 Admin
                    </span>
                  `
                }
              ` : `
                ${isBlocked ? `
                  <button class="btn-action success" onclick="toggleBlockUser(${u.id}, false, false)" title="Unblock user account">
                    ✅ Unblock
                  </button>
                ` : `
                  <button class="btn-action danger" onclick="toggleBlockUser(${u.id}, true, false)" title="Block user from site access">
                    ⛔ Block
                  </button>
                `}
              `}
              <button class="btn-action" onclick="showChangePasswordModal(${u.id}, '${escHtml(u.name)}')" title="Change password of this user or admin">
                🔑 Change Pass
              </button>
              <button class="btn-action" onclick="switchPersona('${u.role}')" title="Test platform in this persona">
                ⚡ Test
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red-400);text-align:center;">Failed: ${e.message}</td></tr>`;
  }
}

// ──────────────────────────────────────────────
// ADMIN — BLOCK / UNBLOCK USER
// ──────────────────────────────────────────────
async function toggleBlockUser(userId, blockStatus, isAdminTarget = false) {
  const targetLabel = isAdminTarget ? 'admin account' : 'user';
  const actionText = blockStatus ? 'block' : 'unblock';
  if (!confirm(`Are you sure you want to ${actionText} this ${targetLabel}? ${blockStatus ? 'They will not be able to log in to the platform.' : 'They will regain normal platform access.'}`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}/block`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_blocked: blockStatus,
        requesting_role: STATE.isPrimeAdmin ? 'prime_admin' : 'admin'
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(data.message || `Account ${actionText}ed!`, 'success');
    loadAdminUsers();
  } catch (e) {
    showToast(e.message || `Failed to ${actionText} account.`, 'error');
  }
}

// ──────────────────────────────────────────────
// ADMIN — CHANGE USER PASSWORD UPON REQUEST
// ──────────────────────────────────────────────
function showChangePasswordModal(userId, userName) {
  document.getElementById('cp-user-id').value = userId;
  setText('cp-user-name', userName);
  document.getElementById('cp-new-password').value = '';
  show('change-password-modal');
}

function closeChangePasswordModal() {
  hide('change-password-modal');
}

async function submitUserPasswordChange() {
  const userId = val('cp-user-id');
  const new_password = val('cp-new-password');

  if (!new_password || new_password.length < 4) {
    showToast('Password must be at least 4 characters long.', 'error');
    return;
  }

  setLoading('btn-save-user-password', true, 'Saving...');

  try {
    const res = await fetch(`/api/admin/users/${userId}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    closeChangePasswordModal();
    showToast(data.message || 'User password updated successfully!', 'success');
    loadAdminUsers();
  } catch (e) {
    showToast(e.message || 'Failed to update user password.', 'error');
  } finally {
    setLoading('btn-save-user-password', false, 'Save New Password');
  }
}

// ──────────────────────────────────────────────
// ADMIN — ADD N NUMBER OF ADMINS
// ──────────────────────────────────────────────
function showAddAdminModal() {
  document.getElementById('new-admin-name').value = '';
  document.getElementById('new-admin-phone').value = '';
  document.getElementById('new-admin-password').value = '';
  show('add-admin-modal');
}

function closeAddAdminModal() {
  hide('add-admin-modal');
}

async function submitNewAdmin() {
  const name = val('new-admin-name');
  const phone = val('new-admin-phone');
  const password = val('new-admin-password');

  if (!name || phone.length < 10 || password.length < 4) {
    showToast('Please provide a valid Admin Name, 10-digit Phone, and Password (min 4 chars).', 'error');
    return;
  }

  setLoading('btn-create-admin', true, 'Creating Admin...');

  try {
    const res = await fetch('/api/admin/create-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    closeAddAdminModal();
    showToast(data.message || `Admin ${name} created successfully!`, 'success');
    loadAdminUsers();
    loadAdminDashboard();
  } catch (e) {
    showToast(e.message || 'Failed to create administrator account.', 'error');
  } finally {
    setLoading('btn-create-admin', false, 'Create Administrator');
  }
}

// ──────────────────────────────────────────────
// ADMIN — PLATFORM FEATURE CONTROLS & SETTINGS
// ──────────────────────────────────────────────
async function loadPlatformSettings() {
  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      const aiInput = document.getElementById('setting-ai-scanner');
      if (aiInput) aiInput.checked = s.ai_scanner_enabled !== false;

      const scaleInput = document.getElementById('setting-scale-ocr');
      if (scaleInput) scaleInput.checked = s.scale_ocr_enabled !== false;

      const payoutInput = document.getElementById('setting-payout-preview');
      if (payoutInput) payoutInput.checked = s.instant_payout_preview !== false;

      const regInput = document.getElementById('setting-public-reg');
      if (regInput) regInput.checked = s.public_registration !== false;

      const maintInput = document.getElementById('setting-maintenance');
      if (maintInput) maintInput.checked = !!s.maintenance_mode;

      const commInput = document.getElementById('setting-commission');
      if (commInput && s.commission_percent !== undefined) {
        commInput.value = s.commission_percent;
      }
    }
  } catch (e) {
    console.warn('Could not load platform settings:', e.message);
  }
}

async function savePlatformSetting(key, value) {
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(`Platform setting "${key}" updated successfully! ⚙️`, 'success');
  } catch (e) {
    showToast(e.message || 'Failed to update platform setting.', 'error');
  }
}

async function saveMasterAdminPassword() {
  const newPass = val('setting-master-password');
  if (!newPass || newPass.length < 4) {
    showToast('New Master Admin password must be at least 4 characters long.', 'error');
    return;
  }

  setLoading('btn-save-master-pass', true, 'Saving...');

  try {
    const res = await fetch('/api/admin/change-master-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: newPass }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    document.getElementById('setting-master-password').value = '';
    showToast(data.message || 'Master Admin password updated! 👑', 'success', 6000);
  } catch (e) {
    showToast(e.message || 'Failed to update Master Admin password.', 'error');
  } finally {
    setLoading('btn-save-master-pass', false, 'Update Pass');
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
// AUTHENTICATION & ACCESS GATEWAY
// ──────────────────────────────────────────────
function switchAuthMode(mode) {
  const tabs = ['register', 'login', 'admin'];
  tabs.forEach(m => {
    document.getElementById(`auth-tab-${m}`)?.classList.toggle('active', m === mode);
    const form = document.getElementById(`form-${m === 'admin' ? 'admin-login' : m}`);
    if (form) form.classList.toggle('hidden', m !== mode);
  });

  const notice = document.getElementById('auth-alert-text');
  if (notice) {
    if (mode === 'register') {
      notice.textContent = 'New users must first register to gain access to the recycling platform.';
    } else if (mode === 'login') {
      notice.textContent = 'Enter your registered Name or Phone number and Password to enter.';
    } else if (mode === 'admin') {
      notice.textContent = '👑 Admin Portal: Enter the dedicated master password to manage network controls.';
    }
  }
}

async function handleRegister() {
  const name = val('reg-name');
  const phone = val('reg-phone');
  const password = val('reg-password');
  const role = val('reg-role') || 'seller';

  if (!name) {
    showToast('Please enter your full name.', 'error');
    return;
  }
  if (!phone || phone.length < 10) {
    showToast('Please enter a valid 10-digit mobile number.', 'error');
    return;
  }
  if (!password || password.length < 4) {
    showToast('Password must be at least 4 characters long.', 'error');
    return;
  }

  setLoading('btn-submit-register', true, 'Register & Enter Platform');

  try {
    const pos = await getPositionPromise().catch(() => null);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone,
        password,
        role,
        lat: pos?.coords?.latitude || null,
        lng: pos?.coords?.longitude || null,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    localStorage.setItem('recygo_user', JSON.stringify(data.user));
    localStorage.removeItem('recygo_is_admin');
    applyAuthenticatedUser(data.user, false);
    showToast(`Registration successful! Welcome to RECYGO, ${data.user.name}! 🌿`, 'success');
  } catch (e) {
    showToast(e.message || 'Registration failed.', 'error');
  } finally {
    setLoading('btn-submit-register', false, '<span>🚀 Register & Enter Platform</span>');
  }
}

async function handleLogin() {
  const credential = val('login-cred');
  const password = val('login-password');

  if (!credential) {
    showToast('Please enter your Name or Phone number.', 'error');
    return;
  }
  if (!password) {
    showToast('Please enter your password.', 'error');
    return;
  }

  setLoading('btn-submit-login', true, 'Signing In...');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const isAdmin = data.user.role === 'admin';
    localStorage.setItem('recygo_user', JSON.stringify(data.user));
    if (isAdmin) {
      localStorage.setItem('recygo_is_admin', 'true');
    } else {
      localStorage.removeItem('recygo_is_admin');
    }

    applyAuthenticatedUser(data.user, isAdmin);
    showToast(`Welcome back, ${data.user.name}! 🌿`, 'success');
  } catch (e) {
    showToast(e.message || 'Login failed.', 'error');
  } finally {
    setLoading('btn-submit-login', false, '<span>🔓 Sign In to RECYGO</span>');
  }
}

async function handleAdminLogin() {
  const password = val('admin-pass-input');

  if (!password) {
    showToast('Please enter the Admin Secret Password.', 'error');
    return;
  }

  setLoading('btn-submit-admin', true, 'Verifying...');

  try {
    const res = await fetch('/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const isPrime = data.user.role === 'prime_admin';
    localStorage.setItem('recygo_user', JSON.stringify(data.user));
    localStorage.setItem('recygo_is_admin', 'true');
    if (isPrime) localStorage.setItem('recygo_is_prime_admin', 'true');
    else localStorage.removeItem('recygo_is_prime_admin');

    applyAuthenticatedUser(data.user, true);
    switchTab('admin');
    const msg = isPrime
      ? '👑 Prime Admin Network Unlocked: Full Superuser Controls Granted!'
      : 'Admin Network Unlocked: Full Platform Control Granted 👑';
    showToast(msg, 'success');
  } catch (e) {
    showToast(e.message || 'Admin authentication failed.', 'error');
  } finally {
    setLoading('btn-submit-admin', false, '<span>👑 Unlock Admin Controls</span>');
  }
}

function quickFillAndLogin(type) {
  if (type === 'seller') {
    switchAuthMode('login');
    const cred = document.getElementById('login-cred');
    const pass = document.getElementById('login-password');
    if (cred) cred.value = 'Rajesh Kumar';
    if (pass) pass.value = 'password123';
    handleLogin();
  } else if (type === 'buyer') {
    switchAuthMode('login');
    const cred = document.getElementById('login-cred');
    const pass = document.getElementById('login-password');
    if (cred) cred.value = 'Mohammed Kabadi';
    if (pass) pass.value = 'password123';
    handleLogin();
  }
}

function handleLogout() {
  localStorage.removeItem('recygo_user');
  localStorage.removeItem('recygo_is_admin');
  localStorage.removeItem('recygo_is_prime_admin');
  STATE.currentUser = null;
  STATE.isAdmin = false;
  STATE.isPrimeAdmin = false;
  STATE.seller = null;
  STATE.buyer = null;

  hide('main-app');
  show('auth-screen');
  switchAuthMode('login');
  showToast('You have been logged out. Please sign in or register to re-enter.', 'info');
}

function applyAuthenticatedUser(user, isAdmin = false) {
  STATE.currentUser = user;
  STATE.isAdmin = !!isAdmin || user.role === 'admin' || user.role === 'prime_admin';
  STATE.isPrimeAdmin = user.role === 'prime_admin';

  // Update navbar user pill
  const nameEl = document.getElementById('nav-user-name');
  if (nameEl) {
    let roleIcon;
    if (STATE.isPrimeAdmin) roleIcon = '👑👑 Prime Admin';
    else if (user.role === 'admin' || STATE.isAdmin) roleIcon = '👑 Admin';
    else if (user.role === 'buyer') roleIcon = '🏪 Buyer';
    else roleIcon = '📦 Seller';
    nameEl.textContent = `${user.name} (${roleIcon})`;
  }

  // Update admin lock indicator in navbar
  const lockIcon = document.getElementById('admin-nav-lock');
  if (lockIcon) {
    lockIcon.textContent = STATE.isPrimeAdmin ? '👑👑' : STATE.isAdmin ? '👑' : '🔒';
    lockIcon.title = STATE.isPrimeAdmin ? 'Prime Admin Mode Active' : STATE.isAdmin ? 'Admin Mode Active' : 'Admin Password Required';
  }

  // Update admin tab label badge for prime admin
  const adminTabBtn = document.getElementById('tab-admin');
  if (adminTabBtn && STATE.isPrimeAdmin) {
    adminTabBtn.innerHTML = '<span>👑👑</span> Prime Admin';
  } else if (adminTabBtn && STATE.isAdmin) {
    adminTabBtn.innerHTML = '<span>👑</span> Admin <span id="admin-nav-lock" style="font-size:0.75rem;margin-left:2px;">👑</span>';
  }

  // Show/hide prime admin section in user directory (handled in loadAdminUsers)
  // Show the navbar quick-action buttons for ALL logged-in users
  const navInfo = document.getElementById('nav-user-info');
  if (navInfo) navInfo.style.display = 'flex';

  // Hide auth screen, reveal main application
  hide('auth-screen');
  show('main-app');

  if (user.role === 'seller') {
    STATE.seller = { id: user.id, name: user.name, phone: user.phone };
    const nameInput = document.getElementById('seller-name');
    const phoneInput = document.getElementById('seller-phone');
    if (nameInput) nameInput.value = user.name;
    if (phoneInput) phoneInput.value = user.phone;
    hide('seller-reg-card');
    show('scanner-card');
    show('listing-card');
    loadMyListings();
    getLocation();
    switchTab('seller');
  } else if (user.role === 'buyer') {
    STATE.buyer = { id: user.id, name: user.name, phone: user.phone };
    STATE.buyerLat = user.lat || 12.9700;
    STATE.buyerLng = user.lng || 77.5900;
    const nameInput = document.getElementById('buyer-name');
    const phoneInput = document.getElementById('buyer-phone');
    if (nameInput) nameInput.value = user.name;
    if (phoneInput) phoneInput.value = user.phone;
    hide('buyer-reg-card');
    show('map-controls-card');
    show('nearby-card');
    switchTab('buyer');
  } else if (user.role === 'admin' || user.role === 'prime_admin' || STATE.isAdmin) {
    switchTab('admin');
  }
}

function initAuth() {
  const savedUser = localStorage.getItem('recygo_user');
  const savedAdmin = localStorage.getItem('recygo_is_admin') === 'true';
  const savedPrime = localStorage.getItem('recygo_is_prime_admin') === 'true';

  if (savedUser) {
    try {
      const user = JSON.parse(savedUser);
      // Restore prime_admin role if saved flag exists
      if (savedPrime && user.role !== 'prime_admin') user.role = 'prime_admin';
      applyAuthenticatedUser(user, savedAdmin);
      return;
    } catch (e) {
      localStorage.removeItem('recygo_user');
    }
  }

  // Not authenticated: Show Auth Gateway
  hide('main-app');
  show('auth-screen');
  switchAuthMode('register');
}

// ──────────────────────────────────────────────
// ADMIN PASSWORD MODAL
// ──────────────────────────────────────────────
function closeAdminPasswordModal() {
  hide('admin-password-modal');
}

async function verifyAdminPasswordFromModal() {
  const password = val('modal-admin-password');
  if (!password) {
    showToast('Please enter the Admin Secret Password.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const isPrime = data.user.role === 'prime_admin';
    STATE.isAdmin = true;
    STATE.isPrimeAdmin = isPrime;
    if (isPrime) {
      STATE.currentUser = data.user;
      localStorage.setItem('recygo_user', JSON.stringify(data.user));
      localStorage.setItem('recygo_is_prime_admin', 'true');
    }
    localStorage.setItem('recygo_is_admin', 'true');
    closeAdminPasswordModal();

    const lockIcon = document.getElementById('admin-nav-lock');
    if (lockIcon) lockIcon.textContent = isPrime ? '👑👑' : '👑';

    switchTab('admin');
    const msg = isPrime
      ? '👑👑 Prime Admin Superuser Controls Granted!'
      : 'Admin Network Unlocked: Full Platform Control Granted 👑';
    showToast(msg, 'success');
  } catch (e) {
    showToast(e.message || 'Incorrect admin password.', 'error');
  }
}

// ──────────────────────────────────────────────
// HELP & SUPPORT CENTER
// ──────────────────────────────────────────────
function openHelpModal(subtab = 'guide') {
  show('help-modal');

  // Autofill report form name and phone for any logged-in role (seller, buyer, admin)
  const user = STATE.currentUser;
  if (user) {
    const rName = document.getElementById('report-name');
    const rPhone = document.getElementById('report-phone');
    if (rName && !rName.value) rName.value = user.name || '';
    if (rPhone && !rPhone.value) rPhone.value = user.phone || '';
  }

  switchHelpTab(subtab);
}

function closeHelpModal() {
  hide('help-modal');
}

function switchHelpTab(tab) {
  ['guide', 'contacts', 'report', 'rules'].forEach(t => {
    document.getElementById(`help-tab-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`help-pane-${t}`)?.classList.toggle('hidden', t !== tab);
  });
}

async function submitProblemReport() {
  const name = val('report-name');
  const phone = val('report-phone');
  const issue_type = val('report-category');
  const order_id = val('report-order-id');
  const description = val('report-description');

  if (!name || phone.length < 10 || !description) {
    showToast('Please fill in your name, 10-digit phone, and problem description.', 'error');
    return;
  }

  setLoading('btn-submit-report', true, 'Submitting...');

  try {
    const res = await fetch('/api/auth/report-problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, issue_type, order_id, description }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const successBox = document.getElementById('report-success-box');
    if (successBox) {
      show('report-success-box');
      setText('report-ticket-title', `Support Ticket #${data.ticket_number} Created!`);
      setText('report-ticket-msg', `Our administration and dispute resolution desk will review this and call ${phone} within 2 hours.`);
    }

    document.getElementById('report-description').value = '';
    document.getElementById('report-order-id').value = '';

    showToast(`Problem reported! Support Ticket #${data.ticket_number} logged with Admin.`, 'success', 6000);

    if (STATE.isAdmin) {
      loadAdminReports();
    }
  } catch (e) {
    showToast(e.message || 'Failed to submit problem report.', 'error');
  } finally {
    setLoading('btn-submit-report', false, '<span>🚀 Submit Problem Report to Admin</span>');
  }
}

// ──────────────────────────────────────────────
// ADMIN — PROBLEM REPORTS TABLE
// ──────────────────────────────────────────────
async function loadAdminReports() {
  const tbody = document.getElementById('admin-reports-table-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;">Fetching problem reports & disputes...</td></tr>`;

  try {
    const res = await fetch('/api/admin/reports');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const reports = data.reports || [];
    const badge = document.getElementById('admin-reports-count-badge');
    const pendingCount = reports.filter(r => r.status === 'Open').length;
    if (badge) badge.textContent = pendingCount;

    if (!reports.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted);">No problem reports filed yet. All platform operations normal! ✨</td></tr>`;
      return;
    }

    tbody.innerHTML = reports.map(r => `
      <tr>
        <td><strong>#${r.ticket_number || r.id}</strong></td>
        <td>
          <div style="font-weight:600;">${r.name}</div>
          <a href="tel:${r.phone}" style="font-size:0.75rem;color:var(--green-400);text-decoration:none;">📞 ${r.phone}</a>
        </td>
        <td><span class="admin-badge ${r.status === 'Open' ? 'seller' : 'buyer'}">${r.issue_type}</span></td>
        <td>${r.order_id ? `<span style="font-family:monospace;color:var(--amber-400);">Order #${r.order_id}</span>` : '—'}</td>
        <td style="max-width:240px;font-size:0.8rem;color:var(--text-secondary);">${r.description}</td>
        <td style="font-size:0.75rem;color:var(--text-muted);">${new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        <td>
          <span class="status-pill ${r.status === 'Open' ? 'open' : 'resolved'}">${r.status}</span>
        </td>
        <td>
          <div class="action-btn-group">
            ${r.status === 'Open' ? `
              <button class="btn-action success" onclick="resolveAdminReport(${r.id}, 'Resolved')" title="Mark as Resolved">
                ✓ Resolve
              </button>
            ` : `
              <button class="btn-action" onclick="resolveAdminReport(${r.id}, 'Open')" title="Reopen Ticket">
                ↻ Reopen
              </button>
            `}
            <a href="tel:${r.phone}" class="btn-action" title="Call User Directly">📞 Call</a>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red-400);text-align:center;">Failed to load reports: ${e.message}</td></tr>`;
  }
}

async function resolveAdminReport(id, newStatus = 'Resolved') {
  try {
    const res = await fetch(`/api/admin/reports/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(data.message || `Report status updated to ${newStatus}`, 'success');
    loadAdminReports();
    loadAdminDashboard();
  } catch (e) {
    showToast(e.message || 'Status update failed', 'error');
  }
}

// ──────────────────────────────────────────────
// SELF-SERVICE CHANGE PASSWORD (SELLER / BUYER / ADMIN)
// ──────────────────────────────────────────────
function openChangeMyPasswordModal() {
  const isUserLoggedIn = !!STATE.currentUser;
  const titleEl = document.getElementById('cmp-modal-title');
  const instruction = document.getElementById('cmp-instruction');

  if (isUserLoggedIn) {
    if (titleEl) titleEl.textContent = 'Change Account Password';
    const roleTitle = STATE.currentUser.role === 'admin' ? '👑 Admin' : STATE.currentUser.role === 'buyer' ? '🏪 Buyer' : '📦 Seller';
    if (instruction) instruction.innerHTML = `Updating credentials for <strong id="cmp-user-label" style="color:var(--green-400);">${STATE.currentUser.name} (${roleTitle})</strong>.`;
    hide('cmp-cred-group');
    show('cmp-old-pass-group');
  } else {
    if (titleEl) titleEl.textContent = 'Reset / Recover Password';
    if (instruction) instruction.innerHTML = `Enter your registered Name or 10-digit Phone Number to set a new password.`;
    show('cmp-cred-group');
    hide('cmp-old-pass-group');
  }

  const credInput = document.getElementById('cmp-cred');
  if (credInput) {
    const loginCred = val('login-cred');
    if (loginCred) credInput.value = loginCred;
  }

  const oldPass = document.getElementById('cmp-old-password');
  if (oldPass) oldPass.value = '';
  document.getElementById('cmp-new-password').value = '';
  document.getElementById('cmp-confirm-password').value = '';
  show('change-my-password-modal');
}

function closeChangeMyPasswordModal() {
  hide('change-my-password-modal');
}

async function submitChangeMyPassword() {
  const isUserLoggedIn = !!STATE.currentUser;
  const new_pass = val('cmp-new-password');
  const confirm_pass = val('cmp-confirm-password');

  if (!new_pass || new_pass.length < 4) {
    showToast('New password must be at least 4 characters long.', 'error');
    return;
  }
  if (new_pass !== confirm_pass) {
    showToast('New password and confirmation do not match!', 'error');
    return;
  }

  setLoading('btn-submit-cmp', true, 'Updating...');

  try {
    let res, data;
    if (isUserLoggedIn) {
      const old_pass = val('cmp-old-password');
      if (!old_pass) {
        showToast('Please enter your current password.', 'error');
        setLoading('btn-submit-cmp', false, 'Update Password');
        return;
      }
      res = await fetch('/api/auth/change-my-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: STATE.currentUser.id,
          current_password: old_pass,
          new_password: new_pass,
        }),
      });
    } else {
      const credential = val('cmp-cred');
      if (!credential) {
        showToast('Please enter your registered Name or 10-digit Phone Number.', 'error');
        setLoading('btn-submit-cmp', false, 'Update Password');
        return;
      }
      res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential,
          new_password: new_pass,
        }),
      });
    }

    data = await res.json();
    if (!data.success) throw new Error(data.error);

    closeChangeMyPasswordModal();
    showToast(data.message || 'Password updated successfully! 🔑', 'success', 6000);
  } catch (e) {
    showToast(e.message || 'Failed to update password.', 'error');
  } finally {
    setLoading('btn-submit-cmp', false, 'Update Password');
  }
}

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCategories();
  initAuth();

  // Explicit click handlers for Help & Password buttons
  document.getElementById('help-fab')?.addEventListener('click', () => openHelpModal('guide'));
  document.getElementById('rate-fab')?.addEventListener('click', () => toggleRateCard());
  document.getElementById('auth-help-btn')?.addEventListener('click', () => openHelpModal('guide'));
  document.getElementById('auth-pass-btn')?.addEventListener('click', () => openChangeMyPasswordModal());

  // Close rate modal on overlay click
  document.getElementById('rate-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('rate-modal')) toggleRateCard();
  });
  // Close add category modal on overlay click
  document.getElementById('add-category-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-category-modal')) hideAddCategoryModal();
  });
  // Close help modal on overlay click
  document.getElementById('help-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('help-modal')) closeHelpModal();
  });
  // Close admin password modal on overlay click
  document.getElementById('admin-password-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('admin-password-modal')) closeAdminPasswordModal();
  });
  // Close add admin modal on overlay click
  document.getElementById('add-admin-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-admin-modal')) closeAddAdminModal();
  });
  // Close change password modal on overlay click
  document.getElementById('change-password-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('change-password-modal')) closeChangePasswordModal();
  });
  // Close change my password modal on overlay click
  document.getElementById('change-my-password-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('change-my-password-modal')) closeChangeMyPasswordModal();
  });

  // Check URL hash for direct tab navigation e.g. #admin, #buyer
  const hash = (window.location.hash || '').replace('#', '');
  if (['seller', 'buyer', 'handover', 'admin'].includes(hash)) {
    if (STATE.currentUser) {
      switchTab(hash);
    }
  }
});

