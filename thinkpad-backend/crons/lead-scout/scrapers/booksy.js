/**
 * booksy.js — HTTP scraper for Booksy Poland listings (Warsaw nail salons).
 *
 * Booksy embeds rich JSON-LD (schema.org ItemList) in each listing page —
 * parsing that is far more reliable than scraping CSS classes that change often.
 *
 * New URL format (2026-06-06):
 *   https://booksy.com/pl-pl/s/paznokcie/3_warszawa?page=N
 *   (old: /pl-pl/s/pl/beauty-and-spa--manicure-pedicure/warszawa--mazowieckie--polska)
 *
 * Phone numbers are NOT available without authentication — Booksy hides them.
 * We capture: name, booksy_url, address, rating, reviews_count.
 * The booksy_url is the contact/dedup key.
 *
 * Returns: Array<Lead>
 */

const https = require('https');
const { URL } = require('url');

const BASE_URL = 'https://booksy.com/pl-pl/s/paznokcie/3_warszawa';
const MAX_PER_RUN = 20; // one full JSON-LD page

function get(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pl-PL,pl;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      timeout: 20000,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      try {
        const zlib = require('zlib');
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      } catch {}
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

/**
 * Parse JSON-LD ItemList from a Booksy listing page.
 * Returns up to MAX_PER_RUN leads.
 */
function parseJsonLd(html, district) {
  const leads = [];

  // Extract the first JSON-LD block (schema.org ItemList)
  const match = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/);
  if (!match) return leads;

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return leads;
  }

  const items = data.itemListElement || [];

  for (const entry of items.slice(0, MAX_PER_RUN)) {
    const biz = entry.item || entry;
    if (!biz.name) continue;

    const booksy_url = biz.url || biz['@id'] || null;
    const addr = biz.address || {};
    const address = [addr.streetAddress, addr.postalCode, addr.addressLocality]
      .filter(Boolean).join(', ') || null;

    const rating = biz.aggregateRating
      ? String(biz.aggregateRating.ratingValue || '').slice(0, 4)
      : null;
    const reviews_count = biz.aggregateRating
      ? String(biz.aggregateRating.reviewCount || '')
      : null;

    // booksy_url is the contact/dedup key — every Booksy salon has one
    if (!booksy_url) continue;

    leads.push({
      source: 'booksy',
      district,
      name: biz.name,
      phone: null,        // Booksy hides phones behind login
      email: null,
      address,
      website: null,
      instagram_url: null,
      booksy_url,
      maps_url: null,
      rating,
      reviews_count,
    });
  }

  return leads;
}

/**
 * Main scrape function called by the hourly orchestrator.
 * pageHint: which page to fetch (rotated by orchestrator across runs).
 */
async function scrape(query, district, { pageHint = 1 } = {}) {
  try {
    const res = await get(`${BASE_URL}?page=${pageHint}`);
    if (res.status !== 200) return [];
    return parseJsonLd(res.body, district);
  } catch {
    return [];
  }
}

module.exports = { scrape };
