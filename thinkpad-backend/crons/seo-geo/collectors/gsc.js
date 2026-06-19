'use strict';
/**
 * collectors/gsc.js — first-party Search Console signal: the queries Google
 * already shows us for, with position/CTR/impressions. The truth layer.
 *
 * "Striking distance" = positions 5–20 with real impressions = quick wins
 * (one rank push from page-1 traffic). No-ops cleanly when no service account
 * is configured (same contract as gsc-monitor), so it ships before the
 * credential exists and goes live the moment GSC_SERVICE_ACCOUNT_JSON is set.
 */
const fs = require('fs');
const { createGsc } = require('../../../lib/gsc');
const { createGoogleAuth } = require('../../../lib/google-auth');

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DEFAULT_PROPERTY = 'sc-domain:manicbot.com';
const LAG_DAYS = 3;       // GSC finalizes data ~3 days back
const WINDOW_DAYS = 90;   // a full quarter of query history

function toRow(r) {
  return {
    keyword: (r.keys && r.keys[0]) || '',
    clicks: r.clicks || 0, impressions: r.impressions || 0,
    ctr: r.ctr || 0, position: r.position || 0,
  };
}
function strikingDistance(rows, { posLow = 5, posHigh = 20, minImpr = 10 } = {}) {
  return (rows || [])
    .filter((r) => r.position >= posLow && r.position <= posHigh && r.impressions >= minImpr)
    .sort((a, b) => b.impressions - a.impressions);
}
function topQueries(rows, n = 50) {
  return (rows || []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, n);
}

/** Service account from GSC_SERVICE_ACCOUNT_JSON (raw) or GOOGLE_APPLICATION_CREDENTIALS (path), or null. */
function loadServiceAccount(env = process.env) {
  const raw = env.GSC_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) { try { return JSON.parse(raw); } catch (e) { throw new Error(`GSC_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`); } }
  const file = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file && file.trim()) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return null;
}
/** Live GSC client, or null when unconfigured (caller treats null as "skip"). */
function buildGsc(env = process.env) {
  const sa = loadServiceAccount(env);
  if (!sa) return null;
  const property = env.GSC_PROPERTY || DEFAULT_PROPERTY;
  return createGsc({ auth: createGoogleAuth({ serviceAccountJson: sa, scope: SCOPE }), property });
}

function addDays(date, n) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d; }
function fmtDate(d) { return d.toISOString().slice(0, 10); }

async function collectGsc({ gsc, today = new Date(), rowLimit = 1000, logger } = {}) {
  if (!gsc) return { configured: false, queries: [], striking: [], pages: [] };
  const endDate = fmtDate(addDays(today, -LAG_DAYS));
  const startDate = fmtDate(addDays(today, -(LAG_DAYS + WINDOW_DAYS)));
  const qResp = await gsc.searchAnalytics({ startDate, endDate, dimensions: ['query'], rowLimit });
  const rows = (qResp?.rows || []).map(toRow);
  let pages = [];
  try {
    const pResp = await gsc.searchAnalytics({ startDate, endDate, dimensions: ['page'], rowLimit: 200 });
    pages = (pResp?.rows || []).map((r) => ({ page: (r.keys && r.keys[0]) || '', clicks: r.clicks || 0, impressions: r.impressions || 0, position: r.position || 0 }));
  } catch (e) { logger?.log?.(`gsc by-page failed: ${e.message}`); }
  return { configured: true, window: { startDate, endDate }, queries: rows, striking: strikingDistance(rows), pages };
}

module.exports = { toRow, strikingDistance, topQueries, loadServiceAccount, buildGsc, collectGsc };
