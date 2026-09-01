// Shared sidebar navigation — injected into every page for true multi-page navigation
const NAV_LINKS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/vendors", label: "Vendors", icon: "🧵" },
  { href: "/test", label: "Live Sensing", icon: "🎤" },
  { href: "/log", label: "Activity Log", icon: "📋" },
  { href: "/sap-integration", label: "SAP Integration", icon: "🔷" }
];

function renderNav() {
  const current = window.location.pathname;
  const el = document.getElementById('navbar');
  if (!el) return;
  el.innerHTML = `
    <div class="sidebar">
      <a href="/" class="brand">
        <span class="brand-mark">E</span>
        <span>EverSupply<div class="brand-sub">Resilient Supply Chain AI</div></span>
        <span class="live-dot" id="healthDot" title="AI connection status"></span>
      </a>
      <button class="navtoggle" id="navToggle" aria-label="Menu">☰ Menu</button>
      <div class="navlinks" id="navlinks">
        ${NAV_LINKS.map(l => `<a href="${l.href}" class="navlink ${current === l.href ? 'active' : ''}"><span class="nicon">${l.icon}</span>${l.label}</a>`).join('')}
        <a href="/whatsapp-setup" class="navlink wa ${current === '/whatsapp-setup' ? 'active' : ''}"><span class="nicon">💬</span>WhatsApp Setup</a>
      </div>
    </div>
  `;
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navlinks');
  if (toggle) toggle.addEventListener('click', () => links.classList.toggle('open'));
  checkHealthDot();
}

async function checkHealthDot() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const dot = document.getElementById('healthDot');
    if (dot) dot.classList.toggle('on', data.aiReady);
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', renderNav);
