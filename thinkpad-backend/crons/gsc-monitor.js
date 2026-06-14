#!/usr/bin/env node
'use strict';
/**
 * Daily Google Search Console health report → Telegram.
 *
 * Replaces manually opening GSC to check "is indexing still growing?". Pulls a
 * 7-day-over-7-day Search Analytics trend, the sitemap submission status, and
 * per-URL index coverage for the priority pages, then posts one compact report
 * to the ops chat.
 *
 * Ships safe BEFORE the credential exists: with no service account configured it
 * logs and returns cleanly (no send, no alert), so it can be deployed now and
 * "go live" the moment GSC_SERVICE_ACCOUNT_JSON is dropped into .env.
 *
 * Note: "Request indexing" is NOT available via API for ordinary pages (the
 * Indexing API only covers JobPosting/BroadcastEvent), so flagged URLs are
 * surfaced for the owner to click in GSC — this report just makes that a glance.
 */
const fs = require('fs');
const path = require('path');
const { BASE_DIR } = require('../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../lib/runner');
const { createTg, escapeHtml } = require('../lib/tg');
const { createGoogleAuth } = require('../lib/google-auth');
const { createGsc } = require('../lib/gsc');

const DEFAULT_PROPERTY = 'sc-domain:manicbot.com';
const SITEMAP_URL = 'https://manicbot.com/sitemap.xml';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const LAG_DAYS = 3;   // GSC data finalizes ~3 days back; compare complete windows only
const WINDOW = 7;

// Priority pages to check index coverage for. Keep the blog slugs in sync with
// BLOG_ARTICLES in manicbot/src/utils/seo.js (the sitemap source of truth).
const BLOG_SLUGS = [
  'instagram-bookings-2026', 'tiktok-for-nail-salons', 'local-seo-nail-salon',
  'salon-reviews-reputation', 'nail-salon-pricing-guide', 'client-retention-loyalty',
  'scale-solo-to-team', 'seasonal-marketing-calendar', 'ai-beauty-trends-2026',
  'booking-conversion', 'channels-compared-2026', 'nail-clients-survey-2026',
  'ai-receptionist-247', 'dynamic-pricing-salon', 'automate-salon-booking',
  'reduce-no-shows', 'nail-trends-2026', 'whatsapp-instagram-channels',
  'google-calendar-sync', 'first-client-in-10-minutes',
];
const PRIORITY_URLS = [
  'https://manicbot.com/blog',
  'https://manicbot.com/about',
  'https://manicbot.com/pricing',
  ...BLOG_SLUGS.map((s) => `https://manicbot.com/blog/${s}`),
];

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function fmtDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Two contiguous 7-day windows ending LAG_DAYS before `today` (current vs prior). */
function dateWindows(today) {
  const curEnd = addDays(today, -LAG_DAYS);
  const curStart = addDays(curEnd, -(WINDOW - 1));
  const prevEnd = addDays(curStart, -1);
  const prevStart = addDays(prevEnd, -(WINDOW - 1));
  return {
    curStart: fmtDate(curStart), curEnd: fmtDate(curEnd),
    prevStart: fmtDate(prevStart), prevEnd: fmtDate(prevEnd),
  };
}

/** Reduce a URL Inspection result to { url, indexed, state }. */
function classifyInspection(url, result) {
  const state = result?.inspectionResult?.indexStatusResult?.coverageState || 'unknown';
  const indexed = /indexed/i.test(state) && !/not indexed/i.test(state);
  return { url, indexed, state };
}

/** The single aggregate row from a no-dimension searchAnalytics query, or zeros. */
function totalsRow(resp) {
  const r = resp && resp.rows && resp.rows[0];
  if (!r) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 };
}

