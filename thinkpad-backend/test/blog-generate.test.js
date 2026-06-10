'use strict';
/**
 * crons/blog/generate.js — i18n orchestration: write the article once in the
 * primary language, localize to the rest, assemble + validate. Network is
 * injected as `ask(prompt) → text`, so this is deterministic.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { generateArticle, reviseArticle } = require('../crons/blog/generate');

function longBody(lang, n = 1900) {
  return Array.from({ length: n }, (_, i) => `${lang}word${i}`).join(' ');
}

// The real model output uses the marker format (NOT JSON) — exercise that path.
function oneLangJSON(lang) {
  return `@@TITLE@@\nTitle ${lang}\n@@EXCERPT@@\nExcerpt ${lang}\n@@BODY@@\n${longBody(lang)}`;
}

const TOPIC = { slug: 't', category: 'tips', queryRu: 'тема', queryEn: 'topic', keywords: {} };

test('generateArticle: 1 write + 3 localize calls → assembled 4-lang article', async () => {
  const prompts = [];
  // first call = RU body; next three = localizations
  const ask = async (prompt) => {
    prompts.push(prompt);
    const lang = ['ru', 'ua', 'en', 'pl'][prompts.length - 1];
    return oneLangJSON(lang);
  };
  const article = await generateArticle({ topic: TOPIC, ask });
  assert.equal(prompts.length, 4, 'one write + three localizations');
  assert.deepEqual(Object.keys(article).sort(), ['bodies', 'excerpts', 'titles']);
  for (const l of ['ru', 'ua', 'en', 'pl']) {
    assert.equal(article.titles[l], `Title ${l}`);
    assert.ok(article.bodies[l].split(/\s+/).length >= 1500, `${l} is long-form`);
  }
  // The RU call must be the long-form body prompt; the others localization prompts.
  assert.ok(/about:/.test(prompts[0]));
  assert.ok(/[Ll]ocaliz/.test(prompts[1]));
});

test('generateArticle: retries a language that first parses badly, then succeeds', async () => {
  let calls = 0;
  const ask = async (prompt) => {
    calls++;
    if (calls === 1) return oneLangJSON('ru');
    if (calls === 2) return 'garbage not json'; // first UA attempt fails to parse
    const lang = calls === 3 ? 'ua' : (calls === 4 ? 'en' : 'pl');
    return oneLangJSON(lang);
  };
  const article = await generateArticle({ topic: TOPIC, ask, attemptsPerLang: 3 });
  assert.ok(article.bodies.ua.length > 0, 'UA recovered on retry');
});

test('generateArticle: a language that never validates throws after its attempts', async () => {
  const ask = async (prompt) => {
    if (/[Ll]ocaliz/.test(prompt)) return JSON.stringify({ title: 'x', excerpt: 'y', body: 'too short' });
    return oneLangJSON('ru');
  };
  await assert.rejects(() => generateArticle({ topic: TOPIC, ask, attemptsPerLang: 2 }), /too short|failed/i);
});

test('reviseArticle: revises the primary language then re-localizes the rest', async () => {
  const draft = {
    topic: TOPIC,
    article: {
      titles: { ru: 'T', ua: 'T', en: 'T', pl: 'T' },
      excerpts: { ru: 'E', ua: 'E', en: 'E', pl: 'E' },
      bodies: { ru: longBody('ru'), ua: longBody('ua'), en: longBody('en'), pl: longBody('pl') },
    },
  };
  const prompts = [];
  const ask = async (prompt) => {
    prompts.push(prompt);
    const lang = ['ru', 'ua', 'en', 'pl'][prompts.length - 1];
    return oneLangJSON(lang);
  };
  const revised = await reviseArticle({ draft, feedback: 'короче и проще', ask });
  assert.ok(/короче и проще/.test(prompts[0]), 'feedback applied to the RU revision');
  assert.ok(/[Ll]ocaliz/.test(prompts[1]), 'others re-localized from the revised RU');
  assert.equal(revised.titles.en, 'Title en');
});
