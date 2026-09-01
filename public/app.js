// ============================================================
// EverSupply — Frontend logic (multi-page, real backend calls)
// ============================================================

const LANGUAGE_NAMES = {
  en: "English", hi: "Hindi (हिंदी)", ta: "Tamil (தமிழ்)", te: "Telugu (తెలుగు)",
  gu: "Gujarati (ગુજરાતી)", pa: "Punjabi (ਪੰਜਾਬੀ)", bn: "Bengali (বাংলা)",
  mr: "Marathi (मराठी)", kn: "Kannada (ಕನ್ನಡ)"
};
const SPEECH_LANG_CODES = {
  en: "en-IN", hi: "hi-IN", ta: "ta-IN", te: "te-IN", gu: "gu-IN",
  pa: "pa-IN", bn: "bn-IN", mr: "mr-IN", kn: "kn-IN"
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
function nowTime() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ---------- DASHBOARD ----------
async function loadDashboard() {
  const res = await fetch('/api/dashboard');
  const data = await res.json();

  const scoreEl = document.getElementById('resilienceScore');
  if (!scoreEl) return;
  scoreEl.textContent = data.vendorCount ? data.resilienceScore : '—';
  document.getElementById('vendorCount').textContent = data.vendorCount;
  document.getElementById('alertCount').textContent = data.activeAlerts;
  document.getElementById('resilienceSub').textContent =
    data.vendorCount === 0 ? 'No vendors yet' :
    data.activeAlerts > 0 ? data.activeAlerts + ' vendor(s) at high risk' : 'All vendors stable';

  const journey = document.getElementById('journey');
  const journeyEmpty = document.getElementById('journeyEmpty');
  const sorted = [...data.vendors].sort((a, b) => a.order - b.order);

  if (sorted.length === 0) {
    journey.innerHTML = '';
    journeyEmpty.style.display = 'block';
  } else {
    journeyEmpty.style.display = 'none';
    journey.innerHTML = sorted.map((v, i) => {
      const score = v.trustScore ?? v.initialReliability;
      let dotClass = 'stage-dot';
      if (score < 55) dotClass += ' risk'; else if (score < 75) dotClass += ' warn';
      const connector = i > 0 ? `<div class="stage-connector ${score < 55 ? 'frayed' : ''}"></div>` : '';
      const lang = LANGUAGE_NAMES[v.language] || v.language || '';
      return `<div class="stage">${connector}<div class="${dotClass}"></div>
        <div class="stage-name">${escapeHtml(v.stage)}</div>
        <div class="stage-vendor">${escapeHtml(v.name)}</div>
        <div class="stage-lang">${escapeHtml(lang)}</div>
        <div class="stage-score">${score}</div></div>`;
    }).join('');
  }

  const trustList = document.getElementById('trustList');
  if (sorted.length === 0) {
    trustList.innerHTML = '<p class="empty-hint">No vendors yet — add one on the <a href="/vendors">Vendors page</a>.</p>';
  } else {
    trustList.innerHTML = sorted.map(v => {
      const score = v.trustScore ?? v.initialReliability;
      const color = score < 55 ? 'var(--danger)' : score < 75 ? '#B5730B' : 'var(--success)';
      return `<div class="trust-row">
        <div><div class="trust-name">${escapeHtml(v.name)}</div><div class="trust-stage-tag">${escapeHtml(v.stage)}</div></div>
        <div class="trust-score-num" style="color:${color}">${score}</div>
      </div>`;
    }).join('');
  }
}

// ---------- RECENT WHATSAPP ACTIVITY (Dashboard live feed) ----------
async function loadRecentMessages() {
  const wrap = document.getElementById('recentMessages');
  if (!wrap) return;
  const res = await fetch('/api/recent-messages');
  const messages = await res.json();
  if (messages.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">No WhatsApp activity yet — send a real message or try a test on the Live Sensing page.</p>';
    return;
  }
  wrap.innerHTML = messages.map(m => {
    const time = new Date(m.time).toLocaleString('en-IN');
    const arrow = m.direction === 'in' ? '📥' : '📤';
    const tag = m.direction === 'in' && m.source === 'whatsapp' ? '<span class="sap-badge" style="margin-left:6px; font-size:9px; padding:2px 8px;">real WhatsApp</span>' : '';
    return `<div class="log-entry"><span class="log-time">[${time}]</span><span>${arrow} <strong>${escapeHtml(m.vendorName)}</strong> (${escapeHtml(m.stage)}): ${escapeHtml(m.text)}${tag}</span></div>`;
  }).join('');
}

// ---------- ALTERNATIVE VENDOR COMPARISON ----------
async function loadComparisons() {
  const wrap = document.getElementById('comparisonWrap');
  if (!wrap) return;
  const res = await fetch('/api/vendor-comparisons');
  const comparisons = await res.json();
  if (comparisons.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">No active comparisons right now — this appears automatically when a vendor goes high-risk and another vendor exists at the same stage.</p>';
    return;
  }
  wrap.innerHTML = comparisons.map(c => `
    <table style="margin-bottom:14px;">
      <thead><tr><th colspan="2">${escapeHtml(c.stage)}</th></tr>
      <tr><th>Factor</th><th>${escapeHtml(c.current.name)}</th><th style="color:var(--success)">${escapeHtml(c.recommended.name)} (recommended)</th></tr></thead>
      <tbody>
        <tr><td>Trust Score</td><td>${c.current.trustScore}</td><td style="color:var(--success); font-weight:700;">${c.recommended.trustScore}</td></tr>
        <tr><td>Delivery Time</td><td>${c.current.deliveryDays}d</td><td>${c.recommended.deliveryDays}d</td></tr>
        <tr><td>Cost Index</td><td>${c.current.cost}</td><td>${c.recommended.cost}</td></tr>
        <tr><td>Distance</td><td>${c.current.distanceKm}km</td><td>${c.recommended.distanceKm}km</td></tr>
      </tbody>
    </table>
    <p class="empty-hint">Switching could improve reliability by ~${c.scoreDelta} points.</p>
  `).join('<hr style="border:none; border-top:1px solid var(--line); margin:16px 0;">');
}

// ---------- VENDOR MANAGEMENT ----------
function initVendorForm() {
  const form = document.getElementById('vendorForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('f-name').value.trim(),
      stage: document.getElementById('f-stage').value.trim(),
      phone: document.getElementById('f-phone').value.trim(),
      language: document.getElementById('f-language').value,
      order: document.getElementById('f-order').value,
      initialReliability: document.getElementById('f-reliability').value,
      deliveryDays: document.getElementById('f-delivery').value,
      cost: document.getElementById('f-cost').value,
      distanceKm: document.getElementById('f-distance').value
    };
    const res = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      form.reset();
      document.getElementById('f-order').value = '1';
      document.getElementById('f-reliability').value = '75';
      document.getElementById('f-delivery').value = '2';
      document.getElementById('f-cost').value = '100';
      document.getElementById('f-distance').value = '5';
      loadVendorTable();
    } else {
      const err = await res.json();
      alert('Error: ' + err.error);
    }
  });
}

