#!/usr/bin/env node
'use strict';
/**
 * lead-scout/index.js — Warsaw nail salon lead scraper.
 *
 * Runs every hour via PM2 cron_restart.
 * Each run: picks the next (district, query, source) slot, scrapes, appends
 * new leads to CSV. Goal: 5000 unique leads with at least one contact.
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
// 8-minute hard timeout — a hung scraper must not block the hourly slot
const HARD_TIMEOUT_MS = 8 * 60 * 1000;

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

// 3 sources in rotation order (sourceIndex % 3)
const SOURCES = ['google_maps', 'booksy', 'duckduckgo'];

const CORPUS = {
  districts: DISTRICTS.length,
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
const ddg = require('./scrapers/ddg');

async function runScraper(sourceName, query, district, state) {
  switch (sourceName) {
    case 'google_maps':
      return googleMaps.scrape(query, district);
    case 'booksy':
      // Page hint derived from sourceIndex so hourly runs don't repeat page 1.
      return booksy.scrape(query, district, { pageHint: Math.floor(state.sourceIndex / 3) + 1 });
    case 'duckduckgo':
      return ddg.scrape(query, district);
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
  const district = DISTRICTS[slot.districtIndex];
  const query = QUERY_TEMPLATES[slot.queryIndex](district);
  const sourceName = SOURCES[slot.sourceOrdinal];

  logger.log(`🔍 Run #${state.runsCompleted + 1}: district=${district}, query="${query}", source=${sourceName}${state.failStreak ? ` (retry ${state.failStreak}/${rotation.MAX_FAILS})` : ''}`);

  let added = 0;
  let scraperError = null;
  let forcedAdvance = false;

  try {
    const scraped = await runScraper(sourceName, query, district, state);
    logger.log(`  Scraper returned ${scraped.length} raw results`);

    for (const lead of scraped) {
      if (storage.appendLead(lead)) added++;
    }
    logger.log(`  +${added} new unique leads (${storage.getTotal()} total)`);

    state = rotation.advanceOnSuccess(state, CORPUS);
    if (state.queryIndex === 0 && state.sourceIndex % CORPUS.sources === 0) {
      logger.log(`  → district pointer now: ${DISTRICTS[state.districtIndex]}`);
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
      `📍 ${district} / ${sourceName}`,
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

module.exports = { main, DISTRICTS, QUERY_TEMPLATES, SOURCES, CORPUS };
