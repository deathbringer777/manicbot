#!/usr/bin/env node
/**
 * lead-scout/index.js — Warsaw nail salon lead scraper.
 *
 * Runs every hour via PM2 cron_restart.
 * Each run: picks the next (district, query, source) slot, scrapes, appends new leads to CSV.
 * Goal: 5000 unique leads with at least one contact (phone/email/website/instagram).
 *
 * State persists in: ~/manicbot-backend/marketing/research/lead-scout-state.json
 * Output CSV:         ~/manicbot-backend/marketing/research/leads.csv
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_DIR = path.join(os.homedir(), 'manicbot-backend');
require('dotenv').config({ path: path.join(BASE_DIR, '.env') });

const WORKER_URL = process.env.WORKER_URL;
const NOTIFY_TOKEN = process.env.NOTIFY_TOKEN;

const RESEARCH_DIR = path.join(BASE_DIR, 'marketing', 'research');
const STATE_FILE = path.join(RESEARCH_DIR, 'lead-scout-state.json');
const LOG_FILE = path.join(BASE_DIR, 'logs', 'lead-scout.log');

const LEAD_TARGET = 5000;
// 8-minute hard timeout — PM2 will kill on cron restart, but this ensures a clean exit
const HARD_TIMEOUT_MS = 8 * 60 * 1000;
const LOCK_FILE = path.join(RESEARCH_DIR, 'lead-scout.lock');
const LOCK_MAX_AGE_MS = 10 * 60 * 1000; // 10 min — if lock is older, it's from a crashed run

// ─── Corpus ───────────────────────────────────────────────────────────────────

// 14 Warsaw districts (roughly from most nail-salon density to less)
const DISTRICTS = [
  'Mokotów', 'Śródmieście', 'Wola', 'Praga Południe', 'Praga Północ',
  'Ursynów', 'Wilanów', 'Ochota', 'Żoliborz', 'Bielany',
  'Bemowo', 'Targówek', 'Białołęka', 'Włochy',
];

// 5 query templates per district (varied to hit different business types)
const QUERY_TEMPLATES = [
  (d) => `salon manicure ${d} Warszawa`,
  (d) => `salon paznokci ${d} Warszawa`,
  (d) => `manicure pedicure ${d} Warszawa`,
  (d) => `gabinet urody ${d} Warszawa`,
  (d) => `prywatna kosmetyczka ${d} Warszawa`,
];

// 3 sources in rotation order (index % 3)
const SOURCES = ['google_maps', 'booksy', 'duckduckgo'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timestamp() { return new Date().toISOString(); }

function log(msg) {
  const line = `[${timestamp()}] ${msg}\n`;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

// ─── State ────────────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  districtIndex: 0,   // 0–13
  queryIndex: 0,      // 0–4
  sourceIndex: 0,     // ever-incrementing, mod 3 = which source
  totalLeads: 0,
  runsCompleted: 0,
  lastRunAt: null,
  createdAt: null,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) };
    }
  } catch { /* corrupt state — start fresh */ }
  return { ...DEFAULT_STATE, createdAt: timestamp() };
}

function saveState(state) {
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, lastRunAt: timestamp() }, null, 2));
}

// ─── Notify TG ────────────────────────────────────────────────────────────────

const { notifyTg } = require('./notify');

function tgNotify(text) {
  return notifyTg(WORKER_URL, NOTIFY_TOKEN, text);
}

// ─── Scrapers ─────────────────────────────────────────────────────────────────

const googleMaps = require('./scrapers/google-maps');
const booksy = require('./scrapers/booksy');
const ddg = require('./scrapers/ddg');