async function loadVendorTable() {
  const wrap = document.getElementById('vendorTableWrap');
  if (!wrap) return;
  const res = await fetch('/api/vendors');
  const vendors = await res.json();
  if (vendors.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">No vendors added yet — use the form above.</p>';
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Stage</th><th>Phone</th><th>Language</th><th>Trust Score</th><th>Order</th><th></th></tr></thead>
    <tbody>
      ${vendors.sort((a,b)=>a.order-b.order).map(v => `
        <tr>
          <td>${escapeHtml(v.name)}</td>
          <td>${escapeHtml(v.stage)}</td>
          <td>${escapeHtml(v.phone)}</td>
          <td>${escapeHtml(LANGUAGE_NAMES[v.language] || v.language || 'English')}</td>
          <td>${v.trustScore ?? v.initialReliability}</td>
          <td>${v.order}</td>
          <td class="actions-cell"><button class="btn-small danger" onclick="deleteVendor('${v.id}')">Delete</button></td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

async function deleteVendor(id) {
  if (!confirm('Delete this vendor?')) return;
  await fetch('/api/vendors/' + id, { method: 'DELETE' });
  loadVendorTable();
}

// ---------- LIVE SENSING / WHATSAPP CHAT PAGE ----------
// This chat window shows BOTH real incoming WhatsApp messages (from the
// Twilio webhook) AND messages sent via the "Send via WhatsApp Simulation"
// button — both are stored server-side on vendor.conversation, and this
// page polls that data so real messages appear automatically, live,
// without needing any click.
let testPagePollTimer = null;
let lastRenderedCount = -1;

async function initTestPage() {
  const sel = document.getElementById('testVendorSelect');
  if (!sel) return;

  await refreshVendorSelect();
  updateWaHeader();
  renderConversationForSelected(true);

  sel.addEventListener('change', () => { updateWaHeader(); lastRenderedCount = -1; renderConversationForSelected(true); });

  document.querySelectorAll('.sample-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('testMessage').value = chip.dataset.sample;
    });
  });

  setupVoice();

  document.getElementById('testSendBtn').addEventListener('click', async () => {
    const vendorId = sel.value;
    const message = document.getElementById('testMessage').value.trim();
    if (!vendorId) { alert('Add or select a vendor first'); return; }
    if (!message) { alert('Type a message'); return; }

    document.getElementById('testMessage').value = '';
    const btn = document.getElementById('testSendBtn');
    btn.disabled = true; btn.textContent = 'Analyzing...';
    document.getElementById('testResultCard').classList.remove('show');

    const pipelinePromise = runPipelineAnimation();

    try {
      const res = await fetch('/api/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId, message })
      });
      const data = await res.json();
      await pipelinePromise;
      if (!res.ok) throw new Error(data.error);

      const badge = document.getElementById('testRiskBadge');
      badge.className = 'risk-badge risk-' + data.analysis.risk_level;
      badge.textContent = data.analysis.risk_level + ' risk';
      document.getElementById('testReason').textContent = data.analysis.reason;
      document.getElementById('testMeta').textContent =
        `Category: ${data.analysis.category} · Delay: ${data.analysis.delay_days}d · New Trust Score: ${data.vendor.trustScore} · AI Provider: ${data.aiProvider || 'anthropic'}`;
      document.getElementById('testResultCard').classList.add('show');

      lastRenderedCount = -1; // force re-render from fresh server data
      await renderConversationForSelected(false);
    } catch (e) {
      alert('Analysis failed — check that ANTHROPIC_API_KEY is set correctly in .env');
    }
    btn.disabled = false; btn.textContent = '💬 Send via WhatsApp Simulation';
  });

  // Poll every 4 seconds so a REAL incoming WhatsApp message (from the
  // Twilio webhook, sent from someone's actual phone) shows up here live,
  // even if nobody touches this page.
  if (testPagePollTimer) clearInterval(testPagePollTimer);
  testPagePollTimer = setInterval(async () => {
    await refreshVendorSelect(true);
    await renderConversationForSelected(false);
  }, 4000);
}

async function refreshVendorSelect(preserveSelection) {
  const sel = document.getElementById('testVendorSelect');
  if (!sel) return;
  const prevValue = sel.value;
  const res = await fetch('/api/vendors');
  const vendors = await res.json();
  window._esVendors = vendors; // cache for polling without extra fetches
  if (vendors.length === 0) {
    sel.innerHTML = '<option value="">Add a vendor on the Vendors page first</option>';
    return;
  }
  sel.innerHTML = vendors.map(v =>
    `<option value="${v.id}" data-lang="${v.language || 'en'}" data-name="${escapeHtml(v.name)}" data-phone="${escapeHtml(v.phone)}">${escapeHtml(v.name)} — ${escapeHtml(v.stage)} (${escapeHtml(LANGUAGE_NAMES[v.language] || 'English')})</option>`
  ).join('');
  if (preserveSelection && prevValue) sel.value = prevValue;
}

async function renderConversationForSelected(forceScroll) {
  const sel = document.getElementById('testVendorSelect');
  if (!sel || !sel.value) return;
  const res = await fetch('/api/vendors');
  const vendors = await res.json();
  window._esVendors = vendors;
  const vendor = vendors.find(v => v.id === sel.value);
  if (!vendor) return;
  const conversation = vendor.conversation || [];

  if (conversation.length === lastRenderedCount) return; // nothing new
  lastRenderedCount = conversation.length;

  const body = document.getElementById('waBody');
  if (!body) return;
  if (conversation.length === 0) {
    body.innerHTML = '<div class="wa-empty">No messages yet — send a test message, or message this vendor\'s number on real WhatsApp</div>';
    return;
  }
  body.innerHTML = conversation.map(m => {
    const time = new Date(m.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const sourceTag = m.direction === 'in' && m.source === 'whatsapp' ? ' 📲' : '';
    return `<div class="wa-bubble ${m.direction}">${escapeHtml(m.text)}${sourceTag}<span class="wa-time">${time}</span></div>`;
  }).join('');
  body.scrollTop = body.scrollHeight;
}

function updateWaHeader() {
  const sel = document.getElementById('testVendorSelect');
  const sub = document.getElementById('waHeaderSub');
  if (!sel || !sub) return;
  const opt = sel.options[sel.selectedIndex];
  sub.textContent = opt && opt.dataset.phone ? `+${opt.dataset.phone}` : 'Select a vendor to begin';
}

async function runPipelineAnimation() {
  const order = ["sense","scenario","inventory","logistics","compliance","human"];
  order.forEach(s => {
    const dot = document.querySelector(`.pipe-dot[data-step="${s}"]`);
    const label = document.querySelector(`.pipe-label[data-step="${s}"]`);
    if (dot) dot.classList.remove('active','done');
    if (label) label.classList.remove('active');
  });
  for (const s of order) {
    const dot = document.querySelector(`.pipe-dot[data-step="${s}"]`);
    const label = document.querySelector(`.pipe-label[data-step="${s}"]`);
    if (dot) dot.classList.add('active');
    if (label) label.classList.add('active');
    await new Promise(r => setTimeout(r, 380));
    if (dot) { dot.classList.remove('active'); dot.classList.add('done'); }
    if (label) label.classList.remove('active');
  }
}

// ---------- VOICE INPUT (multi-language) ----------
let recognition = null, listening = false;
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('micBtn');
  if (!micBtn) return;
  if (!SR) {
    document.getElementById('micWarning').style.display = 'block';
    micBtn.disabled = true;
    return;
  }
  recognition = new SR();
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onresult = (e) => {
    document.getElementById('testMessage').value = e.results[0][0].transcript;
  };
  recognition.onend = () => {
    listening = false; micBtn.classList.remove('listening'); micBtn.textContent = '🎤 Speak';
  };
  recognition.onerror = () => {
    listening = false; micBtn.classList.remove('listening'); micBtn.textContent = '🎤 Speak';
  };

  micBtn.addEventListener('click', () => {
    if (listening) { recognition.stop(); return; }
    const sel = document.getElementById('testVendorSelect');
    const selectedOption = sel.options[sel.selectedIndex];
    const langCode = selectedOption ? (selectedOption.dataset.lang || 'en') : 'en';
    recognition.lang = SPEECH_LANG_CODES[langCode] || 'en-IN';
    listening = true;
    micBtn.classList.add('listening');
    micBtn.textContent = '🔴 Listening (' + (LANGUAGE_NAMES[langCode] || 'English') + ')...';
    recognition.start();
  });
}

// ---------- LOGS ----------
async function loadLogs() {
  const wrap = document.getElementById('logList');
  if (!wrap) return;
  const res = await fetch('/api/logs');
  const logs = await res.json();
  if (logs.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">No activity yet.</p>';
    return;
  }
  wrap.innerHTML = logs.map(l => {
    const time = new Date(l.time).toLocaleString('en-IN');
    return `<div class="log-entry ${l.type}"><span class="log-time">[${time}]</span><span>${escapeHtml(l.text)}</span></div>`;
  }).join('');
}

// ---------- SAP STATUS ----------
async function loadSapStatus() {
  const wrap = document.getElementById('statusWrap');
  if (!wrap) return;
  const res = await fetch('/api/config');
  const data = await res.json();
  wrap.innerHTML = `
    <span class="sap-badge">AI Provider: ${data.activeProvider === 'sap' ? 'SAP AI Core' : 'Anthropic (Direct)'}</span>
    <div style="margin-top:16px; display:flex; gap:12px; flex-wrap:wrap;">
      <div class="sap-node" style="flex:1; min-width:200px;">
        <h4>SAP AI Core</h4>
        <span class="status-pill ${data.sapConfigured ? 'on' : 'off'}">${data.sapConfigured ? 'Configured' : 'Not configured'}</span>
        <p>${data.sapConfigured ? 'SAP credentials found — AI calls route through SAP AI Core Orchestration.' : 'SAP_AI_CORE_* variables not set in .env — Anthropic fallback is active.'}</p>
      </div>
      <div class="sap-node" style="flex:1; min-width:200px;">
        <h4>Anthropic (Fallback)</h4>
        <span class="status-pill ${data.anthropicConfigured ? 'on' : 'off'}">${data.anthropicConfigured ? 'Configured' : 'Not configured'}</span>
        <p>A reliable fallback path so the demo always works.</p>
      </div>
    </div>
  `;
}

// ---------- BOOT ----------
document.addEventListener('DOMContentLoaded', () => {
  initVendorForm();
});
