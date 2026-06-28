'use strict';
/**
 * crons/meta-ads-monitor.js — daily Meta ads + Pixel health report to Telegram.
 * Pure helpers (action summary, insights pick, report formatting) are unit-tested;
 * main() is driven with injected http + tg deps (no network).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  main, summarizeActions, pickInsights, formatReport, fetchAccountInsights,
} = require('../crons/meta-ads-monitor');

function silentLogger() {
  const lines = [];
  return { log: (m) => lines.push(m), lines };
}
function fakeTg() {
  const calls = [];
  return { calls, async sendMessage(text, opts) { calls.push({ text, opts }); return { message_id: 1 }; } };
}
/** http stub: maps a URL substring → response {status,data}. */
function fakeHttp(routes) {
  const calls = [];
  return {
    calls,
    async http(url, opts) {
      calls.push({ url, opts });
      for (const [needle, resp] of routes) if (url.includes(needle)) return resp;
      return { status: 404, data: { error: { message: 'no route' } } };
    },
  };
}

test('summarizeActions counts only conversion action_types, mapped to labels', () => {
  const actions = [
    { action_type: 'lead', value: '3' },
    { action_type: 'offsite_conversion.fct.complete_registration', value: '2' },
    { action_type: 'purchase', value: '1' },
    { action_type: 'link_click', value: '99' },     // ignored
    { action_type: 'complete_registration', value: '1' },
  ];
  assert.deepEqual(summarizeActions(actions), { Lead: 3, Registration: 3, Purchase: 1 });
});

test('pickInsights coerces numeric fields and folds conversions', () => {
  const row = pickInsights({ spend: '12.50', impressions: '1000', clicks: '40', reach: '900', actions: [{ action_type: 'lead', value: '4' }], campaign_name: 'C1' });
  assert.equal(row.spend, 12.5);
  assert.equal(row.impressions, 1000);
  assert.deepEqual(row.conversions, { Lead: 4 });
  assert.equal(row.campaignName, 'C1');
});

test('formatReport renders account line, no-campaign note, and pixel health', () => {
  const report = formatReport({
    account: { spend: 50, impressions: 12000, clicks: 300, reach: 9000, conversions: { Lead: 5 } },
    campaigns: [],
    pixel: { name: 'ManicBot Web', lastFiredAt: 1782000000 },
  });
  assert.match(report, /Meta Ads/);
  assert.match(report, /Расход: <b>50\.00<\/b>/);
  assert.match(report, /Lead 5/);
  assert.match(report, /Активных кампаний нет/);
  assert.match(report, /ManicBot Web/);
});

test('formatReport notes when the pixel has no events yet', () => {
  const report = formatReport({ account: null, campaigns: [], pixel: { name: 'ManicBot Web', lastFiredAt: null } });
  assert.match(report, /событий ещё не было/);
});

test('main no-ops cleanly when the token is missing (no send)', async () => {
  const tg = fakeTg();
  const res = await main(silentLogger(), { token: '', tg, http: async () => { throw new Error('should not call'); } });
  assert.equal(res.skipped, true);
  assert.equal(tg.calls.length, 0);
});

test('main fetches insights + pixel and sends one report', async () => {
  const tg = fakeTg();
  const h = fakeHttp([
    ['level=account', { status: 200, data: { data: [{ spend: '50', impressions: '12000', clicks: '300', reach: '9000', actions: [{ action_type: 'lead', value: '5' }] }] } }],
    ['level=campaign', { status: 200, data: { data: [{ campaign_name: 'ManicBot — Sales', spend: '50', actions: [{ action_type: 'lead', value: '5' }] }] } }],
    ['last_fired_time', { status: 200, data: { name: 'ManicBot Web', last_fired_time: '2026-06-28T08:00:00+0000' } }],
  ]);
  const res = await main(silentLogger(), { token: 'EAA-test', tg, http: h.http });
  assert.equal(res.ok, true);
  assert.equal(res.campaigns, 1);
  assert.equal(tg.calls.length, 1);
  assert.match(tg.calls[0].text, /ManicBot — Sales/);
  // token must travel in the Authorization header, never in the URL
  assert.ok(h.calls.every((c) => !String(c.url).includes('EAA-test')));
  assert.ok(h.calls.every((c) => c.opts.headers.Authorization === 'Bearer EAA-test'));
});

test('fetchAccountInsights throws on a Graph error envelope (so the cron alerts)', async () => {
  const h = fakeHttp([['insights', { status: 400, data: { error: { message: 'Invalid OAuth token' } } }]]);
  await assert.rejects(() => fetchAccountInsights(h.http, { token: 'bad', accountId: 'act_1' }), /Invalid OAuth token/);
});
