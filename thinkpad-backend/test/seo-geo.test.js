'use strict';
/**
 * crons/seo-geo — SEO+GEO keyword research cron.
 * Pure collectors/parsers/scorer + graceful-degrade orchestration + the new
 * tg.sendDocument multipart upload. All hermetic (no network, no node_modules).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildUrl, parseAutocomplete } = require('../crons/seo-geo/collectors/autocomplete');
const { toRow, strikingDistance } = require('../crons/seo-geo/collectors/gsc');
const { stripXssi, parseRelatedQueries } = require('../crons/seo-geo/collectors/trends');
const { parseQuestions } = require('../crons/seo-geo/collectors/serp');
const { normalizeKeyword, keywordKey, mergeKeywords } = require('../crons/seo-geo/dedup');
const { scoreKeyword, prioritize } = require('../crons/seo-geo/analyze');
const { buildMarkdown, buildCsv } = require('../crons/seo-geo/report');
const { runCollectors } = require('../crons/seo-geo/index');
const { createTg, buildMultipart } = require('../lib/tg');

// ── autocomplete ──────────────────────────────────────────────────────────
test('autocomplete buildUrl uses firefox client + hl + encoded query', () => {
  const url = buildUrl('paznokcie żelowe', 'pl');
  assert.ok(url.startsWith('https://suggestqueries.google.com/complete/search'));
  assert.ok(url.includes('client=firefox'));
  assert.ok(url.includes('hl=pl'));
  assert.ok(/q=paznokcie/.test(url) && url.includes('%C5%BCelowe')); // ż percent-encoded
});

test('parseAutocomplete reads the ["seed",[...]] firefox shape (string or array)', () => {
  const raw = '["paznokcie",["paznokcie lato 2026","paznokcie warszawa",1]]';
  assert.deepEqual(parseAutocomplete(raw), ['paznokcie lato 2026', 'paznokcie warszawa']);
  assert.deepEqual(parseAutocomplete(['s', ['a', 'b']]), ['a', 'b']);
});

test('parseAutocomplete is empty-safe on junk / empty suggestions', () => {
  assert.deepEqual(parseAutocomplete('not json'), []);
  assert.deepEqual(parseAutocomplete('["system rezerwacji",[]]'), []);
  assert.deepEqual(parseAutocomplete(null), []);
});

// ── gsc ───────────────────────────────────────────────────────────────────
test('gsc toRow maps keys[0]→keyword with metric fallbacks', () => {
  assert.deepEqual(toRow({ keys: ['booksy alternatywa'], clicks: 2, impressions: 90, ctr: 0.02, position: 12.3 }),
    { keyword: 'booksy alternatywa', clicks: 2, impressions: 90, ctr: 0.02, position: 12.3 });
  assert.equal(toRow({}).keyword, '');
});

test('gsc strikingDistance keeps positions 5–20 with impressions, sorted desc', () => {
  const rows = [
    { keyword: 'page1', impressions: 500, position: 2 },    // too good already
    { keyword: 'mid-a', impressions: 40, position: 8.5 },   // striking
    { keyword: 'mid-b', impressions: 120, position: 14 },   // striking, more impr
    { keyword: 'thin', impressions: 3, position: 9 },       // too few impr
    { keyword: 'deep', impressions: 200, position: 35 },    // too deep
  ];
  const sd = strikingDistance(rows);
  assert.deepEqual(sd.map((r) => r.keyword), ['mid-b', 'mid-a']);
});

// ── trends ────────────────────────────────────────────────────────────────
test('trends stripXssi removes the )]}\' guard prefix', () => {
  assert.equal(stripXssi(")]}'\n{\"a\":1}"), '{"a":1}');
  assert.equal(stripXssi('{"a":1}'), '{"a":1}');
});

test('trends parseRelatedQueries splits top vs rising ranked lists', () => {
  const payload = ")]}'\n" + JSON.stringify({
    default: { rankedList: [
      { rankedKeyword: [{ query: 'paznokcie lato', value: 100 }] },
      { rankedKeyword: [{ query: 'paznokcie wielkanoc', value: 250 }, { query: '', value: 5 }] },
    ] },
  });
  const { top, rising } = parseRelatedQueries(payload);
  assert.deepEqual(top.map((x) => x.query), ['paznokcie lato']);
  assert.deepEqual(rising.map((x) => x.query), ['paznokcie wielkanoc']); // empty query dropped
});

// ── serp ──────────────────────────────────────────────────────────────────
test('serp parseQuestions extracts question-form phrases', () => {
  const html = '<div>foo</div><span>Jak umówić klienta na paznokcie online?</span> <p>ile kosztuje manicure w Warszawie?</p>';
  const qs = parseQuestions(html);
  assert.ok(qs.includes('jak umówić klienta na paznokcie online?'));
  assert.ok(qs.some((q) => q.startsWith('ile kosztuje manicure')));
});

// ── dedup ─────────────────────────────────────────────────────────────────
test('normalizeKeyword lowercases, collapses ws, strips trailing punctuation', () => {
  assert.equal(normalizeKeyword('  Paznokcie   Warszawa? '), 'paznokcie warszawa');
});

test('keywordKey is language-scoped (same text, different lang ≠ collision)', () => {
  assert.notEqual(keywordKey('manicure', 'pl'), keywordKey('manicure', 'en'));
  assert.equal(keywordKey('Manicure ', 'pl'), keywordKey('manicure', 'pl'));
  assert.equal(keywordKey('', 'pl'), null);
});

test('mergeKeywords dedups and unions sources + back-fills GSC signal', () => {
  const merged = mergeKeywords(
    [{ keyword: 'booksy alternatywa', lang: 'pl', source: 'autocomplete' }],
    [{ keyword: 'Booksy alternatywa', lang: 'pl', source: 'gsc', gscImpressions: 80, gscPosition: 11 }],
    [{ keyword: 'manicure cena', lang: 'pl', source: 'autocomplete' }],
  );
  assert.equal(merged.length, 2);
  const booksy = merged.find((k) => k.keyword === 'booksy alternatywa');
  assert.deepEqual(booksy.sources.sort(), ['autocomplete', 'gsc']);
  assert.equal(booksy.gscImpressions, 80); // back-filled from the later GSC hit
});

// ── analyze / scorer ────────────────────────────────────────────────────────
test('scoreKeyword rewards demand, striking distance, momentum, fit', () => {
  const weak = scoreKeyword({ autocompleteDepth: 1, businessFit: 1 });
  const strong = scoreKeyword({ autocompleteDepth: 10, gscImpressions: 500, gscPosition: 8, trendsRising: true, businessFit: 3, question: true });
  assert.ok(strong > weak);
});

test('prioritize sorts high→low and buckets by percentile (top 25% High, bottom 25% Low — always populated)', () => {
  const kws = Array.from({ length: 8 }, (_, i) => ({ keyword: `k${i}`, lang: 'pl', cluster: 'service', autocompleteDepth: 8 - i }));
  const out = prioritize(kws);
  assert.equal(out[0].keyword, 'k0');                 // highest depth → top
  assert.ok(out[0].score >= out[out.length - 1].score);
  assert.equal(out[0].priority, 'High');              // top quartile
  assert.equal(out[out.length - 1].priority, 'Low');  // bottom quartile
  assert.ok(out.some((k) => k.priority === 'Med'));   // middle band populated
});

// ── report ──────────────────────────────────────────────────────────────────
test('buildMarkdown emits the core sections and the GSC-off note', () => {
  const md = buildMarkdown({
    date: '2026-06-19',
    keywords: [{ keyword: 'paznokcie warszawa', lang: 'pl', audience: 'B2C', cluster: 'service', priority: 'High', score: 50 }],
    gsc: { configured: false, striking: [] },
    analysis: null, trendsCount: 0, failures: [],
  });
  assert.ok(md.includes('# Manicbot — SEO + GEO keyword research'));
  assert.ok(md.includes('## 5. GEO / AEO'));
  assert.ok(md.includes('GSC не настроен'));
  assert.ok(md.includes('paznokcie warszawa'));
});

test('buildCsv writes a header plus one row per keyword, escaping commas', () => {
  const csv = buildCsv([{ keyword: 'manicure, hybrydowy', lang: 'pl', audience: 'B2C', cluster: 'service', priority: 'Med', score: 30, sources: ['autocomplete'] }]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('keyword,lang,audience'));
  assert.ok(lines[1].includes('"manicure, hybrydowy"')); // comma-bearing field quoted
});

// ── orchestration: graceful degrade ──────────────────────────────────────────
test('runCollectors: a failing collector degrades, the rest still return', async () => {
  const logs = [];
  const { results, failures } = await runCollectors([
    { name: 'autocomplete', run: async () => [{ keyword: 'a' }] },
    { name: 'trends', run: async () => { throw new Error('429 rate limited'); } },
    { name: 'gsc', run: async () => ({ configured: false, queries: [] }) },
  ], { log: (m) => logs.push(m) });
  assert.deepEqual(results.autocomplete, [{ keyword: 'a' }]);
  assert.equal(results.trends, undefined);
  assert.deepEqual(failures, ['trends']);
  assert.ok(logs.some((l) => /trends FAILED/.test(l)));
});

// ── tg.sendDocument (new) ────────────────────────────────────────────────────
test('buildMultipart includes named fields and the file part with filename', () => {
  const body = buildMultipart('BND', { chat_id: '5', caption: 'hi' }, { field: 'document', filename: 'r.md', content: '# x', contentType: 'text/markdown' });
  assert.ok(body.includes('name="chat_id"'));
  assert.ok(body.includes('hi'));
  assert.ok(body.includes('name="document"; filename="r.md"'));
  assert.ok(body.includes('# x'));
  assert.ok(body.trim().endsWith('--BND--'));
});

test('sendDocument posts multipart to /sendDocument with a boundary header', async () => {
  const calls = [];
  const transport = async (url, opts) => { calls.push({ url, opts }); return { status: 200, data: { ok: true, result: { message_id: 7 } } }; };
  const tg = createTg({ token: 'TOK', chatId: '111', transport });
  const fsImpl = { readFileSync: () => '# SEO report\nbody' };
  const res = await tg.sendDocument('/tmp/seo-geo-2026-06-19.md', { caption: 'cap', fsImpl });
  assert.equal(res.message_id, 7);
  const { url, opts } = calls[0];
  assert.ok(url.endsWith('/sendDocument'));
  assert.ok(/multipart\/form-data; boundary=----manicbotcron/.test(opts.headers['Content-Type']));
  assert.ok(opts.body.includes('filename="seo-geo-2026-06-19.md"'));
  assert.ok(opts.body.includes('# SEO report'));
});

test('sendDocument no-ops (returns null) when tg is unconfigured', async () => {
  const calls = [];
  const tg = createTg({ token: '', chatId: '', transport: async (u, o) => { calls.push({ u, o }); return { data: { ok: true } }; } });
  const res = await tg.sendDocument('/tmp/x.md', { fsImpl: { readFileSync: () => 'x' } });
  assert.equal(res, null);
  assert.equal(calls.length, 0);
});
