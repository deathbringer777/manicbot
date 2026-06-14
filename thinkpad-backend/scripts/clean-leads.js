#!/usr/bin/env node
'use strict';
/**
 * clean-leads.js — one-off maintenance for marketing/research/leads.csv.
 *
 * Two jobs, both safe (always backs up first, writes via temp+rename):
 *   1. DEDUP (default): collapse rows that point at the same business using the
 *      shared dedup.js keys (phone / website / instagram / booksy / maps / olx).
 *      The legacy storage.js only keyed phone/booksy/maps, so website- and
 *      instagram-only duplicates accumulated — this removes them. Duplicate rows
 *      are MERGED (empty fields filled from the dup) so no contact data is lost.
 *   2. DROP:  node clean-leads.js --drops quality-drop.json
 *      Removes rows whose id is listed in the JSON (the quality-audit output),
 *      then re-dedups and renumbers.
 *
 * Output is rewritten in the current storage.js schema (15 columns, olx_url
 * last). Ids are reassigned sequentially. Prints a before/after report.
 *
 *   node scripts/clean-leads.js
 *   node scripts/clean-leads.js --drops marketing/research/quality-drop.json
 */
const fs = require('fs');
const storage = require('../crons/lead-scout/storage');
const dedup = require('../crons/lead-scout/dedup');

const LEADS_FILE = storage.getLeadsFile();
const EMPTY = (v) => v === undefined || v === null || String(v).trim() === '';

function readLeads() {
  const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n');
  const indexMap = storage.buildIndexMap(lines[0] || storage.CSV_COLUMNS.join(','));
  const leads = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    leads.push(storage.rowToLead(storage.parseCsvRow(line), indexMap));
  }
  return leads;
}

/** Fill empty fields of `into` from `from` (first-seen row wins on conflicts). */
function mergeInto(into, from) {
  for (const col of storage.CSV_COLUMNS) {
    if (col === 'id' || col === 'added_at') continue;
    if (EMPTY(into[col]) && !EMPTY(from[col])) into[col] = from[col];
  }
}

function dedupeLeads(leads) {
  const keyToIdx = new Map();
  const kept = [];
  let merged = 0;
  for (const lead of leads) {
    const keys = dedup.leadKeys(lead);
    let hit = null;
    for (const k of keys) if (keyToIdx.has(k)) { hit = keyToIdx.get(k); break; }
    if (hit === null) {
      kept.push(lead);
      const idx = kept.length - 1;
      for (const k of keys) keyToIdx.set(k, idx);
    } else {
      mergeInto(kept[hit], lead);
      for (const k of dedup.leadKeys(kept[hit])) if (!keyToIdx.has(k)) keyToIdx.set(k, hit);
      merged++;
    }
  }
  return { kept, merged };
}

function countBySource(leads) {
  const c = {};
  for (const l of leads) c[l.source || '?'] = (c[l.source || '?'] || 0) + 1;
  return c;
}

function writeLeads(leads) {
  const tmp = LEADS_FILE + '.tmp';
  let out = storage.CSV_HEADER;
  leads.forEach((lead, i) => { out += storage.leadToRow(lead, i + 1) + '\n'; });
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, LEADS_FILE);
}

function main() {
  const dropsArg = process.argv.indexOf('--drops');
  let dropIds = null;
  if (dropsArg !== -1) {
    const dropFile = process.argv[dropsArg + 1];
    const parsed = JSON.parse(fs.readFileSync(dropFile, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : (parsed.drop || parsed.ids || []);
    dropIds = new Set(list.map((x) => String(x.id ?? x)));
    console.log(`Drop-list: ${dropIds.size} ids from ${dropFile}`);
  }

  // Backup
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = LEADS_FILE.replace(/leads\.csv$/, `leads.csv.pre-clean.${stamp}`);
  fs.copyFileSync(LEADS_FILE, backup);

  let leads = readLeads();
  const before = leads.length;
  const beforeBySource = countBySource(leads);

  let dropped = 0;
  if (dropIds) {
    leads = leads.filter((l) => { const drop = dropIds.has(String(l.id)); if (drop) dropped++; return !drop; });
  }

  const { kept, merged } = dedupeLeads(leads);
  writeLeads(kept);

  console.log(`\n=== clean-leads report ===`);
  console.log(`Backup:        ${backup}`);
  console.log(`Before:        ${before}`);
  if (dropIds) console.log(`Dropped (qa):  ${dropped}`);
  console.log(`Merged dups:   ${merged}`);
  console.log(`After:         ${kept.length}`);
  console.log(`By source before: ${JSON.stringify(beforeBySource)}`);
  console.log(`By source after:  ${JSON.stringify(countBySource(kept))}`);
}

main();
