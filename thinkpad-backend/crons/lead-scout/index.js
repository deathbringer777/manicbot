#!/usr/bin/env node
'use strict';
/**
 * lead-scout/index.js — Polish nail salon / solo-master lead scraper.
 *
 * Runs every 15 minutes via PM2 cron_restart.
 * Each run: picks the next (location, query, source) slot, scrapes, appends
 * new leads to CSV. Goal: 5000 unique leads with at least one contact.
 *
 * Geography: Warsaw by district + the largest Polish cities (Kraków, Wrocław,
 * Łódź, …) — Warsaw alone saturates well below the target. Sources in rotation:
 * google_maps + booksy (established salons) and olx (solo masters via classified
 * ads). Plain google + bing web search were retired from the rotation (google
 * needs a paid CSE key; bing is JS-gated — both returned 0 results every run);
 * their scraper modules are kept so a future GOOGLE_CSE_KEY can re-enable them.
 *
 * State:  ~/manicbot-backend/marketing/research/lead-scout-state.json
 * Output: ~/manicbot-backend/marketing/research/leads.csv
 *
 * Hardening (2026-06-10):
 *   - rotation/retry extracted to rotation.js: a failing slot is retried
 *     up to MAX_FAILS hours, then force-advanced (with a TG warning) so one
 *     broken source can't stall the whole rotation;
 *   - lock + FATAL alert via lib/runner;
 *   - Telegram pings only when something happened (new leads / error /
 *     forced advance) instead of 24 noise messages a day.
 */
const fs = require('fs');
const path = require('path');
const { BASE_DIR } = require('../../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../../lib/runner');
const { createTg } = require('../../lib/tg');
const rotation = require('./rotation');
const storage = require('./storage');

const RESEARCH_DIR = path.join(BASE_DIR, 'marketing', 'research');
const STATE_FILE = path.join(RESEARCH_DIR, 'lead-scout-state.json');

const LEAD_TARGET = 5000;
// 8-minute hard timeout — a hung scraper must not block the 15-minute slot
const HARD_TIMEOUT_MS = 8 * 60 * 1000;

// ─── Corpus ───────────────────────────────────────────────────────────────────

// Warsaw, split by district (highest nail-salon density in PL), roughly most → less.
const WARSAW_DISTRICTS = [
  'Mokotów', 'Śródmieście', 'Wola', 'Praga Południe', 'Praga Północ',
  'Ursynów', 'Wilanów', 'Ochota', 'Żoliborz', 'Bielany',
  'Bemowo', 'Targówek', 'Białołęka', 'Włochy',
];

// Largest Polish cities outside Warsaw, by population. All three live sources
// (google_maps, booksy, olx) return per-city results, so each city is a fresh,
// largely non-overlapping lead pool — the headroom that makes 5000 reachable
// once Warsaw saturates.
const PL_CITIES = [
  'Kraków', 'Łódź', 'Wrocław', 'Poznań', 'Gdańsk', 'Szczecin',
  'Bydgoszcz', 'Lublin', 'Białystok', 'Katowice', 'Gdynia', 'Częstochowa',
  'Radom', 'Sosnowiec', 'Toruń', 'Kielce', 'Rzeszów', 'Gliwice',
  'Olsztyn', 'Zabrze', 'Bielsko-Biała', 'Bytom', 'Tarnów', 'Opole',
];

// One flat rotation dimension. Each entry is a complete geo phrase fed verbatim
// into the query templates (Warsaw districts keep the "Warszawa" suffix; cities
// stand alone), so the templates no longer hardcode a city.
const LOCATIONS = [
  ...WARSAW_DISTRICTS.map((d) => `${d} Warszawa`),
  ...PL_CITIES,
];

// Query templates per location. Mix of salon-oriented terms (Google Maps /
// Booksy) and service/solo-master terms (OLX) so both segments — established
// salons and individual masters — are covered.
const QUERY_TEMPLATES = [
  (loc) => `salon manicure ${loc}`,
  (loc) => `salon paznokci ${loc}`,
  (loc) => `studio paznokci ${loc}`,
  (loc) => `manicure pedicure ${loc}`,
  (loc) => `manicure hybrydowy ${loc}`,
  (loc) => `paznokcie żelowe ${loc}`,
  (loc) => `przedłużanie paznokci ${loc}`,
  (loc) => `stylizacja paznokci ${loc}`,
  (loc) => `lakier hybrydowy ${loc}`,
  (loc) => `pedicure ${loc}`,
  (loc) => `gabinet kosmetyczny ${loc}`,
  (loc) => `kosmetyczka ${loc}`,
  (loc) => `nail art ${loc}`,
  (loc) => `paznokcie ${loc}`,
  (loc) => `manicure ${loc}`,
];

// Sources in rotation order (sourceIndex % SOURCES.length). google_maps + booksy
// target established salons; olx surfaces solo masters via classified ads.
// (google + bing web search retired from rotation — see header.)
const SOURCES = ['google_maps', 'booksy', 'olx'];

