'use strict';
/**
 * lib/gsc.js — thin read-only Google Search Console API client
 * (searchAnalytics.query, sitemaps.get, urlInspection.index.inspect).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createGsc } = require('../lib/gsc');

const fakeAuth = { getAccessToken: async () => 'TESTTOKEN' };
const ENC_PROPERTY = 'sc-domain%3Amanicbot.com'; // sc-domain:manicbot.com URL-encoded

function fakeTransport(data, status = 200) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { status, data }; };
  fn.calls = calls;
  return fn;
}

test('searchAnalytics POSTs the query to the property-scoped endpoint with a bearer token', async () => {
  const transport = fakeTransport({ rows: [{ clicks: 10, impressions: 100, ctr: 0.1, position: 5 }] });
  const gsc = createGsc({ auth: fakeAuth, transport });
  const out = await gsc.searchAnalytics({ startDate: '2026-06-01', endDate: '2026-06-07' });

  assert.equal(transport.calls.length, 1);
  const { url, opts } = transport.calls[0];
  assert.ok(url.includes(`/webmasters/v3/sites/${ENC_PROPERTY}/searchAnalytics/query`), url);
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.Authorization, 'Bearer TESTTOKEN');
  assert.deepEqual(opts.body, { startDate: '2026-06-01', endDate: '2026-06-07' });
  assert.equal(out.rows[0].clicks, 10);
});

test('getSitemap GETs the sitemap status, URL-encoding the feedpath', async () => {
  const transport = fakeTransport({ contents: [{ submitted: '39', indexed: '25' }], errors: '0', warnings: '0' });
  const gsc = createGsc({ auth: fakeAuth, transport });
  const out = await gsc.getSitemap('https://manicbot.com/sitemap.xml');

  const { url, opts } = transport.calls[0];
  assert.ok(url.includes(`/sites/${ENC_PROPERTY}/sitemaps/`), url);
  assert.ok(url.includes(encodeURIComponent('https://manicbot.com/sitemap.xml')), url);
  assert.equal(opts.method, 'GET');
  assert.equal(opts.headers.Authorization, 'Bearer TESTTOKEN');
  assert.equal(out.contents[0].indexed, '25');
});

test('inspectUrl POSTs to the v1 URL Inspection endpoint with inspectionUrl + siteUrl', async () => {
  const transport = fakeTransport({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } } });
  const gsc = createGsc({ auth: fakeAuth, transport });
  const out = await gsc.inspectUrl('https://manicbot.com/blog');

  const { url, opts } = transport.calls[0];
  assert.equal(url, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect');
  assert.equal(opts.method, 'POST');
  assert.deepEqual(opts.body, { inspectionUrl: 'https://manicbot.com/blog', siteUrl: 'sc-domain:manicbot.com' });
  assert.equal(out.inspectionResult.indexStatusResult.verdict, 'PASS');
});

test('a 4xx response surfaces the Google error message', async () => {
  const transport = fakeTransport({ error: { code: 403, message: 'User does not have sufficient permission' } }, 403);
  const gsc = createGsc({ auth: fakeAuth, transport });
  await assert.rejects(() => gsc.searchAnalytics({ startDate: 'x', endDate: 'y' }), /sufficient permission/);
});
