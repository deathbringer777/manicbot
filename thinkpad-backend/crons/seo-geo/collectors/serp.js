'use strict';
/**
 * collectors/serp.js — best-effort SERP signal from Bing (the project's
 * scrapable engine; Google blocks server-side requests). Pulls question-form
 * queries (People-Also-Ask style) and "related searches" — question phrasings
 * are gold for the GEO/FAQ section.
 *
 * DEGRADES SILENTLY: this is a BONUS signal, never load-bearing. Bot-blocking
 * or markup drift just yields [] and a log line; autocomplete + GSC carry the run.
 */
const { httpJson } = require('../../../lib/http');
const { langForHl } = require('../taxonomy');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** "Related searches" anchor texts from a Bing results page. */
function parseRelatedSearches(html) {
  const out = [];
  const re = /class="[^"]*b_suggestionText[^"]*"[^>]*>([^<]{3,80})</gi;
  let m;
  while ((m = re.exec(String(html || '')))) { const t = m[1].trim(); if (t) out.push(t); }
  return Array.from(new Set(out));
}
/** Question-form phrases (jak/ile/gdzie/czy/dlaczego/co to ...?) anywhere in the HTML. */
function parseQuestions(html) {
  const out = [];
  const re = />\s*((?:jak|ile|gdzie|czy|dlaczego|co to|który|która|kiedy)\b[^<>?]{4,90}\?)/gi;
  let m;
  while ((m = re.exec(String(html || '')))) out.push(m[1].trim().toLowerCase().replace(/\s+/g, ' '));
  return Array.from(new Set(out));
}

async function fetchSerp(seeds, { hl = 'pl', transport = httpJson, logger } = {}) {
  const out = [];
  for (const seed of seeds) {
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(seed)}&setlang=${hl}&cc=PL`;
      const res = await transport(url, { headers: { 'User-Agent': UA, 'Accept-Language': hl }, timeoutMs: 10000 });
      const html = res?.body ?? (res?.data !== undefined ? JSON.stringify(res.data) : '');
      for (const q of parseQuestions(html)) out.push({ keyword: q, lang: langForHl(hl), source: 'serp-paa', intent: 'question', seed });
      for (const r of parseRelatedSearches(html)) out.push({ keyword: r, lang: langForHl(hl), source: 'serp-related', seed });
    } catch (e) { logger?.log?.(`serp "${seed}" degraded: ${e.message}`); }
  }
  return out;
}

module.exports = { parseRelatedSearches, parseQuestions, fetchSerp };
