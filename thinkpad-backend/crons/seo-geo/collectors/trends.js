'use strict';
/**
 * collectors/trends.js — Google Trends related/rising queries (free, keyless).
 *
 * Uses the same widget JSON API the Trends UI calls — no Playwright, no browser.
 * Two hops: /api/explore returns widgets (each with a token), then
 * /api/widgetdata/relatedsearches returns the ranked related + rising queries.
 *
 * Best-effort and DEGRADES SILENTLY: Trends rate-limits hard (429) and the
 * unofficial API can change shape. Any failure returns [] and logs — the report
 * is built from the other signals. A paid provider can be slotted in later
 * behind SEO_TRENDS_PROVIDER without touching callers.
 */
const { httpJson } = require('../../../lib/http');
const { langForHl } = require('../taxonomy');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// CONSENT=YES bypasses the EU consent interstitial that otherwise returns an
// HTML page instead of the widget JSON (the cron just degrades if it doesn't).
const HEADERS = { 'User-Agent': UA, Cookie: 'CONSENT=YES+cb', 'Accept-Language': 'pl-PL,pl;q=0.9' };
const EXPLORE = 'https://trends.google.com/trends/api/explore';
const WIDGETDATA = 'https://trends.google.com/trends/api/widgetdata/relatedsearches';

/** Trends responses are XSSI-guarded with a `)]}'` prefix — strip before JSON.parse. */
function stripXssi(text) { return String(text ?? '').replace(/^\)\]\}',?\s*/, ''); }

/** Parse a relatedsearches widget payload → { top, rising }. */
function parseRelatedQueries(payload) {
  let data = payload;
  if (typeof data === 'string') { try { data = JSON.parse(stripXssi(data)); } catch { return { top: [], rising: [] }; } }
  const lists = data?.default?.rankedList || [];
  const pick = (idx) => (lists[idx]?.rankedKeyword || []).map((k) => ({ query: k.query, value: k.value })).filter((x) => x.query);
  return { top: pick(0), rising: pick(1) };
}

function exploreReq(keyword, geo) {
  return JSON.stringify({ comparisonItem: [{ keyword, geo, time: 'today 12-m' }], category: 0, property: '' });
}
function bodyOf(res) { return res?.body ?? (res?.data !== undefined ? JSON.stringify(res.data) : ''); }

async function relatedWidget(keyword, { geo, hl, tz, transport }) {
  const url = `${EXPLORE}?hl=${hl}&tz=${tz}&req=${encodeURIComponent(exploreReq(keyword, geo))}&geo=${geo}`;
  const json = JSON.parse(stripXssi(bodyOf(await transport(url, { headers: HEADERS, timeoutMs: 10000 }))));
  return (json.widgets || []).find((w) => w.id === 'RELATED_QUERIES') || null;
}
async function relatedData(widget, { hl, tz, transport }) {
  const url = `${WIDGETDATA}?hl=${hl}&tz=${tz}&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`;
  return bodyOf(await transport(url, { headers: HEADERS, timeoutMs: 10000 }));
}

async function fetchTrends(seeds, { geo = 'PL', hl = 'pl', tz = -120, provider = process.env.SEO_TRENDS_PROVIDER || 'api', transport = httpJson, logger } = {}) {
  if (provider === 'off') { logger?.log?.('trends: provider=off, skipping'); return []; }
  const out = [];
  for (const seed of seeds) {
    try {
      const widget = await relatedWidget(seed, { geo, hl, tz, transport });
      if (!widget) continue;
      const { top, rising } = parseRelatedQueries(await relatedData(widget, { hl, tz, transport }));
      for (const r of rising) out.push({ keyword: r.query, lang: langForHl(hl), source: 'trends', rising: true, seed });
      for (const r of top) out.push({ keyword: r.query, lang: langForHl(hl), source: 'trends', rising: false, seed });
    } catch (e) { logger?.log?.(`trends "${seed}" degraded: ${e.message}`); }
  }
  return out;
}

module.exports = { stripXssi, parseRelatedQueries, fetchTrends };
