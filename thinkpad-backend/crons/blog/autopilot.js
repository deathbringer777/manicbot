#!/usr/bin/env node
'use strict';
/**
 * Blog Autopilot v2 — nightly draft generator with Telegram approval.
 *
 * 02:00 cron (PM2 cron_restart). Flow:
 *   1. If a draft is already awaiting approval → re-send the preview, exit.
 *   2. Refresh the topic pool weekly via `claude -p` (subscription, sonnet).
 *   3. Pick the next unused topic, generate a 4-language article via claude.
 *   4. Save the draft to marketing/articles/drafts/<slug>.json.
 *   5. Send a Telegram preview with Publish / Revise / Skip buttons.
 *
 * Publishing to D1 happens ONLY in publish.js after the owner taps a button
 * (the tg-bot callback handler shells out to it).
 */
const fs = require('fs');
const path = require('path');
const { BASE_DIR } = require('../../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { runCron } = require('../../lib/runner');
const { createTg } = require('../../lib/tg');
const { askClaude } = require('../../lib/claude');
const { createD1 } = require('../../lib/d1');
const core = require('./core');
const { generateArticle: generateLocalized } = require('./generate');

// Adapter: generate.js expects ask(prompt) -> text; claude returns an envelope.
async function askText(prompt) {
  const out = await askClaude(prompt, { timeoutMs: GENERATION_TIMEOUT_MS });
  return out.text;
}

const STATE_FILE = path.join(BASE_DIR, 'marketing', 'blog-autopilot-state.json');
const TOPICS_FILE = path.join(BASE_DIR, 'marketing', 'blog-topics.json');
const GEN_ATTEMPTS = 3;
const DISCOVERY_TIMEOUT_MS = 5 * 60 * 1000;
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

async function discoverTopics(logger) {
  let cached = readJson(TOPICS_FILE, []);
  cached = Array.isArray(cached) ? cached : (cached.topics || []);
  const mtime = fs.existsSync(TOPICS_FILE) ? fs.statSync(TOPICS_FILE).mtimeMs : 0;

  if (!core.shouldRefreshTopics(cached, mtime, Date.now())) {
    logger.log(`Topics cache fresh: ${cached.length} topics`);
    return cached;
  }

  logger.log('Refreshing topic pool via claude…');
  try {
    const out = await askClaude(core.topicDiscoveryPrompt(core.getSeason()), {
      json: true, timeoutMs: DISCOVERY_TIMEOUT_MS,
    });
    const valid = core.validateTopics(out.json?.topics || out.json);
    if (valid.length >= 3) {
      writeJson(TOPICS_FILE, valid);
      logger.log(`Generated ${valid.length} fresh topics`);
      return valid;
    }
    logger.log('Discovery returned too few valid topics — keeping cache/fallback');
  } catch (err) {
    logger.log(`Topic discovery failed: ${err.message} — using cache/fallback`);
  }
  return cached.length ? cached : core.FALLBACK_TOPICS;
}

async function generateArticle(topic, logger) {
  // i18n: write the ~2000-word body once (RU), then localize to ua/en/pl.
  return generateLocalized({ topic, ask: askText, logger, attemptsPerLang: GEN_ATTEMPTS });
}

async function slugExists(slug, store, d1, logger) {
  if (store.listPending().includes(slug)) return true;
  for (const dir of ['published', 'skipped']) {
    if (fs.existsSync(path.join(store.dirs[dir], `${slug}.json`))) return true;
  }
  if (d1.isConfigured) {
    try {
      const rows = await d1.query('SELECT slug FROM blog_posts WHERE slug = ?1', [slug]);
      return rows.length > 0;
    } catch (err) {
      logger.log(`D1 slug check failed (continuing without it): ${err.message}`);
    }
  }
  return false;
}

async function sendPreview(tg, draft, logger, { reminder = false } = {}) {
  const header = reminder ? '🔁 Черновик всё ещё ждёт решения:' : '🌙 Ночной черновик готов:';
  const text = `${header}\n\n${core.buildPreviewText(draft)}`;
  const keyboard = core.buildPreviewKeyboard(draft.slug);
  try {
    await tg.sendPhoto(draft.image.url, text, { keyboard });
  } catch (err) {
    logger.log(`sendPhoto failed (${err.message}) — falling back to text preview`);
    await tg.sendMessage(text, { keyboard });
  }
}

async function main(logger) {
  const tg = createTg();
  const store = core.createDraftStore();
  const d1 = createD1();

  const pending = store.listPending();
  if (pending.length > 0) {
    logger.log(`Drafts awaiting approval: ${pending.join(', ')} — reminding, not generating`);
    await sendPreview(tg, store.loadDraft(pending[0]), logger, { reminder: true });
    return;
  }

  const topics = await discoverTopics(logger);
  const source = topics === core.FALLBACK_TOPICS ? 'fallback' : 'discovered';

  let state = readJson(STATE_FILE, {});
  let chosen = null;
  for (let i = 0; i < topics.length; i++) {
    const r = core.pickTopicFromPool(state, topics, source);
    state = r.state;
    if (!(await slugExists(r.topic.slug, store, d1, logger))) {
      chosen = r.topic;
      break;
    }
    logger.log(`Slug already used: ${r.topic.slug} — rotating further`);
  }
  writeJson(STATE_FILE, { ...state, lastRun: new Date().toISOString() });

  if (!chosen) {
    logger.log('Every topic in the pool is already used — nothing to generate');
    await tg.sendMessage('ℹ️ Blog autopilot: все темы из пула уже использованы — на следующем запуске пул обновится');
    try { fs.unlinkSync(TOPICS_FILE); } catch { /* force refresh next run */ }
    return;
  }

  logger.log(`Topic: ${chosen.slug} (${chosen.category || 'tips'})`);
  const article = await generateArticle(chosen, logger);
  const image = core.pickImage(chosen);
  const draft = {
    slug: chosen.slug,
    topic: chosen,
    article,
    image,
    createdAt: new Date().toISOString(),
    revisions: [],
  };
  store.saveDraft(draft);
  logger.log(`Draft saved: ${draft.slug}`);
  await sendPreview(tg, draft, logger);
}

if (require.main === module) runCron('blog-autopilot', main);

module.exports = { main, discoverTopics, generateArticle, slugExists };