async function runScraper(sourceName, query, district, state) {
  switch (sourceName) {
    case 'google_maps':
      return googleMaps.scrape(query, district);
    case 'booksy':
      // Pass the Booksy page hint derived from the sourceIndex so hourly runs don't
      // always repeat page 1. Every 3rd Booksy run advances the page by 1.
      return booksy.scrape(query, district, {
        pageHint: Math.floor(state.sourceIndex / 3) + 1,
      });
    case 'duckduckgo':
      return ddg.scrape(query, district);
    default:
      return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const timer = setTimeout(() => {
    log('⏰ Hard timeout reached — exiting cleanly');
    process.exit(0);
  }, HARD_TIMEOUT_MS);
  timer.unref(); // Don't prevent natural exit

  log('=== Lead Scout run started ===');

  // ── Lock: prevent two concurrent runs (e.g. PM2 restart + manual test overlap) ──
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    const lockAge = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (lockAge < LOCK_MAX_AGE_MS) {
      log(`⚠️  Lock file exists (age: ${Math.round(lockAge / 1000)}s) — another run is in progress. Exiting.`);
      clearTimeout(timer);
      return;
    }
    log(`  Lock file is stale (age: ${Math.round(lockAge / 1000)}s) — removing and continuing`);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });
  process.on('SIGTERM', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} process.exit(0); });

  // Storage init — reads existing CSV to rebuild dedup sets
  const storage = require('./storage');
  const existingCount = storage.init();
  log(`Loaded ${existingCount} existing leads from CSV`);

  const state = loadState();

  // ── Check if goal already reached ──
  if (state.totalLeads >= LEAD_TARGET) {
    log(`🎯 Target of ${LEAD_TARGET} leads already reached (${state.totalLeads} total). Skipping run.`);
    await tgNotify(`🎯 Lead Scout: цель достигнута! ${state.totalLeads} лидов в базе.\nЧтобы продолжить — увеличь LEAD_TARGET в index.js`);
    return;
  }

  // Clamp indices (safety: if state is from a previous run with different corpus sizes)
  state.districtIndex = Math.min(state.districtIndex, DISTRICTS.length - 1);
  state.queryIndex = Math.min(state.queryIndex, QUERY_TEMPLATES.length - 1);

  const district = DISTRICTS[state.districtIndex];
  const query = QUERY_TEMPLATES[state.queryIndex](district);
  const sourceName = SOURCES[state.sourceIndex % SOURCES.length];

  log(`🔍 Run #${state.runsCompleted + 1}: district=${district}, query="${query}", source=${sourceName}`);

  let added = 0;
  let scraped = [];
  let scraperError = null;

  try {
    scraped = await runScraper(sourceName, query, district, state);
    log(`  Scraper returned ${scraped.length} raw results`);

    for (const lead of scraped) {
      const ok = storage.appendLead(lead);
      if (ok) added++;
    }

    log(`  +${added} new unique leads (${storage.getTotal()} total)`);

    // ── Advance state ONLY on success ──
    state.sourceIndex++;

    // After cycling through all 3 sources on a query, advance the query
    if (state.sourceIndex % SOURCES.length === 0) {
      state.queryIndex++;
    }

    // After all 5 queries on a district, advance the district
    if (state.queryIndex >= QUERY_TEMPLATES.length) {
      state.queryIndex = 0;
      state.districtIndex = (state.districtIndex + 1) % DISTRICTS.length;
      log(`  → Moving to next district: ${DISTRICTS[state.districtIndex]}`);
    }

    state.totalLeads = storage.getTotal();
    state.runsCompleted = (state.runsCompleted || 0) + 1;
    saveState(state);

  } catch (err) {
    scraperError = err.message;
    log(`  ❌ Scraper error: ${scraperError} (state NOT advanced — will retry next hour)`);
    // Don't advance state on error — retry the same slot next hour
  }

  // ── TG Summary ──
  const statusIcon = scraperError ? '⚠️' : (added > 0 ? '✅' : '🔄');
  const msg = [
    `${statusIcon} Lead Scout`,
    `📍 ${district} / ${sourceName}`,
    `+${added} новых лидов`,
    `📊 Всего: ${storage.getTotal()} / ${LEAD_TARGET}`,
    scraperError ? `❌ Ошибка: ${scraperError}` : null,
  ].filter(Boolean).join('\n');

  await tgNotify(msg).catch(() => {});

  log('=== Lead Scout run done ===\n');
}

run().catch((err) => {
  log(`FATAL: ${err.message}\n${err.stack}`);
  process.exit(1);
});
