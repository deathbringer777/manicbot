'use strict';
/**
 * crons/gsc-monitor.js — daily Google Search Console health report to Telegram.
 * Pure helpers (date windows, inspection classification, report formatting) are
 * unit-tested; main() is driven with injected gsc + tg deps (no network).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  main, dateWindows, classifyInspection, totalsRow, formatReport, PRIORITY_URLS,
} = require('../crons/gsc-monitor');

function silentLogger() {
  const lines = [];
  return { log: (m) => lines.push(m), lines };
}

function fakeTg() {
  const calls = [];
  return {
    calls,
    async sendMessage(text, opts) { calls.push({ text, opts }); return { message_id: 1 }; },
  };
}

test('dateWindows builds two contiguous 7-day windows behind a crawl-lag', () => {
  const w = dateWindows(new Date('2026-06-14T00:00:00Z'));
  // lag 3 → current window ends 2026-06-11, prior window is the 7 days before it
  assert.deepEqual(w, {
    curStart: '2026-06-05', curEnd: '2026-06-11',
    prevStart: '2026-05-29', prevEnd: '2026-06-04',
  });
});

test('classifyInspection reads the coverage state into an indexed boolean', () => {
  const mk = (coverageState) => ({ inspectionResult: { indexStatusResult: { coverageState } } });
  assert.equal(classifyInspection('u', mk('Submitted and indexed')).indexed, true);
  assert.equal(classifyInspection('u', mk('Discovered - currently not indexed')).indexed, false);
  assert.equal(classifyInspection('u', mk('Crawled - currently not indexed')).indexed, false);
  assert.equal(classifyInspection('u', mk('URL is unknown to Google')).indexed, false);
});

test('totalsRow returns the aggregate row or zeros', () => {
  assert.deepEqual(totalsRow({ rows: [{ clicks: 5, impressions: 50, ctr: 0.1, position: 8 }] }),
    { clicks: 5, impressions: 50, ctr: 0.1, position: 8 });
  assert.deepEqual(totalsRow({ rows: [] }), { clicks: 0, impressions: 0, ctr: 0, position: 0 });
  assert.deepEqual(totalsRow(null), { clicks: 0, impressions: 0, ctr: 0, position: 0 });
});

test('formatReport shows trend arrows and a "request indexing" list', () => {
  const report = formatReport({
    property: 'sc-domain:manicbot.com',
    window: { curStart: '2026-06-05', curEnd: '2026-06-11' },
    cur: { clicks: 30, impressions: 1200, ctr: 0.025, position: 12.4 },
    prev: { clicks: 20, impressions: 1000, ctr: 0.02, position: 14.0 },
    topQueries: [{ keys: ['manicbot'], clicks: 10 }],
    sitemap: { lastDownloaded: '2026-06-13T00:00:00Z', errors: '0', warnings: '0', contents: [{ submitted: '39', indexed: '25' }] },
    inspections: [
      { url: 'https://manicbot.com/blog', indexed: true, state: 'Submitted and indexed' },
      { url: 'https://manicbot.com/blog/google-calendar-sync', indexed: false, state: 'Discovered - currently not indexed' },
    ],
  });
  assert.match(report, /manicbot\.com/);
  assert.match(report, /▲/);                                  // clicks went up
  assert.match(report, /google-calendar-sync/);              // flagged for manual request
});

test('formatReport reports a clean bill when everything is indexed', () => {
  const report = formatReport({
    property: 'sc-domain:manicbot.com',
    window: { curStart: '2026-06-05', curEnd: '2026-06-11' },
    cur: { clicks: 30, impressions: 1200, ctr: 0.025, position: 12.4 },
    prev: { clicks: 30, impressions: 1200, ctr: 0.025, position: 12.4 },
    topQueries: [],
    sitemap: null,
    inspections: [{ url: 'https://manicbot.com/blog', indexed: true, state: 'Submitted and indexed' }],
  });
  assert.match(report, /✓/);
});

test('main no-ops cleanly when GSC credentials are not configured', async () => {
  const tg = fakeTg();
  const logger = silentLogger();
  const res = await main(logger, { getServiceAccount: () => null, tg });
  assert.deepEqual(res, { skipped: true });
  assert.equal(tg.calls.length, 0, 'must not send, must not alert');
  assert.ok(logger.lines.some((l) => /skipping/i.test(l)));
});

test('main pulls GSC data, flags not-indexed URLs and sends one report', async () => {
  const today = new Date('2026-06-14T00:00:00Z');
  const w = dateWindows(today);
  const flagged = PRIORITY_URLS[3];
  const gsc = {
    property: 'sc-domain:manicbot.com',
    async searchAnalytics(q) {
      if (q.dimensions && q.dimensions.includes('query')) return { rows: [{ keys: ['manicbot'], clicks: 9 }] };
      if (q.startDate === w.curStart) return { rows: [{ clicks: 40, impressions: 1500, ctr: 0.026, position: 11.5 }] };
      return { rows: [{ clicks: 25, impressions: 1100, ctr: 0.022, position: 13.2 }] };
    },
    async getSitemap() { return { lastDownloaded: '2026-06-13T00:00:00Z', errors: '0', warnings: '0', contents: [{ submitted: '39', indexed: '25' }] }; },
    async inspectUrl(url) {
      const state = url === flagged ? 'Crawled - currently not indexed' : 'Submitted and indexed';
      return { inspectionResult: { indexStatusResult: { coverageState: state } } };
    },
  };
  const tg = fakeTg();
  const res = await main(silentLogger(), { getServiceAccount: () => ({ client_email: 'x', private_key: 'y' }), gsc, tg, today });

  assert.equal(res.ok, true);
  assert.equal(tg.calls.length, 1);
  assert.match(tg.calls[0].text, /GSC/);
  assert.match(tg.calls[0].text, new RegExp(flagged.replace(/[/.-]/g, '\\$&')));
  assert.equal(tg.calls[0].opts.parseMode, 'HTML');
});

test('main lets a top-level GSC error bubble (runner alerts + exits non-zero)', async () => {
  const gsc = {
    property: 'sc-domain:manicbot.com',
    async searchAnalytics() { throw new Error('User does not have sufficient permission'); },
    async getSitemap() { return null; },
    async inspectUrl() { return {}; },
  };
  await assert.rejects(
    () => main(silentLogger(), { getServiceAccount: () => ({ client_email: 'x', private_key: 'y' }), gsc, tg: fakeTg(), today: new Date('2026-06-14T00:00:00Z') }),
    /sufficient permission/,
  );
});
