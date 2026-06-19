#!/usr/bin/env node
'use strict';
/**
 * crons/seo-geo/index.js — weekly SEO + GEO keyword research (Mon 04:00).
 *
 * Deterministic collectors gather signals from the open web (Google Autocomplete,
 * Search Console, Google Trends, Bing SERP/PAA); Claude clusters/prioritizes and
 * writes the GEO plan. Every collector degrades silently — a single source going
 * down never sinks the run. Output: a big markdown report + CSV in
 * reports/seo-geo/ (server-only — public repo) plus a Telegram digest with the
 * .md attached. Scope is research-only: it never edits the site.
 */
const fs = require('fs');
const path = require('path');
const { BASE_DIR } = require('../../lib/log');
// dotenv is a server-only dependency; guard so the module is requireable in tests.
try { require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true }); } catch { /* no .env / no dotenv in test env */ }

const { runCron } = require('../../lib/runner');
const { createTg } = require('../../lib/tg');
const { buildSeeds, GEO_PROMPTS } = require('./taxonomy');
const { mergeKeywords, keywordKey } = require('./dedup');
const { collectAutocomplete } = require('./collectors/autocomplete');
const { buildGsc, collectGsc } = require('./collectors/gsc');
const { fetchTrends } = require('./collectors/trends');
const { fetchSerp } = require('./collectors/serp');
const { prioritize, analyzeWithClaude, heuristicClusters } = require('./analyze');
const { writeReport, buildDigest } = require('./report');

const REPORT_DIR = path.join(BASE_DIR, 'reports', 'seo-geo');
const STATE_FILE = path.join(BASE_DIR, 'marketing', 'seo-geo-state.json');
const LOCK_TTL_MS = 90 * 60 * 1000; // a deep pass can run 20–40 min

function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { lastRun: null, seen: [] }; } }
function writeState(state) {
  try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch { /* non-fatal — losing deltas must not fail the run */ }
}

/** Run each collector in isolation — a thrown collector degrades, never sinks the rest. */
async function runCollectors(tasks, logger) {
  const results = {};
  const failures = [];
  for (const t of tasks) {
    try {
      results[t.name] = await t.run();
      const n = Array.isArray(results[t.name]) ? `${results[t.name].length} items` : 'ok';
      logger?.log?.(`collector ${t.name}: ${n}`);
    } catch (e) { failures.push(t.name); logger?.log?.(`collector ${t.name} FAILED (degrade): ${e.message}`); }
  }
  return { results, failures };
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }

async function main(logger, deps = {}) {
  const today = deps.today || new Date();
  const date = fmtDate(today);
  const tg = deps.tg || createTg();
  const seeds = deps.seeds || buildSeeds();
  const trendSeeds = deps.trendSeeds || ['paznokcie', 'manicure hybrydowy', 'booksy', 'salon paznokci'];
  logger.log(`seeds=${seeds.length} report=${REPORT_DIR}`);

  const gsc = deps.gsc !== undefined ? deps.gsc : buildGsc();
  const { results, failures } = await runCollectors([
    { name: 'autocomplete', run: () => collectAutocomplete(seeds, { logger }) },
    { name: 'gsc', run: () => collectGsc({ gsc, today, logger }) },
    { name: 'trends', run: () => fetchTrends(trendSeeds, { logger }) },
    { name: 'serp', run: () => fetchSerp(seeds.filter((s) => s.lang === 'pl').slice(0, 8).map((s) => s.seed), { logger }) },
  ], logger);

  const autocomplete = results.autocomplete || [];
  const gscData = results.gsc || { configured: false, queries: [], striking: [] };
  const trends = results.trends || [];
  const serp = results.serp || [];

  // GSC queries become first-class keywords carrying their impressions/position.
  const gscKeywords = (gscData.queries || []).map((r) => ({
    keyword: r.keyword, lang: 'pl', audience: 'B2C', cluster: 'gsc', source: 'gsc',
    gscImpressions: r.impressions, gscPosition: r.position,
  }));

  let keywords = mergeKeywords(gscKeywords, autocomplete, trends, serp);
  keywords = prioritize(keywords);
  logger.log(`merged ${keywords.length} unique keywords`);

  // Analysis: Claude → clusters + GEO; degrade to deterministic clusters.
  let analysis = await analyzeWithClaude(
    { keywords, striking: gscData.striking || [], geoPrompts: GEO_PROMPTS },
    { ...(deps.ask ? { ask: deps.ask } : {}), logger },
  );
  if (!analysis) analysis = heuristicClusters(keywords);

  // Week-over-week deltas.
  const prev = deps.state || readState();
  const prevSeen = new Set(prev.seen || []);
  const nowKeys = keywords.map((k) => keywordKey(k.keyword, k.lang)).filter(Boolean);
  const stillSeen = nowKeys.filter((k) => prevSeen.has(k)).length;
  const deltas = prev.lastRun
    ? { added: nowKeys.length - stillSeen, removed: Math.max(0, (prev.seen || []).length - stillSeen), prevTotal: (prev.seen || []).length }
    : null;

  const ctx = { date, keywords, gsc: gscData, analysis, trendsCount: trends.length, failures, deltas };
  const written = deps.writeReport ? deps.writeReport(ctx) : writeReport(ctx, { dir: REPORT_DIR });
  logger.log(`report: ${written.mdPath} (${written.mdBytes} bytes) + ${written.csvPath}`);

  // Telegram digest + attach the markdown (best-effort).
  try {
    await tg.sendMessage(buildDigest(ctx), { parseMode: 'HTML' });
    if (tg.sendDocument) await tg.sendDocument(written.mdPath, { caption: `SEO/GEO ${date} · ${keywords.length} ключей` });
  } catch (e) { logger.log(`telegram digest failed: ${e.message}`); }

  writeState({ lastRun: date, seen: nowKeys });
  return { ok: true, keywords: keywords.length, failures };
}

if (require.main === module) runCron('seo-geo-research', main, { lockTtlMs: LOCK_TTL_MS });

module.exports = { main, runCollectors, readState, writeState, REPORT_DIR, STATE_FILE };
