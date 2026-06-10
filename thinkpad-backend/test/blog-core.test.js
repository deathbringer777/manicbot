'use strict';
/**
 * crons/blog/core.js — pure logic of the blog pipeline:
 * prompt builders, LLM-output validation, D1 row building, image pick,
 * Telegram preview, draft store paths. No network, no claude here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../crons/blog/core');

function sampleArticle(words = 320) {
  const body = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
  const langs = ['ru', 'ua', 'en', 'pl'];
  const obj = { titles: {}, excerpts: {}, bodies: {} };
  for (const l of langs) {
    obj.titles[l] = `Title ${l}`;
    obj.excerpts[l] = `Excerpt ${l}`;
    obj.bodies[l] = body;
  }
  return obj;
}

function sampleTopic() {
  return {
    slug: 'test-topic',
    category: 'tips',
    queryRu: 'тестовая тема для салона',
    queryEn: 'test topic for salons',
    keywords: { ru: ['а'], ua: ['б'], en: ['c'], pl: ['d'] },
  };
}

test('validateArticle: passes on a complete 4-lang article', () => {
  assert.doesNotThrow(() => core.validateArticle(sampleArticle()));
});

test('validateArticle: fails on missing language and on too-short body', () => {
  const broken = sampleArticle();
  delete broken.titles.pl;
  assert.throws(() => core.validateArticle(broken), /pl/);

  const short = sampleArticle(40); // garbage-length body must be rejected
  assert.throws(() => core.validateArticle(short), /short/i);
});

test('parseArticleJSON: direct, fenced, embedded; throws on garbage', () => {
  const a = sampleArticle();
  const json = JSON.stringify(a);
  assert.deepEqual(core.parseArticleJSON(json), a);
  assert.deepEqual(core.parseArticleJSON('```json\n' + json + '\n```'), a);
  assert.deepEqual(core.parseArticleJSON('note ' + json + ' done'), a);
  assert.throws(() => core.parseArticleJSON('nope'), /parse/i);
});

test('validateTopics: keeps only well-formed topics', () => {
  const ok = sampleTopic();
  const out = core.validateTopics([ok, { slug: '' }, { queryRu: 'x' }, null]);
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, 'test-topic');
});

test('buildRow: D1-ready row with stringified JSON fields', () => {
  const row = core.buildRow({
    slug: 'test-topic',
    topic: sampleTopic(),
    article: sampleArticle(),
    image: { url: 'https://img/x.jpg', credit: 'Unsplash' },
    now: 1765000000,
  });
  assert.equal(row.slug, 'test-topic');
  assert.equal(row.status, 'published');
  assert.equal(row.id, 'blog_1765000000_test-topic');
  assert.equal(row.cover_url, 'https://img/x.jpg');
  assert.deepEqual(JSON.parse(row.titles_json).ru, 'Title ru');
  assert.deepEqual(JSON.parse(row.keywords_json).pl, ['d']);
  assert.equal(row.created_by_web_user_id, 'blog_autopilot');
  // exact column set must match the blog_posts table contract
  assert.deepEqual(Object.keys(row).sort(), [
    'archived_at', 'bodies_json', 'category', 'cover_alt_json', 'cover_credit',
    'cover_url', 'created_at', 'created_by_web_user_id', 'excerpts_json', 'id',
    'keywords_json', 'published_at', 'published_date', 'related_slugs_json',
    'slug', 'status', 'titles_json', 'updated_at', 'updated_by_web_user_id',
    'updated_date',
  ]);
});

test('pickImage: keyword match wins; rng only breaks ties', () => {
  const pool = [
    { url: 'a', credit: 'X', keywords: ['unrelated'] },
    { url: 'b', credit: 'X', keywords: ['salon', 'manicure'] },
  ];
  const img = core.pickImage(
    { queryRu: 'тема', queryEn: 'manicure salon growth' },
    pool,
    () => 0.99,
  );
  assert.equal(img.url, 'b');
});

test('preview: HTML text contains RU title/excerpt and word stats; keyboard fits 64-byte callback_data', () => {
  const draft = {
    slug: 'test-topic',
    topic: sampleTopic(),
    article: sampleArticle(),
    image: { url: 'https://img/x.jpg', credit: 'Unsplash' },
  };
  const text = core.buildPreviewText(draft);
  assert.ok(text.includes('Title ru'));
  assert.ok(text.includes('Excerpt ru'));
  assert.ok(text.includes('test-topic'));

  const kb = core.buildPreviewKeyboard('test-topic');
  const flat = kb.flat();
  assert.equal(flat.length, 3);
  for (const btn of flat) {
    assert.ok(Buffer.byteLength(btn.callback_data) <= 64, btn.callback_data);
  }
  assert.ok(flat.some(b => b.callback_data === 'blog:pub:test-topic'));
  assert.ok(flat.some(b => b.callback_data === 'blog:rev:test-topic'));
  assert.ok(flat.some(b => b.callback_data === 'blog:skip:test-topic'));
});

test('draft store: save → list pending → move to published', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-test-'));
  const store = core.createDraftStore(baseDir);
  const draft = { slug: 's1', topic: sampleTopic(), article: sampleArticle(), image: { url: 'u', credit: 'c' } };
  store.saveDraft(draft);
  assert.deepEqual(store.listPending(), ['s1']);
  const loaded = store.loadDraft('s1');
  assert.equal(loaded.slug, 's1');
  store.moveDraft('s1', 'published');
  assert.deepEqual(store.listPending(), []);
  assert.ok(fs.existsSync(path.join(baseDir, 'marketing', 'articles', 'published', 's1.json')));
});

test('getSeason maps months to seasons', () => {
  assert.match(core.getSeason(new Date('2026-01-15')), /winter/);
  assert.match(core.getSeason(new Date('2026-04-15')), /spring/);
  assert.match(core.getSeason(new Date('2026-07-15')), /summer/);
  assert.match(core.getSeason(new Date('2026-10-15')), /fall/);
});