const CORPUS = {
  // Historical key name; now counts all geo locations (Warsaw districts + cities).
  districts: LOCATIONS.length,
  queries: QUERY_TEMPLATES.length,
  sources: SOURCES.length,
};

// ─── State ────────────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  districtIndex: 0,
  queryIndex: 0,
  sourceIndex: 0,
  totalLeads: 0,
  runsCompleted: 0,
  failStreak: 0,
  lastRunAt: null,
  createdAt: null,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) };
    }
  } catch { /* corrupt state — start fresh */ }
  return { ...DEFAULT_STATE, createdAt: new Date().toISOString() };
}

function saveState(state) {
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, lastRunAt: new Date().toISOString() }, null, 2));
}

// ─── Scrapers ─────────────────────────────────────────────────────────────────

const googleMaps = require('./scrapers/google-maps');
const booksy = require('./scrapers/booksy');
const olx = require('./scrapers/olx');
const google = require('./scrapers/google');
const bing = require('./scrapers/bing');

async function runScraper(sourceName, query, location, state) {
  switch (sourceName) {
    case 'google_maps':
      return googleMaps.scrape(query, location);
    case 'booksy':
      // Page hint walks Booksy pages across full source cycles so runs don't
      // repeat page 1 (one increment per complete pass over SOURCES).
      return booksy.scrape(query, location, { pageHint: Math.floor(state.sourceIndex / CORPUS.sources) + 1 });
    case 'olx':
      return olx.scrape(query, location);
    case 'google':
      return google.scrape(query, location);
    case 'bing':
      return bing.scrape(query, location);
    default:
      return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(logger) {
  const hardTimer = setTimeout(() => {
    logger.log('⏰ Hard timeout reached — exiting');
    process.exit(1); // runner's exit hook releases the lock
  }, HARD_TIMEOUT_MS);
  hardTimer.unref();

  const tg = createTg();
  const existingCount = storage.init();
  logger.log(`Loaded ${existingCount} existing leads from CSV`);

  let state = loadState();

  if (state.totalLeads >= LEAD_TARGET) {
    logger.log(`🎯 Target of ${LEAD_TARGET} leads reached (${state.totalLeads}). Skipping run.`);
    await tg.sendMessage(`🎯 Lead Scout: цель достигнута! ${state.totalLeads} лидов в базе.\nЧтобы продолжить — увеличь LEAD_TARGET в index.js`, { parseMode: null });
    return;
  }

  const slot = rotation.currentSlot(state, CORPUS);
  const location = LOCATIONS[slot.districtIndex];
  const query = QUERY_TEMPLATES[slot.queryIndex](location);
  const sourceName = SOURCES[slot.sourceOrdinal];

  logger.log(`🔍 Run #${state.runsCompleted + 1}: location=${location}, query="${query}", source=${sourceName}${state.failStreak ? ` (retry ${state.failStreak}/${rotation.MAX_FAILS})` : ''}`);

  let added = 0;
  let scraperError = null;
  let forcedAdvance = false;

  try {
    const scraped = await runScraper(sourceName, query, location, state);
    logger.log(`  Scraper returned ${scraped.length} raw results`);

    for (const lead of scraped) {
      if (storage.appendLead(lead)) added++;
    }
    logger.log(`  +${added} new unique leads (${storage.getTotal()} total)`);

    state = rotation.advanceOnSuccess(state, CORPUS);
    if (state.queryIndex === 0 && state.sourceIndex % CORPUS.sources === 0) {
      logger.log(`  → location pointer now: ${LOCATIONS[state.districtIndex]}`);
    }
    state.totalLeads = storage.getTotal();
    state.runsCompleted = (state.runsCompleted || 0) + 1;
  } catch (err) {
    scraperError = err.message;
    const r = rotation.onFailure(state, CORPUS);
    state = r.state;
    forcedAdvance = r.forced;
    logger.log(`  ❌ Scraper error: ${scraperError}${forcedAdvance
      ? ` — slot force-advanced after ${rotation.MAX_FAILS} failures`
      : ` (retry ${state.failStreak}/${rotation.MAX_FAILS} next hour)`}`);
  }
  saveState(state);

  // ── TG summary: only when something is worth reading ──
  if (added > 0 || scraperError) {
    const statusIcon = scraperError ? '⚠️' : '✅';
    const msg = [
      `${statusIcon} Lead Scout`,
      `📍 ${location} / ${sourceName}`,
      `+${added} новых лидов`,
      `📊 Всего: ${storage.getTotal()} / ${LEAD_TARGET}`,
      scraperError ? `❌ Ошибка: ${scraperError}` : null,
      forcedAdvance ? `⏭ Слот пропущен после ${rotation.MAX_FAILS} неудач подряд` : null,
    ].filter(Boolean).join('\n');
    await tg.sendMessage(msg, { parseMode: null }).catch(() => {});
  }
}

if (require.main === module) {
  runCron('lead-scout', main, { lockTtlMs: 10 * 60 * 1000 });
}

module.exports = { main, LOCATIONS, QUERY_TEMPLATES, SOURCES, CORPUS };
