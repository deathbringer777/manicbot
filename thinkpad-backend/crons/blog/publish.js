#!/usr/bin/env node
'use strict';
/**
 * Blog draft actions — invoked by the tg-bot callback handler (or manually):
 *
 *   node publish.js --slug <slug> --action publish
 *   node publish.js --slug <slug> --action skip
 *   node publish.js --slug <slug> --action revise --feedback "make it shorter"
 *
 * publish → INSERT OR IGNORE into D1 blog_posts, move draft → published/,
 *           confirm in Telegram.
 * skip    → move draft → skipped/.
 * revise  → regenerate via claude with the owner's feedback, save the new
 *           draft and re-send the preview with buttons.
 *
 * Prints a one-line JSON result to stdout; non-zero exit + stderr on failure
 * so the bot can relay errors verbatim.
 */
const path = require('path');
const { BASE_DIR } = require('../../lib/log');
require('dotenv').config({ path: path.join(BASE_DIR, '.env'), quiet: true });

const { createLogger } = require('../../lib/log');
const { createTg, escapeHtml } = require('../../lib/tg');
const { askClaude } = require('../../lib/claude');
const { createD1 } = require('../../lib/d1');
const core = require('./core');

const REVISE_TIMEOUT_MS = 10 * 60 * 1000;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--action') args.action = argv[++i];
    else if (argv[i] === '--feedback') args.feedback = argv[++i];
  }
  return args;
}

async function publishDraft(draft, { store, tg, d1, logger }) {
  const now = Math.floor(Date.now() / 1000);
  const row = core.buildRow({
    slug: draft.slug, topic: draft.topic, article: draft.article, image: draft.image, now,
  });

  let method = 'local';
  let changes = null;
  if (d1.isConfigured) {
    const cols = Object.keys(row);
    const placeholders = cols.map((_, i) => `?${i + 1}`);
    const sql = `INSERT OR IGNORE INTO blog_posts (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
    const meta = await d1.exec(sql, cols.map(k => row[k]));
    changes = meta.changes ?? null;
    method = 'd1';
    logger.log(`D1 insert: changes=${changes}, slug=${draft.slug}`);
  } else {
    logger.log('D1 not configured — keeping the article only in published/');
  }

  store.saveDraft({ ...draft, row, publishedAt: new Date().toISOString() });
  store.moveDraft(draft.slug, 'published');

  const dupNote = changes === 0 ? '\n⚠️ Slug уже был в D1 — вставка пропущена (IGNORE)' : '';
  await tg.sendMessage(
    `✅ Опубликовано: <b>${escapeHtml(draft.article.titles.ru)}</b>\n🏷 <code>${escapeHtml(draft.slug)}</code> · via ${method}${dupNote}`,
  );
  return { ok: true, action: 'publish', slug: draft.slug, method, changes };
}

async function skipDraft(draft, { store, tg }) {
  store.moveDraft(draft.slug, 'skipped');
  await tg.sendMessage(`⏭ Черновик пропущен: <code>${escapeHtml(draft.slug)}</code>`);
  return { ok: true, action: 'skip', slug: draft.slug };
}

async function reviseDraft(draft, feedback, { store, tg, logger }) {
  if (!feedback || !feedback.trim()) throw new Error('revise requires --feedback text');
  logger.log(`Revising ${draft.slug}: "${feedback.slice(0, 120)}"`);

  const out = await askClaude(core.revisePrompt(draft, feedback), {
    json: true, timeoutMs: REVISE_TIMEOUT_MS,
  });
  core.validateArticle(out.json);

  const revised = {
    ...draft,
    article: out.json,
    revisions: [...(draft.revisions || []), { feedback, at: new Date().toISOString() }],
  };
  store.saveDraft(revised);

  const text = `✏️ Черновик переделан (правка №${revised.revisions.length}):\n\n${core.buildPreviewText(revised)}`;
  const keyboard = core.buildPreviewKeyboard(revised.slug);
  try {
    await tg.sendPhoto(revised.image.url, text, { keyboard });
  } catch {
    await tg.sendMessage(text, { keyboard });
  }
  return { ok: true, action: 'revise', slug: draft.slug, revisions: revised.revisions.length };
}

async function main(argv = process.argv.slice(2)) {
  const { slug, action, feedback } = parseArgs(argv);
  if (!slug || !action) throw new Error('usage: publish.js --slug <slug> --action publish|skip|revise [--feedback "..."]');

  const logger = createLogger('blog-actions');
  const store = core.createDraftStore();
  const tg = createTg();
  const d1 = createD1();

  let draft;
  try {
    draft = store.loadDraft(slug);
  } catch {
    throw new Error(`Draft not found: ${slug} (already published/skipped?)`);
  }

  const ctx = { store, tg, d1, logger };
  switch (action) {
    case 'publish': return publishDraft(draft, ctx);
    case 'skip': return skipDraft(draft, ctx);
    case 'revise': return reviseDraft(draft, feedback, ctx);
    default: throw new Error(`Unknown action: ${action}`);
  }
}

if (require.main === module) {
  main()
    .then((result) => { process.stdout.write(JSON.stringify(result) + '\n'); })
    .catch((err) => { process.stderr.write(`${err.message}\n`); process.exit(1); });
}

module.exports = { main, parseArgs, publishDraft, skipDraft, reviseDraft };
