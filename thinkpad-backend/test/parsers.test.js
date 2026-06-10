'use strict';
/**
 * Parser hardening helpers: booksy crawl anomaly detection and the
 * health-check endpoint URL fix (/health → /api/health).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { crawlVerdict } = require('../crons/lead-scout/anomaly');
const { endpointUrl } = require('../crons/health-check');

test('crawlVerdict: a normal crawl is not an anomaly', () => {
  const v = crawlVerdict({ pagesRun: 150, totalScraped: 3000, reachedCap: true });
  assert.equal(v.anomaly, false);
  assert.ok(v.warnings.some(w => /cap/i.test(w)), 'hitting MAX_PAGES still warns');
});

test('crawlVerdict: near-zero yield over many pages = parser drift anomaly', () => {
  const v = crawlVerdict({ pagesRun: 40, totalScraped: 3, reachedCap: false });
  assert.equal(v.anomaly, true);
  assert.ok(v.reasons.some(r => /JSON-LD|yield/i.test(r)));
});

test('crawlVerdict: a short crawl that ended naturally is fine', () => {
  const v = crawlVerdict({ pagesRun: 4, totalScraped: 80, reachedCap: false });
  assert.equal(v.anomaly, false);
  assert.equal(v.warnings.length, 0);
});

test('health-check endpointUrl uses /api/health (Worker route that actually exists)', () => {
  assert.equal(endpointUrl('https://manicbot.com'), 'https://manicbot.com/api/health');
  assert.equal(endpointUrl('https://manicbot.com/'), 'https://manicbot.com/api/health');
});
