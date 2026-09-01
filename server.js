// ============================================================
// EverSupply — Backend Server
// Real WhatsApp webhook + real AI risk analysis (multi-language)
// + SAP AI Core adapter (with Gemini fallback) + real vendor database
// ============================================================

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio sends form-urlencoded
app.use(express.static(path.join(__dirname, 'public')));

const VENDORS_FILE = path.join(__dirname, 'data', 'vendors.json');
const LOGS_FILE = path.join(__dirname, 'data', 'logs.json');

const LANGUAGE_NAMES = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', gu: 'Gujarati',
  pa: 'Punjabi', bn: 'Bengali', mr: 'Marathi', kn: 'Kannada'
};

// ---------- SIMPLE FILE-BASED DATABASE ----------
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function getVendors() { return readJSON(VENDORS_FILE); }
function saveVendors(v) { writeJSON(VENDORS_FILE, v); }
function getLogs() { return readJSON(LOGS_FILE); }
function addLog(text, type = 'info') {
  const logs = getLogs();
  logs.unshift({ time: new Date().toISOString(), text, type });
  writeJSON(LOGS_FILE, logs.slice(0, 200));
}
function normalizePhone(p) {
  if (!p) return '';
  return p.replace('whatsapp:', '').replace(/[\s\-]/g, '').replace(/^\+/, '');
}

// ============================================================
// AI PROVIDER LAYER
// Tries SAP AI Core (Orchestration service) first if configured,
// falls back to Gemini — so the demo never breaks.
// ============================================================

let sapTokenCache = { token: null, expiresAt: 0 };

async function getSapAccessToken() {
  if (sapTokenCache.token && Date.now() < sapTokenCache.expiresAt) {
    return sapTokenCache.token;
  }
  const authUrl = process.env.SAP_AI_CORE_AUTH_URL; // e.g. https://<tenant>.authentication.<region>.hana.ondemand.com/oauth/token
  const clientId = process.env.SAP_AI_CORE_CLIENT_ID;
  const clientSecret = process.env.SAP_AI_CORE_CLIENT_SECRET;

  const res = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  if (!res.ok) throw new Error('SAP AI Core auth failed: ' + res.status);
  const data = await res.json();
  sapTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 30000 };
  return sapTokenCache.token;
}

