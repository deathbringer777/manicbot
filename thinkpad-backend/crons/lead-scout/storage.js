/**
 * storage.js — Crash-safe CSV append + dedup engine.
 *
 * Dedup is delegated to dedup.js (shared with the offline base cleaner) so the
 * live scraper and the cleaner agree on what "the same business" means. Strong
 * keys: normalized phone, any url (website/booksy/maps/olx), instagram handle.
 *
 * The CSV is appended one row at a time (no buffering) — survives mid-run
 * crashes. Row<->lead mapping is header-driven: init() reads whatever header is
 * on disk, so rows written under the previous 14-column schema still map
 * correctly after olx_url was appended as the trailing column.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const dedup = require('./dedup');

const BASE_DIR = path.join(os.homedir(), 'manicbot-backend');
const RESEARCH_DIR = path.join(BASE_DIR, 'marketing', 'research');
const LEADS_FILE = path.join(RESEARCH_DIR, 'leads.csv');

// olx_url is appended LAST so the pre-existing 14-column file migrates with zero
// index shift (old rows simply lack the trailing column).
const CSV_COLUMNS = [
  'id', 'source', 'name', 'phone', 'email', 'address', 'district',
  'website', 'instagram_url', 'booksy_url', 'maps_url', 'rating',
  'reviews_count', 'added_at', 'olx_url',
];
const CSV_HEADER = CSV_COLUMNS.join(',') + '\n';

const deduper = dedup.createDeduper();
let totalLeads = 0;

// ─── CSV parsing (single-row parser, handles double-quote escaping) ───────────

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

/** Map column name → its index in the on-disk header (robust to schema drift). */
function buildIndexMap(headerLine) {
  const map = {};
  parseCsvRow(headerLine).forEach((name, idx) => { map[name.trim()] = idx; });
  return map;
}

/** Build a lead object from a parsed row using the header index map. */
function rowToLead(cols, indexMap) {
  const lead = {};
  for (const col of CSV_COLUMNS) {
    const idx = indexMap[col];
    lead[col] = idx === undefined ? '' : (cols[idx] ?? '');
  }
  return lead;
}

function esc(v) { return '"' + String(v ?? '').replace(/"/g, '""') + '"'; }

/** Serialize a lead into a CSV row string in CSV_COLUMNS order. */
function leadToRow(lead, id) {
  return CSV_COLUMNS.map((col) => {
    if (col === 'id') return esc(id);
    if (col === 'added_at') return esc(lead.added_at || new Date().toISOString());
    return esc(lead[col]);
  }).join(',');
}

// ─── Init: build dedup state from existing file ───────────────────────────────

function init() {
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });

  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(LEADS_FILE, CSV_HEADER);
    totalLeads = 0;
    return 0;
  }

  const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n');
  const header = lines[0] || CSV_COLUMNS.join(',');
  const indexMap = buildIndexMap(header);

  totalLeads = 0;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const lead = rowToLead(parseCsvRow(line), indexMap);
    deduper.add(lead);
    totalLeads++;
  }
  return totalLeads;
}

// ─── Dedup / contact gates ────────────────────────────────────────────────────

function isDuplicate(lead) { return deduper.isDuplicate(lead); }

function hasContact(lead) {
  return !!(lead.phone || lead.email || lead.website || lead.booksy_url || lead.instagram_url || lead.olx_url);
}

// ─── Append ───────────────────────────────────────────────────────────────────

function appendLead(lead) {
  if (!hasContact(lead)) return false;
  if (isDuplicate(lead)) return false;

  totalLeads++;
  // Register keys before writing so a crash mid-write doesn't replay this lead.
  deduper.add(lead);

  fs.appendFileSync(LEADS_FILE, leadToRow(lead, totalLeads) + '\n');
  return true;
}

function getTotal() { return totalLeads; }
function getLeadsFile() { return LEADS_FILE; }

module.exports = {
  init, appendLead, isDuplicate, hasContact, getTotal, getLeadsFile,
  // Pure helpers (exported for tests + the offline cleaner)
  CSV_COLUMNS, CSV_HEADER, parseCsvRow, buildIndexMap, rowToLead, leadToRow,
};
