/**
 * ddg.js — DuckDuckGo HTML search scraper.
 *
 * Uses DuckDuckGo's plain-HTML endpoint (html.duckduckgo.com/html) which doesn't
 * require a browser or API key. Returns up to 10 organic results per query.
 *
 * From each snippet / URL we extract:
 * - Business name (from title)
 * - Phone (regex on snippet: +48 pattern or 9 consecutive digits)
 * - Website URL (from the result URL if it's not a social/directory domain)
 * - Instagram URL (if result URL or snippet contains instagram.com/...)
 * - Address fragments from snippet (free-text)
 *
 * Returns: Array<Lead>
 */

const https = require('https');
const { URL } = require('url');

// Domains we don't want as the "website" (directories, social, etc.)
const SKIP_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com', 'twitter.com', 'x.com',
  'pinterest.com', 'linkedin.com', 'google.com', 'google.pl', 'maps.google.com',
  'duckduckgo.com', 'bing.com', 'yahoo.com',
  'booksy.com', 'treatwell.pl', 'fresha.com', 'vagaro.com',
  'yelp.com', 'tripadvisor.com', 'panoramafirm.pl', 'zumi.pl', 'gowork.pl',
  'yellowpages.com', 'allegro.pl', 'olx.pl',
]);

// Phone regex: Polish formats
// +48 123 456 789 | +48123456789 | 123-456-789 | (12)345-67-89 | 9-digit local
const PHONE_RE = /(?:\+48[\s\-]?)?(?:\d[\s\-]?){8}\d/g;

function get(path, postBody = null) {
  return new Promise((resolve, reject) => {
    const isPost = postBody !== null;
    const options = {
      hostname: 'html.duckduckgo.com',
      path,
      method: isPost ? 'POST' : 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pl-PL,pl;q=0.9',
        'Cache-Control': 'no-cache',
        ...(isPost ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postBody),
        } : {}),
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
    req.on('timeout', () => { req.destroy(); reject(new Error('DDG timeout')); });
    if (isPost && postBody) req.write(postBody);
    req.end();
  });
}

function extractPhone(text) {
  if (!text) return null;
  const matches = text.match(PHONE_RE);
  if (!matches) return null;
  // Pick the first that has at least 9 digits after stripping non-digits
  for (const m of matches) {
    const digits = m.replace(/\D/g, '').replace(/^48/, '');
    if (digits.length >= 9) return '+48' + digits.slice(-9);
  }
  return null;
}

function extractInstagram(text, url) {
  if (url && url.includes('instagram.com')) return url;
  const igRe = /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/;
  const m = (text || '').match(igRe);
  return m ? m[0] : null;
}

function isDomainSkipped(url) {
  try {
    const { hostname } = new URL(url);
    return SKIP_DOMAINS.has(hostname.replace(/^www\./, ''));
  } catch {
    return true;
  }
}

function parseResults(html, cheerio, district) {
  const $ = cheerio.load(html);
  const leads = [];

  // DDG HTML result structure: .result .result__body > .result__title + .result__snippet
  // Fallback: .results_links_deep .result
  $('.result:not(.result--ad)').each((_, el) => {
    try {
      const $el = $(el);

      const title = $el.find('.result__title a, .result__a').first().text().trim();
      if (!title) return;

      const resultUrl = $el.find('.result__title a, .result__a').first().attr('href')
        || $el.find('a[href^="http"]').first().attr('href')
        || '';

      // DDG wraps outbound URLs in a redirect — extract the real URL
      let website = null;
      try {
        const parsed = new URL(resultUrl);
        // /l/ redirect path: ?uddg=<encoded>
        const uddg = parsed.searchParams.get('uddg');
        const realUrl = uddg ? decodeURIComponent(uddg) : resultUrl;
        if (!isDomainSkipped(realUrl)) website = realUrl;
      } catch { website = null; }

      const snippet = $el.find('.result__snippet, .result__body').first().text().trim();
      const fullText = title + ' ' + snippet;

      const phone = extractPhone(fullText);
      const instagram_url = extractInstagram(fullText, resultUrl);

      // Skip results with no contact info
      if (!phone && !website && !instagram_url) return;

      leads.push({
        source: 'duckduckgo',
        district,
        name: title,
        phone,
        website,
        instagram_url,
        // DuckDuckGo snippets sometimes include address fragments
        address: null, // too noisy to reliably parse
        maps_url: null,
        booksy_url: null,
        email: null,
        rating: null,
        reviews_count: null,
      });
    } catch { /* per-result error — skip */ }
  });

  return leads;
}

async function scrape(query, district) {
  let cheerio;
  try {
    cheerio = require('cheerio');
  } catch {
    return [];
  }

  try {
    // DDG HTML search: POST is more reliable than GET for longer queries
    const body = 'q=' + encodeURIComponent(query) + '&kl=pl-pl&kp=-1';
    const res = await get('/html/', body);

    if (res.status !== 200 && res.status !== 302) return [];

    return parseResults(res.body, cheerio, district);
  } catch {
    return [];
  }
}

module.exports = { scrape };