// NOTE: SAP AI Core's Orchestration harmonized-API request/response shape can
// vary slightly by tenant/version. This is a genuine, working-pattern
// implementation based on SAP's documented OAuth + orchestration flow —
// verify the exact JSON body against your own SAP AI Core trial's docs
// (help.sap.com/docs/sap-ai-core/generative-ai/orchestration) before relying
// on it for a live demo. If it fails for any reason, we fall back automatically.
async function callSapAiCore(systemPrompt, userMessage) {
  const token = await getSapAccessToken();
  const deploymentUrl = process.env.SAP_AI_CORE_DEPLOYMENT_URL; // orchestration deployment URL from AI Launchpad
  const resourceGroup = process.env.SAP_AI_CORE_RESOURCE_GROUP || 'default';

  const res = await fetch(`${deploymentUrl}/completion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'AI-Resource-Group': resourceGroup
    },
    body: JSON.stringify({
      orchestration_config: {
        module_configurations: {
          llm_module_config: {
            model_name: process.env.SAP_AI_CORE_MODEL_NAME || 'claude-sonnet-4-6',
            model_params: { max_tokens: 300 }
          },
          templating_module_config: {
            template: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage }
            ]
          }
        }
      }
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('SAP AI Core call failed: ' + res.status + ' ' + errText);
  }
  const data = await res.json();
  // Response field path may need adjustment per your tenant's exact schema.
  const text = data?.orchestration_result?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.message?.content
    || '';
  return text;
}

async function callGemini(systemPrompt, userMessage) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY missing in .env');
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents: `${systemPrompt}\n\nVendor message:\n${userMessage}`,
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 800
    }
  });

  return response.text.trim();
}

function sapIsConfigured() {
  return !!(process.env.SAP_AI_CORE_AUTH_URL && process.env.SAP_AI_CORE_CLIENT_ID &&
            process.env.SAP_AI_CORE_CLIENT_SECRET && process.env.SAP_AI_CORE_DEPLOYMENT_URL);
}

// ---------- AI RISK ANALYSIS (real call, provider-aware, multi-language) ----------
async function analyzeMessage(message, vendorName, stage, languageCode) {
  const languageName = LANGUAGE_NAMES[languageCode] || 'English';
  const systemPrompt = `You are a supply chain risk analyzer for small, informal textile/garment vendors who report status updates over WhatsApp.
Vendor "${vendorName}" (stage: ${stage}) sent this update. Return ONLY a JSON object, no other text, no markdown fences.

JSON format:
{
  "risk_level": "low" | "medium" | "high",
  "delay_days": <number, 0-7>,
  "category": "power" | "machine" | "labor" | "weather" | "logistics" | "none",
  "reason": "<one short natural sentence in ${languageName}, explaining the analysis, max 20 words, written in ${languageName} language/script>",
  "reply_message": "<a short, friendly confirmation reply IN ${languageName}, to send back to the vendor over WhatsApp, max 25 words>"
}

Guidance: if the message clearly describes a problem (machine broken, no power, worker shortage), give medium/high risk. If it sounds normal/positive, give low risk.`;

  let rawText, provider;
  if (sapIsConfigured()) {
    try {
      rawText = await callSapAiCore(systemPrompt, message);
      provider = 'sap';
    } catch (e) {
      console.warn('SAP AI Core failed, using Gemini:', e.message);
      rawText = await callGemini(systemPrompt, message);
      provider = 'gemini';
    }
  } else {
    rawText = await callGemini(systemPrompt, message);
    provider = 'gemini';
  }

  let text = rawText.replace(/```json|```/g, '').trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    text = text.substring(jsonStart, jsonEnd + 1);
  }
  const parsed = JSON.parse(text);
  parsed._provider = provider;
  return parsed;
}

function applyAnalysisToVendor(vendor, analysis, rawMessage, source) {
  let delta = analysis.risk_level === 'low' ? 2 : analysis.risk_level === 'medium' ? -4 : -9;
  vendor.trustScore = Math.max(10, Math.min(100, (vendor.trustScore ?? vendor.initialReliability) + delta));
  vendor.history = vendor.history || [];
  vendor.history.push({ time: new Date().toISOString(), score: vendor.trustScore, riskLevel: analysis.risk_level });
  vendor.lastMessage = rawMessage;
  vendor.lastRisk = analysis.risk_level;
  vendor.lastReason = analysis.reason;
  vendor.lastDelayDays = analysis.delay_days;
  vendor.lastCategory = analysis.category;
  vendor.lastUpdated = new Date().toISOString();

  // Conversation log — powers the live WhatsApp-style chat feed in the UI.
  // Both real WhatsApp messages (source: 'whatsapp') and test messages
  // (source: 'test') get stored here, so the frontend can show both live.
  vendor.conversation = vendor.conversation || [];
  vendor.conversation.push({ direction: 'in', text: rawMessage, time: new Date().toISOString(), source });
  vendor.conversation.push({ direction: 'out', text: analysis.reply_message || 'Update received.', time: new Date().toISOString(), source });
  vendor.conversation = vendor.conversation.slice(-40); // keep last 40 messages
  return vendor;
}

// ============================================================
// PAGE ROUTES (real multi-page navigation, real URLs)
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/vendors', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vendors.html')));
app.get('/test', (req, res) => res.sendFile(path.join(__dirname, 'public', 'test.html')));
app.get('/log', (req, res) => res.sendFile(path.join(__dirname, 'public', 'log.html')));
app.get('/whatsapp-setup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'whatsapp-setup.html')));
app.get('/sap-integration', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sap-integration.html')));

// ============================================================
// API — VENDOR MANAGEMENT
// ============================================================
app.get('/api/vendors', (req, res) => res.json(getVendors()));

app.post('/api/vendors', (req, res) => {
  const { name, stage, phone, language, initialReliability, cost, deliveryDays, distanceKm, order } = req.body;
  if (!name || !stage || !phone) return res.status(400).json({ error: 'name, stage, aur phone zaroori hain' });
  const vendors = getVendors();
  const newVendor = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name, stage,
    phone: normalizePhone(phone),
    language: language || 'en',
    initialReliability: Number(initialReliability) || 75,
    trustScore: Number(initialReliability) || 75,
    cost: Number(cost) || 100,
    deliveryDays: Number(deliveryDays) || 2,
    distanceKm: Number(distanceKm) || 5,
    order: Number(order) || vendors.length + 1,
    history: [{ time: new Date().toISOString(), score: Number(initialReliability) || 75, riskLevel: 'baseline' }],
    conversation: [],
    lastMessage: null, lastRisk: null,
    createdAt: new Date().toISOString()
  };
  vendors.push(newVendor);
  saveVendors(vendors);
  addLog(`Naya vendor add hua: ${name} (${stage}), language: ${LANGUAGE_NAMES[language] || 'English'}`, 'info');
  res.json(newVendor);
});

app.put('/api/vendors/:id', (req, res) => {
  const vendors = getVendors();
  const idx = vendors.findIndex(v => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Vendor nahi mila' });
  const allowed = ['name', 'stage', 'phone', 'language', 'cost', 'deliveryDays', 'distanceKm', 'order'];
  allowed.forEach(k => { if (req.body[k] !== undefined) vendors[idx][k] = k === 'phone' ? normalizePhone(req.body[k]) : req.body[k]; });
  saveVendors(vendors);
  res.json(vendors[idx]);
});

app.delete('/api/vendors/:id', (req, res) => {
  let vendors = getVendors();
  const vendor = vendors.find(v => v.id === req.params.id);
  vendors = vendors.filter(v => v.id !== req.params.id);
  saveVendors(vendors);
  if (vendor) addLog(`Vendor delete hua: ${vendor.name}`, 'info');
  res.json({ success: true });
});

// ============================================================
// API — DASHBOARD, LOGS, CONFIG
// ============================================================
app.get('/api/dashboard', (req, res) => {
  const vendors = getVendors().sort((a, b) => a.order - b.order);
  const scores = vendors.map(v => v.trustScore ?? v.initialReliability);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const alerts = vendors.filter(v => (v.trustScore ?? v.initialReliability) < 55).length;
  res.json({ resilienceScore: avg, vendorCount: vendors.length, activeAlerts: alerts, vendors });
});

// Scores a vendor as an alternative — higher reliability, faster delivery,
// and lower cost score better. Same formula used for every stage.
function scoreVendor(v) {
  const reliability = v.trustScore ?? v.initialReliability ?? 75;
  const deliveryDays = v.deliveryDays ?? 2;
  const cost = v.cost ?? 100;
  return reliability * 0.5 + (100 - deliveryDays * 8) * 0.3 + (100 - (cost - 100)) * 0.2;
}

// For every vendor currently at high risk (trustScore < 55), find the best
// other vendor registered at the SAME stage and recommend it as a backup.
// Requires the user to have added more than one vendor for that stage.
app.get('/api/vendor-comparisons', (req, res) => {
  const vendors = getVendors();
  const comparisons = [];
  vendors.forEach(v => {
    const score = v.trustScore ?? v.initialReliability;
    if (score >= 55) return; // not at risk, no comparison needed
    const sameStageAlternatives = vendors
      .filter(o => o.id !== v.id && o.stage.trim().toLowerCase() === v.stage.trim().toLowerCase())
      .sort((a, b) => scoreVendor(b) - scoreVendor(a));
    if (sameStageAlternatives.length === 0) return; // no alternative registered for this stage
    const alt = sameStageAlternatives[0];
    comparisons.push({
      stage: v.stage,
      current: { id: v.id, name: v.name, trustScore: score, deliveryDays: v.deliveryDays, cost: v.cost, distanceKm: v.distanceKm },
      recommended: { id: alt.id, name: alt.name, trustScore: alt.trustScore ?? alt.initialReliability, deliveryDays: alt.deliveryDays, cost: alt.cost, distanceKm: alt.distanceKm },
      scoreDelta: Math.round(scoreVendor(alt) - scoreVendor(v))
    });
  });
  res.json(comparisons);
});

app.get('/api/logs', (req, res) => res.json(getLogs()));

// Flattens every vendor's conversation into one live feed, newest first —
// powers the "Recent WhatsApp Activity" panel on the Dashboard.
app.get('/api/recent-messages', (req, res) => {
  const vendors = getVendors();
  let all = [];
  vendors.forEach(v => {
    (v.conversation || []).forEach(m => {
      all.push({ vendorName: v.name, stage: v.stage, direction: m.direction, text: m.text, time: m.time, source: m.source });
    });
  });
  all.sort((a, b) => new Date(b.time) - new Date(a.time));
  res.json(all.slice(0, 15));
});

app.get('/api/config', (req, res) => {
  res.json({
    sapConfigured: sapIsConfigured(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    activeProvider: sapIsConfigured() ? 'sap' : 'gemini'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    aiReady: !!process.env.GEMINI_API_KEY || sapIsConfigured(),
    twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  });
});

// ============================================================
// API — MANUAL TEST MESSAGE
// ============================================================
app.post('/api/test-message', async (req, res) => {
  const { vendorId, message } = req.body;
  const vendors = getVendors();
  const vendor = vendors.find(v => v.id === vendorId);
  if (!vendor) return res.status(404).json({ error: 'Vendor nahi mila' });

  try {
    const analysis = await analyzeMessage(message, vendor.name, vendor.stage, vendor.language);
    applyAnalysisToVendor(vendor, analysis, message, 'test');
    saveVendors(vendors);
    addLog(`[TEST] ${vendor.name} (${vendor.stage}, ${LANGUAGE_NAMES[vendor.language] || 'English'}): "${message}" → Risk: ${analysis.risk_level.toUpperCase()}`, analysis.risk_level);
    res.json({ vendor, analysis, aiProvider: analysis._provider });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'AI analysis fail hua: ' + e.message });
  }
});

// ============================================================
// REAL WHATSAPP WEBHOOK
// ============================================================
app.post('/webhook/whatsapp', async (req, res) => {
  const from = normalizePhone(req.body.From);
  const body = (req.body.Body || '').trim();
  const numMedia = parseInt(req.body.NumMedia || '0', 10);
  const twiml = new twilio.twiml.MessagingResponse();

  const vendors = getVendors();
  const vendor = vendors.find(v => v.phone === from);

  if (!vendor) {
    addLog(`Unknown number se message aaya: ${from}`, 'warning');
    twiml.message('This number is not registered with EverSupply. Please contact the company.');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  if (numMedia > 0 && !body) {
    addLog(`${vendor.name}: voice/media message aaya (transcription abhi setup nahi hai)`, 'warning');
    twiml.message('We received your voice message. (Note: this demo only analyzes text messages — production version would add voice-to-text.)');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  if (!body) {
    twiml.message('Message not understood, please resend as text.');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  try {
    const analysis = await analyzeMessage(body, vendor.name, vendor.stage, vendor.language);
    applyAnalysisToVendor(vendor, analysis, body, 'whatsapp');
    saveVendors(vendors);
    addLog(`${vendor.name} (${vendor.stage}) — WhatsApp: "${body}" → Risk: ${analysis.risk_level.toUpperCase()}, delay ~${analysis.delay_days}d [${analysis._provider}]`, analysis.risk_level);
    twiml.message(analysis.reply_message || 'Update received. Thank you.');
  } catch (e) {
    console.error(e);
    addLog(`AI analysis fail hua for ${vendor.name}: ${e.message}`, 'error');
    twiml.message('We received your message, but analysis had an issue. Our team will check.');
  }

  res.type('text/xml').send(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`EverSupply server running: http://localhost:${PORT}`);
  console.log(`WhatsApp webhook URL: /webhook/whatsapp`);
});