function fmtNum(n) {
  const v = Math.round(n);
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
/** Trend chip for a delta where higher is better (clicks, impressions). */
function arrow(delta) {
  if (!delta) return '•';
  return `${delta > 0 ? '▲+' : '▼−'}${fmtNum(Math.abs(delta))}`;
}
/** Trend chip for average position, where LOWER is better. */
function positionArrow(delta) {
  if (!delta) return '•';
  return `${delta < 0 ? '▲−' : '▼+'}${Math.abs(delta).toFixed(1)}`;
}

function formatReport({ property, window, cur, prev, topQueries = [], sitemap, inspections = [] }) {
  const host = property.replace(/^sc-domain:/, '');
  const lines = [];
  lines.push(`📊 <b>GSC ${escapeHtml(host)}</b> · 7д (${window.curStart}…${window.curEnd})`);
  lines.push(`Клики: <b>${cur.clicks}</b> (${arrow(cur.clicks - prev.clicks)}) · Показы: <b>${fmtNum(cur.impressions)}</b> (${arrow(cur.impressions - prev.impressions)})`);
  lines.push(`CTR: <b>${(cur.ctr * 100).toFixed(1)}%</b> · Поз: <b>${cur.position.toFixed(1)}</b> (${positionArrow(cur.position - prev.position)})`);

  if (topQueries.length) {
    const q = topQueries.slice(0, 5).map((row) => `${escapeHtml((row.keys && row.keys[0]) || '?')} (${row.clicks || 0})`).join(', ');
    lines.push(`🔎 ${q}`);
  }

  if (sitemap) {
    const c = (sitemap.contents && sitemap.contents[0]) || {};
    const dl = sitemap.lastDownloaded ? sitemap.lastDownloaded.slice(0, 10) : '—';
    lines.push(`🗺 Карта сайта: ${c.submitted || '?'} URL, обновлена ${dl}, ошибок ${sitemap.errors || '0'} / предупр. ${sitemap.warnings || '0'}`);
  }

  const indexed = inspections.filter((i) => i.indexed === true).length;
  const notIndexed = inspections.filter((i) => i.indexed === false);
  const errored = inspections.filter((i) => i.indexed === null);
  lines.push(`📑 Индексация приоритетных: <b>${indexed}/${inspections.length}</b>`);
  if (notIndexed.length) {
    lines.push('⚠️ Не в индексе — запросить вручную в GSC:');
    for (const i of notIndexed) lines.push(`• ${escapeHtml(i.url)}`);
  } else if (inspections.length) {
    lines.push('✓ все приоритетные URL в индексе');
  }
  if (errored.length) lines.push(`⚠️ Не удалось проверить: ${errored.length}`);

  return lines.join('\n');
}

/** Service account from GSC_SERVICE_ACCOUNT_JSON (raw) or GOOGLE_APPLICATION_CREDENTIALS (path), or null. */
function loadServiceAccount() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    try { return JSON.parse(raw); } catch (e) { throw new Error(`GSC_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`); }
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file && file.trim()) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return null;
}

async function main(logger, deps = {}) {
  const getServiceAccount = deps.getServiceAccount || loadServiceAccount;
  const tg = deps.tg || createTg();
  const today = deps.today || new Date();
  const property = process.env.GSC_PROPERTY || DEFAULT_PROPERTY;

  const sa = getServiceAccount();
  if (!sa) {
    logger.log('GSC creds not configured (set GSC_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS) — skipping');
    return { skipped: true };
  }

  const gsc = deps.gsc || createGsc({ auth: createGoogleAuth({ serviceAccountJson: sa, scope: SCOPE }), property });
  const w = dateWindows(today);
  logger.log(`window cur ${w.curStart}…${w.curEnd} vs prev ${w.prevStart}…${w.prevEnd}`);

  // Core signal — uncaught on purpose: an auth/permission/config break must alert + exit 1.
  const curResp = await gsc.searchAnalytics({ startDate: w.curStart, endDate: w.curEnd });
  const prevResp = await gsc.searchAnalytics({ startDate: w.prevStart, endDate: w.prevEnd });

  let topResp = { rows: [] };
  try {
    topResp = await gsc.searchAnalytics({ startDate: w.curStart, endDate: w.curEnd, dimensions: ['query'], rowLimit: 5 });
  } catch (e) { logger.log(`top-queries fetch failed: ${e.message}`); }

  let sitemap = null;
  try { sitemap = await gsc.getSitemap(SITEMAP_URL); } catch (e) { logger.log(`sitemap fetch failed: ${e.message}`); }

  // Per-URL inspection is resilient: a single bad URL must not sink the report.
  const inspections = [];
  for (const url of PRIORITY_URLS) {
    try {
      inspections.push(classifyInspection(url, await gsc.inspectUrl(url)));
    } catch (e) {
      logger.log(`inspect ${url} failed: ${e.message}`);
      inspections.push({ url, indexed: null, state: 'error' });
    }
  }

  const report = formatReport({
    property, window: w,
    cur: totalsRow(curResp), prev: totalsRow(prevResp),
    topQueries: topResp?.rows || [], sitemap, inspections,
  });
  logger.log(`report ready (${report.length} chars)`);
  await tg.sendMessage(report, { parseMode: 'HTML' });
  return { ok: true, indexed: inspections.filter((i) => i.indexed === true).length, total: inspections.length };
}

if (require.main === module) runCron('gsc-monitor', main);

module.exports = { main, dateWindows, classifyInspection, totalsRow, formatReport, loadServiceAccount, PRIORITY_URLS };
