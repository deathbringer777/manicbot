'use strict';
/**
 * blog.generate JOB HANDLER (services/blog-generate.js) — on-demand draft reusing
 * the autopilot pipeline. All side-effecting deps (store/gen/discover/askClaude/
 * tg) are injected, so no fs / network / Claude CLI is touched.
 * (Distinct from blog-generate.test.js, which tests crons/blog/generate.js.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { blogGenerate } = require('../services/blog-generate');

const TOPIC = {
  slug: 'on-demand-topic', category: 'tips', queryRu: 'маникюр', queryEn: 'manicure',
  keywords: { ru: ['маникюр'], ua: [], en: ['manicure'], pl: [] },
};

function fullArticle() {
  const body = 'word '.repeat(50);
  return {
    titles: { ru: 'Заголовок', ua: 'T', en: 'T', pl: 'T' },
    excerpts: { ru: 'Кратко', ua: 'E', en: 'E', pl: 'E' },
    bodies: { ru: body, ua: body, en: body, pl: body },
  };
}

function fakeStore(pending = []) {
  const saved = [];
  return { listPending: () => pending, saveDraft: (d) => { saved.push(d); return `/drafts/${d.slug}.json`; }, _saved: saved };
}

function fakeTg() {
  const calls = [];
  return {
    configured: true,
    sendPhoto: async (...a) => { calls.push(['photo', ...a]); },
    sendMessage: async (...a) => { calls.push(['msg', ...a]); },
    _calls: calls,
  };
}

test('blog.generate: explicit topic → generates, saves draft, sends preview', async () => {
  const store = fakeStore();
  const tg = fakeTg();
  const gen = async ({ topic }) => { assert.equal(topic.slug, 'on-demand-topic'); return fullArticle(); };
  const r = await blogGenerate({ topic: TOPIC }, { askClaude: async () => ({ text: 'x' }), tg, gen, store, now: () => 'T0' });
  assert.equal(r.ok, true);
  assert.equal(r.slug, 'on-demand-topic');
  assert.equal(store._saved.length, 1);
  assert.equal(store._saved[0].createdAt, 'T0');
  assert.equal(tg._calls.length, 1);            // preview sent
  assert.equal(tg._calls[0][0], 'photo');
});

test('blog.generate: respects the autopilot draft lock (no double-draft)', async () => {
  const store = fakeStore(['already-pending']);
  await assert.rejects(
    () => blogGenerate({ topic: TOPIC }, { askClaude: async () => ({ text: '' }), tg: fakeTg(), gen: async () => fullArticle(), store }),
    /draft lock/,
  );
  assert.equal(store._saved.length, 0);          // nothing generated/saved
});

test('blog.generate: no topic → discovers one and uses it', async () => {
  const store = fakeStore();
  let genTopic = null;
  const gen = async ({ topic }) => { genTopic = topic; return fullArticle(); };
  const discover = async () => TOPIC;
  const r = await blogGenerate({}, { askClaude: async () => ({ text: 'x' }), tg: fakeTg(), gen, discover, store, now: () => 'T0' });
  assert.equal(genTopic.slug, 'on-demand-topic');
  assert.equal(r.ok, true);
});

test('blog.generate: ask path is tool-free + default permission (SEC-001 consistency)', async () => {
  const store = fakeStore();
  const askOpts = [];
  const askClaude = async (_p, opts) => { askOpts.push(opts); return { text: 'x' }; };
  const gen = async ({ ask }) => { await ask('prompt'); return fullArticle(); };
  await blogGenerate({ topic: TOPIC }, { askClaude, tg: fakeTg(), gen, store, now: () => 'T0' });
  const o = askOpts.find((x) => x && 'tools' in x);
  assert.equal(o.tools, '');
  assert.equal(o.permissionMode, 'default');
});

test('blog.generate: tg unconfigured → no send, still saves + ok', async () => {
  const store = fakeStore();
  const tg = { configured: false, sendPhoto: async () => { throw new Error('must not send'); } };
  const r = await blogGenerate({ topic: TOPIC }, { askClaude: async () => ({ text: 'x' }), tg, gen: async () => fullArticle(), store, now: () => 'T0' });
  assert.equal(r.ok, true);
  assert.equal(store._saved.length, 1);
});
