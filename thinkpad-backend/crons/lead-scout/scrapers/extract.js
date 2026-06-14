'use strict';
/**
 * extract.js — pure text/URL extractors shared by the search scrapers
 * (olx / google / bing). Kept separate so the noisy regex logic is unit-tested
 * once instead of copy-pasted per scraper.
 */

// Polish phone formats: +48 123 456 789 | +48123456789 | 123-456-789 | (12)345-67-89
const PHONE_RE = /(?:\+48[\s\-]?)?(?:\d[\s\-]?){8}\d/g;

// Directories / social / aggregators we never want as a lead's "website".
const SKIP_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com', 'twitter.com', 'x.com',
  'pinterest.com', 'linkedin.com', 'google.com', 'google.pl', 'maps.google.com',
  'duckduckgo.com', 'bing.com', 'yahoo.com',
  'booksy.com', 'treatwell.pl', 'fresha.com', 'vagaro.com', 'moment.pl',
  'yelp.com', 'tripadvisor.com', 'panoramafirm.pl', 'zumi.pl', 'gowork.pl',
  'yellowpages.com', 'allegro.pl', 'olx.pl', 'aleo.com', 'pkt.pl',
]);

/** First plausible Polish phone in free text, normalized to +48XXXXXXXXX. */
function extractPhone(text) {
  if (!text) return null;
  const matches = String(text).match(PHONE_RE);
  if (!matches) return null;
  for (const m of matches) {
    const digits = m.replace(/\D/g, '').replace(/^48/, '');
    if (digits.length >= 9) return '+48' + digits.slice(-9);
  }
  return null;
}

/** Instagram profile URL from a url or free text, else null. */
function extractInstagram(text, url) {
  if (url && /instagram\.com\//i.test(url)) return url;
  const m = String(text || '').match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/i);
  return m ? m[0] : null;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
}

/** True if the URL is a directory/social/aggregator we skip as a website. */
function isAggregatorDomain(url) {
  const h = hostOf(url);
  return h === null ? true : SKIP_DOMAINS.has(h);
}

/** Return the url as a lead website only if it's a real business site. */
function pickWebsite(url) {
  return url && !isAggregatorDomain(url) ? url : null;
}

module.exports = { PHONE_RE, SKIP_DOMAINS, extractPhone, extractInstagram, isAggregatorDomain, pickWebsite, hostOf };
