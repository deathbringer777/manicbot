'use strict';
/**
 * olx.js — OLX.pl classified-ads scraper for Warsaw nail masters/salons.
 *
 * OLX renders listings client-side from a JSON blob embedded as
 *   window.__PRERENDERED_STATE__ = "<json-string-literal>";
 * (the static l-card divs are empty). We parse that blob:
 *   data.listing.listing.ads[] → { title, description, url, contact, location }
 *
 * Phone numbers sit behind OLX's authenticated phone API, but masters routinely
 * paste a number into the free-text description — we regex that out. The
 * olx_url is always present and is the dedup key. Job ads (/praca/) are skipped:
 * different intent than a master advertising a service.
 *
 * Returns: Array<Lead>
 */

const https = require('https');
const { URL } = require('url');
const { extractPhone, extractInstagram } = require('./extract');

const MAX_PER_RUN = 25;

function get(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
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
    }, (res) => {
      const chunks = [];
      let stream = res;
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      try {
        const zlib = require('zlib');
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      } catch { /* fall back to raw stream */ }
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OLX timeout')); });
    req.end();
  });
}

/** Pull the ads array out of window.__PRERENDERED_STATE__. */
function parseState(html) {
  const m = html.match(/window\.__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*")/);
  if (!m) return [];
  try {
    const data = JSON.parse(JSON.parse(m[1])); // stored as a JSON string literal
    const ads = data?.listing?.listing?.ads;
    return Array.isArray(ads) ? ads : [];
  } catch {
    return [];
  }
}

// Obvious non-lead noise inside the services category: training schools and
// equipment resale are not nail businesses we can sell to.
const NOISE_RE = /szkoleni|\bkurs\b|sprzedam|zestaw|frezark|lampa\s*uv|hurtowni/i;

/** Convert one OLX ad object to our Lead shape (or null to skip). */
function adToLead(ad, district) {
  if (!ad || !ad.url) return null;
  if (/\/praca\//.test(ad.url)) return null; // job postings — different intent
  // Keep only service offers; excludes product/equipment sales (category.type=goods).
  if (ad.category && ad.category.type && ad.category.type !== 'services') return null;

  const title = ad.title || '';
  if (NOISE_RE.test(title)) return null;

  const name = (ad.contact && ad.contact.name) || ad.title;
  if (!name) return null;

  const loc = ad.location || {};
  const leadDistrict = loc.districtName || district || loc.cityName || null;
  const address = [loc.districtName, loc.cityName].filter(Boolean).join(', ') || null;

  return {
    source: 'olx',
    district: leadDistrict,
    name,
    phone: extractPhone(ad.description),
    email: null,
    address,
    website: null,
    instagram_url: extractInstagram(ad.description, null),
    booksy_url: null,
    maps_url: null,
    olx_url: ad.url,
    rating: null,
    reviews_count: null,
  };
}

async function scrape(query, district) {
  try {
    const url = `https://www.olx.pl/oferty/q-${encodeURIComponent(query).replace(/%20/g, '-')}/`;
    const res = await get(url);
    if (res.status !== 200) return [];
    return parseState(res.body)
      .slice(0, MAX_PER_RUN)
      .map((ad) => adToLead(ad, district))
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { scrape, parseState, adToLead };
