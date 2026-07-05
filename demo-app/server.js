import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4000;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const broken = url.searchParams.has('broken');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getLoginPage());
    return;
  }

  if (url.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getDashboardPage(broken));
    return;
  }

  if (url.pathname === '/consolidation') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getConsolidationPage(broken));
    return;
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { username, password } = JSON.parse(body || '{}');
      if (username === 'qa.buyer@quloi.test' && password === 'qutietestpass') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (username && password) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials. Please try again.' }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Username and password required.' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

function baseStyles() {
  return `
    :root {
      --shipped: #14B8A6;
      --pass: #67B68F;
      --navy-primary: #1D3E69;
      --page: #F2F2F2;
      --white: #FFFFFF;
      --t-primary: #333;
      --t-secondary: #616B80;
      --b-input: #E4E4E4;
      --radius: 5.88px;
      --fail: #D76666;
      --err-tint: #FFEEF2;
      --alert: #BF182C;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Poppins, sans-serif; background: var(--page); color: var(--t-primary); font-size: 14px; }
    .card { background: var(--white); border: 1px solid var(--b-input); border-radius: var(--radius); padding: 24px; max-width: 400px; margin: 80px auto; }
    input { width: 100%; padding: 10px 12px; border: 1px solid var(--b-input); border-radius: var(--radius); margin-bottom: 12px; font-family: inherit; }
    button { width: 100%; padding: 10px; background: var(--navy-primary); color: #fff; border: none; border-radius: var(--radius); cursor: pointer; font-family: inherit; font-weight: 500; }
    button:hover { opacity: 0.9; }
    .error { background: var(--err-tint); color: var(--alert); padding: 10px; border-radius: var(--radius); margin-bottom: 12px; font-size: 13px; display: none; }
    .error.show { display: block; }
    h1 { font-size: 20px; margin-bottom: 8px; color: #00192F; }
    p.sub { color: var(--t-secondary); font-size: 12px; margin-bottom: 20px; }
    .pill { display: inline-block; padding: 4px 12px; border-radius: 22px; font-size: 11px; font-weight: 600; color: #fff; }
    .nav { background: #06192F; color: #fff; padding: 12px 24px; display: flex; gap: 20px; align-items: center; }
    .nav a { color: #56E6FF; text-decoration: none; font-size: 13px; }
    .content { padding: 24px; max-width: 900px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: var(--radius); overflow: hidden; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 13px; }
    th { background: #f8f8f8; color: #616B80; font-size: 11px; text-transform: uppercase; }
    select { padding: 8px 12px; border: 1px solid var(--b-input); border-radius: var(--radius); }
    .row-disabled { opacity: 0.4; pointer-events: none; }
  `;
}

function getLoginPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quloi Demo App</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<style>${baseStyles()}</style></head><body>
<div class="card">
  <h1>Quloi Demo App</h1>
  <p class="sub">Target build for QUTIE test runs (non-prod)</p>
  <div id="error" class="error"></div>
  <input id="username" type="email" placeholder="Email" value="qa.buyer@quloi.test">
  <input id="password" type="password" placeholder="Password" value="qutietestpass">
  <button id="login-btn">Sign in</button>
