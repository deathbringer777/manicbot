/**
 * storage.js — Crash-safe CSV append + dedup engine.
 *
 * Dedup keys (in priority order):
 *   1. Normalized phone (9 PL digits, strip +48/48/spaces/dashes)
 *   2. Booksy profile URL (normalized hostname+path)
 *   3. Google Maps place URL (normalized)
 *
 * CSV is appended one row at a time (no buffering) — survives mid-run crashes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_DIR = path.join(os.homedir(), 'manicbot-backend');
const RESEARCH_DIR = path.join(BASE_DIR, 'marketing', 'research');
const LEADS_FILE = path.join(RESEARCH_DIR, 'leads.csv');

const CSV_HEADER = 'id,source,name,phone,email,address,district,website,instagram_url,booksy_url,maps_url,rating,reviews_count,added_at\n';

let phoneSet = new Set();
let urlSet = new Set();
let totalLeads = 0;

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizePhone(p) {
  if (!p) return null;
  // Remove +48 / 48 prefix, spaces, dashes, parens, dots → 9 Polish digits
  const digits = String(p)
    .replace(/[\s\-\(\)\.\+]/g, '')
    .replace(/^48/, '')
    .replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-9) : null;
}

function normalizeUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return (url.hostname + url.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return null;
  }
}

// ─── CSV parsing (simple single-row parser, handles double-quote escaping) ────

function parseCsvRow(line) {
  const result = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { val += line[i++]; }
      }
      result.push(val);
      if (line[i] === ',') i++;
    } else {
      let val = '';
      while (i < line.length && line[i] !== ',') val += line[i++];
      result.push(val);
      if (line[i] === ',') i++;
    }
  }
  return result;
}

// ─── Init: build dedup sets from existing file ────────────────────────────────

function init() {
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });

  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(LEADS_FILE, CSV_HEADER);
    totalLeads = 0;
    return 0;
  }

  const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvRow(line);
    // Columns: id(0) source(1) name(2) phone(3) email(4) address(5) district(6)
    //          website(7) instagram_url(8) booksy_url(9) maps_url(10) rating(11) reviews_count(12) added_at(13)
    const phone = cols[3];
    const booksyUrl = cols[9];
    const mapsUrl = cols[10];

    if (phone) { const n = normalizePhone(phone); if (n) phoneSet.add(n); }
    if (booksyUrl) { const n = normalizeUrl(booksyUrl); if (n) urlSet.add(n); }
    if (mapsUrl) { const n = normalizeUrl(mapsUrl); if (n) urlSet.add(n); }
    totalLeads++;
  }
  return totalLeads;
}

// ─── Dedup check ──────────────────────────────────────────────────────────────

function isDuplicate(lead) {
  if (lead.phone) { const n = normalizePhone(lead.phone); if (n && phoneSet.has(n)) return true; }
  if (lead.booksy_url) { const n = normalizeUrl(lead.booksy_url); if (n && urlSet.has(n)) return true; }
  if (lead.maps_url) { const n = normalizeUrl(lead.maps_url); if (n && urlSet.has(n)) return true; }
  return false;
}

function hasContact(lead) {
  return !!(lead.phone || lead.email || lead.website || lead.booksy_url || lead.instagram_url);
}

// ─── Append ───────────────────────────────────────────────────────────────────

function esc(v) { return '"' + String(v ?? '').replace(/"/g, '""') + '"'; }

function appendLead(lead) {
  if (!hasContact(lead)) return false;
  if (isDuplicate(lead)) return false;

  totalLeads++;

  // Update dedup sets before writing (so a crash mid-write doesn't replay)
  if (lead.phone) { const n = normalizePhone(lead.phone); if (n) phoneSet.add(n); }
  if (lead.booksy_url) { const n = normalizeUrl(lead.booksy_url); if (n) urlSet.add(n); }
  if (lead.maps_url) { const n = normalizeUrl(lead.maps_url); if (n) urlSet.add(n); }

  const row = [
    totalLeads,
    lead.source ?? '',
    lead.name ?? '',
    lead.phone ?? '',
    lead.email ?? '',
    lead.address ?? '',
    lead.district ?? '',
    lead.website ?? '',
    lead.instagram_url ?? '',
    lead.booksy_url ?? '',
    lead.maps_url ?? '',
    lead.rating ?? '',
    lead.reviews_count ?? '',
    new Date().toISOString(),
  ].map(esc).join(',');

  fs.appendFileSync(LEADS_FILE, row + '\n');
  return true;
}

function getTotal() { return totalLeads; }
function getLeadsFile() { return LEADS_FILE; }

module.exports = { init, appendLead, isDuplicate, hasContact, getTotal, getLeadsFile };
