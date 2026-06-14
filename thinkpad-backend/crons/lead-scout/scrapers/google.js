'use strict';
/**
 * google.js — Google web search via the official Custom Search JSON API.
 *
 * Raw scraping of google.com/search is JS-gated and blocked from a server IP,
 * so this uses the Programmable Search Engine API when credentials are present:
 *   GOOGLE_CSE_KEY — API key
 *   GOOGLE_CSE_CX  — search-engine id (cx)
 * Without BOTH, scrape() returns [] (a 0-lead success — the rotation simply
 * advances). Add the two env vars to start collecting; no code change needed.
 * Free tier: 100 queries/day.
 *
 * Returns: Array<Lead>
 */

const https = require('https');
const { URL } = require('url');
const { extractPhone, extractInstagram, pickWebsite } = require('./extract');

function get(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Google CSE timeout')); });
    req.end();
  });
}

/** Map Custom Search API `items` to leads. */
function parseItems(items, district) {
  const leads = [];
  for (const it of items || []) {
    const name = (it.title || '').trim();
    if (!name) continue;
    const link = it.link || '';
    const snippet = it.snippet || '';
    const fullText = name + ' ' + snippet;

    const phone = extractPhone(fullText);
    const website = pickWebsite(link);
    const instagram_url = extractInstagram(snippet, link);
    if (!phone && !website && !instagram_url) continue;

    leads.push({
      source: 'google',
      district,
      name,
      phone,
      email: null,
      address: null,
      website,
      instagram_url,
      booksy_url: null,
      maps_url: null,
      olx_url: null,
      rating: null,
      reviews_count: null,
    });
  }
  return leads;
}

async function scrape(query, district) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return []; // no token yet — graceful no-op

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}`
      + `&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}`
      + `&num=10&gl=pl&hl=pl&cr=countryPL`;
    const res = await get(url);
    if (res.status !== 200) return [];
    const data = JSON.parse(res.body);
    return parseItems(data.items, district);
  } catch {
    return [];
  }
}

module.exports = { scrape, parseItems };