</div>
<script>
document.getElementById('login-btn').onclick = async () => {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username, password}) });
  const data = await res.json();
  const err = document.getElementById('error');
  if (res.ok) { window.location.href = '/dashboard'; }
  else { err.textContent = data.error; err.classList.add('show'); }
};
</script></body></html>`;
}

function getDashboardPage(broken) {
  const shippedColor = broken ? '#19C9A0' : '#14B8A6';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dashboard — Quloi Demo</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<style>${baseStyles()}
#status-shipped { background: ${shippedColor}; }
</style></head><body>
<nav class="nav"><strong>Quloi</strong><a href="/dashboard">Dashboard</a><a href="/consolidation">Consolidation</a></nav>
<div class="content">
  <h1>Welcome, Buyer</h1>
  <p class="sub" id="welcome-msg">Your orders and bookings at a glance</p>
  <div style="margin: 20px 0; display:flex; gap:12px; align-items:center;">
    <span>Order #1042</span>
    <span class="pill" id="status-shipped">Shipped</span>
    <span class="pill" style="background:#1D406A">Booked</span>
  </div>
  <button id="create-booking" style="width:auto;padding:10px 20px;margin-bottom:20px;">Create Booking</button>
  <div id="booking-form" style="display:none;background:#fff;padding:20px;border-radius:8px;border:1px solid #E4E4E4;">
    <h3 style="margin-bottom:12px;">New Booking — Step 1</h3>
    <label style="display:block;margin-bottom:6px;font-size:12px;color:#616B80;">Destination</label>
    <input id="destination" placeholder="Enter destination" style="margin-bottom:12px;">
    <button id="next-step">Next →</button>
  </div>
  <div id="shipment-details" style="display:none;background:#fff;padding:20px;border-radius:8px;border:1px solid #E4E4E4;margin-top:12px;">
    <h3>Step 2 — Shipment Details</h3>
    <p style="margin-top:8px;font-size:13px;color:#616B80;">Weight, dimensions, and incoterms</p>
    <input placeholder="Weight (kg)" style="margin-top:12px;">
    <button id="submit-booking" style="margin-top:12px;width:auto;padding:10px 20px;">Submit Booking</button>
    <p id="booking-status" style="margin-top:12px;font-weight:600;color:#67B68F;display:none;">Auto-accepted</p>
  </div>
</div>
<script>
document.getElementById('create-booking').onclick = () => {
  document.getElementById('booking-form').style.display = 'block';
};
document.getElementById('next-step').onclick = () => {
  document.getElementById('shipment-details').style.display = 'block';
};
document.getElementById('submit-booking').onclick = () => {
  const dest = document.getElementById('destination').value.trim();
  const broken = ${broken};
  if (broken && !dest) {
    document.getElementById('booking-status').style.display = 'block';
    document.getElementById('booking-status').textContent = 'Booking created (no validation)';
    document.getElementById('booking-status').style.color = '#D76666';
    return;
  }
  if (!dest) {
    alert('Please enter a destination');
    return;
  }
  document.getElementById('booking-status').style.display = 'block';
  document.getElementById('booking-status').textContent = 'Auto-accepted';
};
</script></body></html>`;
}

function getConsolidationPage(broken) {
  const rowClass = broken ? '' : 'row-disabled';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Consolidation — Quloi Demo</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<style>${baseStyles()}
.supplier-group { margin-bottom: 16px; }
.supplier-group h4 { font-size: 13px; color: #1D3E69; margin-bottom: 8px; }
</style></head><body>
<nav class="nav"><strong>Quloi</strong><a href="/dashboard">Dashboard</a><a href="/consolidation">Consolidation</a></nav>
<div class="content">
  <h1>Consolidation</h1>
  <p class="sub">Group and filter supplier rows</p>
  <div style="margin:16px 0;">
    <label style="font-size:12px;color:#616B80;margin-right:8px;">IncoTerm filter</label>
    <select id="incoterm-filter"><option value="">All</option><option value="FOB">FOB</option><option value="CIF">CIF</option></select>
  </div>
  <div class="supplier-group"><h4>Supplier A — Acme Corp</h4>
    <table><tr><th>PO</th><th>IncoTerm</th><th>Select</th></tr>
    <tr class="row" data-incoterm="FOB"><td>PO-101</td><td>FOB</td><td><input type="checkbox"></td></tr>
    <tr class="row" data-incoterm="CIF"><td>PO-102</td><td>CIF</td><td><input type="checkbox"></td></tr>
    </table></div>
  <div class="supplier-group"><h4>Supplier B — Global Parts</h4>
    <table><tr><th>PO</th><th>IncoTerm</th><th>Select</th></tr>
    <tr class="row" data-incoterm="FOB"><td>PO-201</td><td>FOB</td><td><input type="checkbox"></td></tr>
    </table></div>
</div>
<script>
document.getElementById('incoterm-filter').onchange = function() {
  const val = this.value;
  document.querySelectorAll('.row').forEach(row => {
    const term = row.dataset.incoterm;
    if (!val || term === val) row.classList.remove('${rowClass}'.trim() || 'row-disabled');
    else if (!${broken}) row.classList.add('row-disabled');
  });
};
</script></body></html>`;
}

server.listen(PORT, () => console.log(`Quloi demo app on http://localhost:${PORT}`));
