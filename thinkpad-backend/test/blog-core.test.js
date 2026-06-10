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
  assert.doesNotThrow(() => core.validateArticle(sampleArticle(2000)));
});

test('validateArticle: fails on missing language and on too-short body', () => {
  const broken = sampleArticle(2000);
  delete broken.titles.pl;
  assert.throws(() => core.validateArticle(broken), /pl/);

  const short = sampleArticle(400); // 400 words is now far below the ~2000 target
  assert.throws(() => core.validateArticle(short), /short/i);
});

test('long-form target: ~2000 words per language is the accepted band', () => {
  assert.ok(core.MIN_BODY_WORDS >= 1400, 'min must enforce long-form');
  assert.ok(core.MAX_BODY_WORDS >= 2400, 'max must allow ~2000+ words');
  assert.doesNotThrow(() => core.validateOneLang(
    { title: 'T', excerpt: 'E', body: Array.from({ length: 1900 }, (_, i) => `w${i}`).join(' ') }, 'ru'));
  assert.throws(() => core.validateOneLang(
    { title: 'T', excerpt: 'E', body: 'too short' }, 'ru'), /short/i);
});

test('bodyPrompt: asks for ONE language, ~2000 words, single-object JSON', () => {
  const p = core.bodyPrompt(sampleTopic(), 'ru');
  assert.ok(/2000|2,000/.test(p), 'states the ~2000-word target');
  assert.ok(/Russian/i.test(p));
  assert.ok(/"title"[\s\S]*"excerpt"[\s\S]*"body"/.test(p), 'single {title,excerpt,body} shape');
  assert.ok(!/titles|bodies/.test(p), 'NOT the old 4-language multi-object shape');
});

test('translatePrompt: localizes a written RU article into another language', () => {
  const source = { title: 'Заголовок', excerpt: 'Краткое', body: 'Тело статьи на русском.' };
  const p = core.translatePrompt(sampleTopic(), 'ru', 'pl', source);
  assert.ok(/Polish/i.test(p));
  assert.ok(p.includes('Тело статьи'), 'embeds the source article');
  assert.ok(/localize|localis|adapt/i.test(p), 'localize, not literal translate (SEO keywords)');
});

test('assembleArticle: per-language {title,excerpt,body} → {titles,excerpts,bodies}', () => {
  const out = core.assembleArticle({
    ru: { title: 'Tr', excerpt: 'Er', body: 'Br' },
    ua: { title: 'Tu', excerpt: 'Eu', body: 'Bu' },
    en: { title: 'Te', excerpt: 'Ee', body: 'Be' },
    pl: { title: 'Tp', excerpt: 'Ep', body: 'Bp' },
  });
  assert.deepEqual(Object.keys(out).sort(), ['bodies', 'excerpts', 'titles']);
  assert.equal(out.titles.en, 'Te');
  assert.equal(out.bodies.pl, 'Bp');
  assert.equal(out.excerpts.ru, 'Er');
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
  assert.equal(flat.length, 4); // read + publish + revise + skip
  for (const btn of flat) {
    assert.ok(Buffer.byteLength(btn.callback_data) <= 64, btn.callback_data);
  }
  assert.ok(flat.some(b => b.callback_data === 'blog:pub:test-topic'));
  assert.ok(flat.some(b => b.callback_data === 'blog:rev:test-topic'));
  assert.ok(flat.some(b => b.callback_data === 'blog:skip:test-topic'));
  // The owner must be able to read the full article before approving.
  // (Full-text rendering + language switching live in the bot — see
  // thinkpad-bot/test/blog-cmd.test.js — since the bot handles the callback.)
  assert.ok(flat.some(b => b.callback_data === 'blog:read:test-topic'));
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
