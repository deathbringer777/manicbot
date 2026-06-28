'use strict';
/**
 * `blog.generate` job handler — on-demand single blog-post DRAFT, reusing the
 * blog autopilot pipeline (crons/blog). It does NOT publish: it produces the
 * same draft + Telegram preview (Publish/Revise/Skip) the nightly cron does, so
 * approval still goes through the owner. The D1 `blog_posts` write happens only
 * when the owner taps "Опубликовать" (publish.js, via the bot callback).
 *
 * Non-conflicting with the cron: it honours the same implicit draft lock (any
 * pending draft in marketing/articles/drafts/ ⇒ refuse), so on-demand and the
 * 02:00 cron never generate two drafts at once.
 *
 * Deps are injected (askClaude, tg, logger, store, gen, discover, now) so the
 * orchestration is unit-testable without fs / network / the Claude CLI.
 */
const core = require('../crons/blog/core');
const { generateArticle } = require('../crons/blog/generate');

const BLOG_TIMEOUT_MS = 10 * 60 * 1000;     // 4-language body is slow
const DISCOVERY_TIMEOUT_MS = 5 * 60 * 1000;

/** Fresh topic discovery (no fs cache — on-demand), reusing core's pure pieces. */
async function discoverTopic(askClaude, logger) {
  const out = await askClaude(core.topicDiscoveryPrompt(core.getSeason()), {
    json: true, tools: '', permissionMode: 'default', timeoutMs: DISCOVERY_TIMEOUT_MS,
  });
  const valid = core.validateTopics(out.json?.topics || out.json);
  if (!valid.length) throw new Error('blog.generate: topic discovery returned no valid topics');
  logger?.log?.(`[blog.generate] discovered topic: ${valid[0].slug}`);
  return valid[0];
}

/**
 * @param {{ topic?: object }} payload - optional explicit topic; else auto-discover.
 * @param {{ askClaude, tg?, logger?, store?, gen?, discover?, now? }} deps
 * @returns {Promise<{ ok: true, slug: string }>}
 */
async function blogGenerate(payload = {}, deps = {}) {
  const {
    askClaude,
    tg,
    logger = { log() {} },
    store = core.createDraftStore(),
    gen = generateArticle,
    discover = discoverTopic,
    now = () => new Date().toISOString(),
  } = deps;
  if (!askClaude) throw new Error('blog.generate: askClaude dep required');

  // Respect the autopilot draft lock — never two drafts pending at once.
  const pending = store.listPending();
  if (pending.length) throw new Error(`blog.generate: draft lock — "${pending[0]}" awaiting approval`);

  const topic = payload.topic || await discover(askClaude, logger);

  // Tool-free generation (SEC-001 policy): blog prompts are trusted, but the ask
  // path stays no-tools / default permission like every other Claude call here.
  const ask = async (prompt) => (
    await askClaude(prompt, { timeoutMs: BLOG_TIMEOUT_MS, tools: '', permissionMode: 'default' })
  ).text;

  const article = await gen({ topic, ask, logger });

  const image = core.pickImage(topic);
  const draft = { slug: topic.slug, topic, article, image, createdAt: now(), revisions: [] };
  store.saveDraft(draft);
  logger.log(`[blog.generate] draft saved: ${draft.slug}`);

  if (tg && tg.configured) {
    const text = `🆕 On-demand черновик:\n\n${core.buildPreviewText(draft)}`;
    const keyboard = core.buildPreviewKeyboard(draft.slug);
    try { await tg.sendPhoto(image.url, text, { keyboard }); }
    catch { await tg.sendMessage(text, { keyboard }); }
  }
  return { ok: true, slug: draft.slug };
}

module.exports = { blogGenerate, discoverTopic };
