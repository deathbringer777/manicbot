'use strict';
/**
 * bing.js — best-effort Bing web-search scraper.
 *
 * The Bing Search API was retired in 2025, so there is no official endpoint.
 * This parses the classic organic markup (li.b_algo > h2 > a + .b_caption).
 * Bing frequently serves a JS shell to server IPs, in which case the selectors
 * miss and scrape() returns [] — a 0-lead success that just advances the
 * rotation (no error, no retry storm). If a future run lands on the static
 * layout, leads flow without any code change.
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pl-PL,pl;q=0.9',
        'Cache-Control': 'no-cache',
      },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      try {
        const zlib = require('zlib');
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      } catch { /* raw */ }
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Bing timeout')); });
    req.end();
  });
}

/** Parse Bing organic results (li.b_algo). */
function parseResults(html, cheerio, district) {
  const $ = cheerio.load(html);
  const leads = [];

  $('li.b_algo').each((_, el) => {
    try {
      const $el = $(el);
      const $a = $el.find('h2 a').first();
      const name = $a.text().trim();
      if (!name) return;
      const link = $a.attr('href') || '';
      const snippet = $el.find('.b_caption p, .b_algoSlug, p').first().text().trim();
      const fullText = name + ' ' + snippet;

      const phone = extractPhone(fullText);
      const website = pickWebsite(link);
      const instagram_url = extractInstagram(snippet, link);
      if (!phone && !website && !instagram_url) return;

      leads.push({
        source: 'bing',
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
    } catch { /* per-result skip */ }
  });

  return leads;
}

async function scrape(query, district) {
  let cheerio;
  try { cheerio = require('cheerio'); } catch { return []; }
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=pl&setlang=pl`;
    const res = await get(url);
    if (res.status !== 200) return [];
    return parseResults(res.body, cheerio, district);
  } catch {
    return [];
  }
}

module.exports = { scrape, parseResults };
