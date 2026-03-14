#!/usr/bin/env node
/**
 * Call the migration endpoint. Requires ADMIN_KEY (same as Worker secret).
 * Usage: ADMIN_KEY=your_key npm run migrate
 * Or: npm run migrate (reads ADMIN_KEY from .dev.vars if present)
 * Or: MANICBOT_URL=https://... ADMIN_KEY=your_key npm run migrate
 */
const fs = require('fs');
const path = require('path');

function loadDevVars() {
  const file = path.join(process.cwd(), '.dev.vars');
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const devVars = loadDevVars();
const baseUrl = process.env.MANICBOT_URL || devVars.MANICBOT_URL || 'https://manicbot.vdovin-kyrylo.workers.dev';
const key = process.env.ADMIN_KEY || devVars.ADMIN_KEY;

if (!key) {
  console.error('Set ADMIN_KEY (same value as in Cloudflare Worker secrets).');
  console.error('Example: ADMIN_KEY=your_secret npm run migrate');
  console.error('Or add ADMIN_KEY=... to .dev.vars (see .dev.vars.example)');
  process.exit(1);
}

const url = `${baseUrl}/admin/migrate?key=${encodeURIComponent(key)}`;

(async () => {
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      console.error('Migration failed:', res.status, text);
      process.exit(1);
    }
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    console.log('Migration result:', JSON.stringify(body, null, 2));
  } catch (e) {
    console.error('Request error:', e.message);
    process.exit(1);
  }
})();
