'use strict';
/**
 * i18n article orchestration shared by autopilot (generate) and publish (revise).
 *
 * Long-form articles (~2000 words/language) are unreliable to produce as one
 * 4-language JSON blob, so we:
 *   1. write the article once in a primary language (default RU),
 *   2. localize it into the other languages (one call each),
 *   3. assemble + validate the {titles, excerpts, bodies} shape.
 *
 * The LLM call is injected as `ask(prompt) -> Promise<string>` so this module
 * is fully unit-testable without spawning `claude`.
 */
const core = require('./core');

const PRIMARY = 'ru';
const DEFAULT_ATTEMPTS = 3;
const RETRY_BASE_MS = 12000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Run one unit (write or localize) with bounded retries + per-language validation.
async function produceLang({ lang, buildPrompt, ask, attempts, retryMs, logger }) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const text = await ask(buildPrompt());
      const unit = core.parseUnit(text);
      core.validateOneLang(unit, lang);
      return unit;
    } catch (err) {
      lastErr = err;
      logger?.log?.(`[blog] ${lang} attempt ${attempt}/${attempts} failed: ${err.message}`);
      if (attempt < attempts) await sleep(attempt * retryMs);
    }
  }
  throw new Error(`Article ${lang} failed after ${attempts} attempts: ${lastErr.message}`);
}

async function localizeOthers({ topic, primaryLang, source, ask, attempts, retryMs, logger }) {
  const perLang = { [primaryLang]: source };
  for (const lang of core.LANGS) {
    if (lang === primaryLang) continue;
    logger?.log?.(`[blog] localizing → ${lang}`);
    perLang[lang] = await produceLang({
      lang,
      buildPrompt: () => core.translatePrompt(topic, primaryLang, lang, source),
      ask, attempts, retryMs, logger,
    });
  }
  return perLang;
}

async function generateArticle({
  topic, ask, logger,
  primaryLang = PRIMARY,
  attemptsPerLang = DEFAULT_ATTEMPTS,
  retryMs = RETRY_BASE_MS,
}) {
  logger?.log?.(`[blog] writing ${primaryLang} body (~${core.TARGET_WORDS} words)`);
  const source = await produceLang({
    lang: primaryLang,
    buildPrompt: () => core.bodyPrompt(topic, primaryLang),
    ask, attempts: attemptsPerLang, retryMs, logger,
  });
  const perLang = await localizeOthers({ topic, primaryLang, source, ask, attempts: attemptsPerLang, retryMs, logger });
  const article = core.assembleArticle(perLang);
  core.validateArticle(article);
  return article;
}

async function reviseArticle({
  draft, feedback, ask, logger,
  primaryLang = PRIMARY,
  attemptsPerLang = DEFAULT_ATTEMPTS,
  retryMs = RETRY_BASE_MS,
}) {
  logger?.log?.(`[blog] revising ${primaryLang} from owner feedback`);
  const source = await produceLang({
    lang: primaryLang,
    buildPrompt: () => core.revisePrompt(draft, feedback, primaryLang),
    ask, attempts: attemptsPerLang, retryMs, logger,
  });
  const perLang = await localizeOthers({ topic: draft.topic, primaryLang, source, ask, attempts: attemptsPerLang, retryMs, logger });
  const article = core.assembleArticle(perLang);
  core.validateArticle(article);
  return article;
}

module.exports = { generateArticle, reviseArticle, PRIMARY };
