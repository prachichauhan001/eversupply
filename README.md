# EverSupply — Real Working Project

A real, working Node.js project — no mock data, no fake responses:
- Real multi-page app (each page has its own URL: `/`, `/dashboard`, `/vendors`, `/test`, `/log`, `/sap-integration`, `/whatsapp-setup`)
- Real database (`data/vendors.json`) — you add your own vendors, each with their own language
- Real AI analysis — via Anthropic (Claude), or via SAP AI Core if you configure it
- Real WhatsApp webhook — via Twilio, with a live chat-style demo view
- Real multi-language support — English, Hindi, Tamil, Telugu, Gujarati, Punjabi, Bengali, Marathi, Kannada

---

## STEP 1 — Install
```bash
cd eversupply
npm install
```

## STEP 2 — Add your real keys
```bash
cp .env.example .env
```
Open `.env` and fill in:
1. **ANTHROPIC_API_KEY** — from [platform.claude.com](https://platform.claude.com)
2. **TWILIO_ACCOUNT_SID** and **TWILIO_AUTH_TOKEN** — from [twilio.com/try-twilio](https://www.twilio.com/try-twilio)
3. **SAP_AI_CORE_*** — optional; if you have an SAP BTP trial, the "SAP Integration" page inside the app has the full setup guide. Leave blank and Anthropic is used automatically.

## STEP 3 — Run the server
```bash
npm start
```
Open your browser: **http://localhost:3000**

This is a real multi-page site — every link is a real page navigation:
- `/` — Home (problem, solution, architecture)
- `/dashboard` — live resilience dashboard
- `/vendors` — add/edit/delete your vendors, choose their language
- `/test` — Live WhatsApp Sensing demo, with a real chat-bubble interface
- `/log` — activity log
- `/sap-integration` — SAP AI Core / Generative AI Hub / Ariba / BTP architecture and live connection status
- `/whatsapp-setup` — step-by-step guide to connect real WhatsApp

## STEP 4 — Add your data
On the "Vendors" page, add your real vendors — name, stage, WhatsApp number, **and their language**. The AI always replies in that language, both in the demo and over real WhatsApp.

## STEP 5 — Connect real WhatsApp
1. Twilio Console → Messaging → Try it out → Send a WhatsApp message → get a sandbox number and "join `<code>`"
2. From the vendor's real phone, send "join `<code>`" to the sandbox number (one-time)
3. Install [ngrok](https://ngrok.com), run: `ngrok http 3000`
4. Copy the `https://...ngrok-free.app` URL into Twilio Sandbox settings, field "WHEN A MESSAGE COMES IN": `https://xxxx.ngrok-free.app/webhook/whatsapp`
5. Message the sandbox number from the vendor's phone, in their language — the dashboard updates live, and a real automatic reply comes back in the same language

Full detailed guide is also inside the app on `/whatsapp-setup`.

## STEP 6 (Optional) — Connect SAP AI Core
Full step-by-step is on `/sap-integration`. Short version:
1. Create an SAP AI Core instance in your SAP BTP trial ("Extended" plan — includes Generative AI Hub)
2. Create an Orchestration deployment in AI Launchpad
3. Take the URL, client ID, client secret from the service key — put them in `.env` under `SAP_AI_CORE_*`
4. Restart the server — `/sap-integration` will show "SAP AI Core: Configured"

**Note:** SAP AI Core's orchestration request format may vary slightly by trial version — if the call fails, the system automatically falls back to Anthropic (the demo never breaks), and a warning appears in the console so you can fix the exact issue (SAP's own docs: help.sap.com/docs/sap-ai-core).

## STEP 7 (Optional) — Permanent hosting
Deploy free on [Render.com](https://render.com) or [Railway.app](https://railway.app) — you'll get a permanent URL and won't need ngrok anymore.

---

## Project Structure
```
eversupply/
├── server.js              ← backend: routes, webhook, AI provider layer (SAP + Anthropic)
├── package.json
├── .env.example             ← copy to .env, add your keys
├── data/
│   ├── vendors.json         ← real database
│   └── logs.json
└── public/
    ├── home.html            ← landing page (problem/solution/architecture)
    ├── dashboard.html
    ├── vendors.html          ← add vendors with language selection
    ├── test.html              ← live sensing demo with real WhatsApp chat UI
    ├── log.html
    ├── sap-integration.html   ← SAP architecture + live status
    ├── whatsapp-setup.html
    ├── nav.js                 ← shared sidebar navigation
    ├── app.js                 ← frontend logic
    └── style.css
```

## Important Notes
- Voice notes over real WhatsApp aren't automatically transcribed yet (no speech-to-text wired up) — only text messages are analyzed today. This is a good "roadmap" line to mention to judges.
- Never commit `.env` to GitHub — it holds your real API keys.
- The system works fully on Anthropic alone — SAP AI Core is an optional enhancement, not a requirement.
