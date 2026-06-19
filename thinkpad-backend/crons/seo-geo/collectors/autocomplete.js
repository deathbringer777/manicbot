'use strict';
/**
 * collectors/autocomplete.js — Google Autocomplete (Suggest) collector.
 *
 * Free, keyless, no scraping: the public `complete/search` endpoint returns the
 * real long-tail Google shows for a seed. This is the workhorse signal of the
 * whole cron — it is what makes the research "actual search", not generation.
 */
const { httpJson } = require('../../../lib/http');
const { hlForLang } = require('../taxonomy');

const ENDPOINT = 'https://suggestqueries.google.com/complete/search';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function buildUrl(seed, hl) {
  const u = new URL(ENDPOINT);
  u.searchParams.set('client', 'firefox'); // → clean JSON: ["seed",["s1","s2",...]]
  u.searchParams.set('hl', hl);
  u.searchParams.set('q', seed);
  return u.toString();
}

/** Parse the `["seed",["s1","s2",...],...]` (firefox client) shape → string[]. */
function parseAutocomplete(payload) {
  let data = payload;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return []; } }
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return data[1].filter((s) => typeof s === 'string' && s.trim());
}

async function fetchSuggestions(seed, hl, { transport = httpJson } = {}) {
  const res = await transport(buildUrl(seed, hl), { headers: { 'User-Agent': UA }, timeoutMs: 10000 });
  const payload = res?.data !== undefined ? res.data : res?.body;
  return parseAutocomplete(payload);
}

/** Expand every seed; `autocompleteDepth` (how many expansions) becomes a signal. */
async function collectAutocomplete(seeds, { transport = httpJson, logger } = {}) {
  const keywords = [];
  for (const s of seeds) {
    try {
      const suggestions = await fetchSuggestions(s.seed, hlForLang(s.lang), { transport });
      for (const term of suggestions) {
        keywords.push({
          keyword: term, lang: s.lang, audience: s.audience, cluster: s.cluster,
          seed: s.seed, source: 'autocomplete', autocompleteDepth: suggestions.length,
        });
      }
    } catch (e) { logger?.log?.(`autocomplete "${s.seed}" [${s.lang}] failed: ${e.message}`); }
  }
  return keywords;
}

module.exports = { buildUrl, parseAutocomplete, fetchSuggestions, collectAutocomplete };
