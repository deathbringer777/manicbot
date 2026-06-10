'use strict';
/**
 * Pure logic of the blog pipeline v2 (autopilot + Telegram approval).
 * Everything here is deterministic and unit-tested: prompt builders,
 * LLM-output validation, D1 row building, image pick, TG preview, the
 * on-disk draft store. Network and `claude` live in autopilot.js/publish.js.
 */
const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../../lib/tg');
const { BASE_DIR } = require('../../lib/log');
const { IMAGE_POOL, FALLBACK_TOPICS } = require('./data');

const LANGS = ['ru', 'ua', 'en', 'pl'];
const LANG_NAMES = { ru: 'Russian', ua: 'Ukrainian', en: 'English', pl: 'Polish' };
// Long-form target: ~2000 words PER language. Articles are written once and
// localized (i18n), so each language carries the full ~2000-word body.
const TARGET_WORDS = 2000;
const MIN_BODY_WORDS = 1500;
const MAX_BODY_WORDS = 2800;

// ─── Time ─────────────────────────────────────────────────────────────────────

function getSeason(date = new Date()) {
  const m = date.getMonth();
  const y = date.getFullYear();
  if (m >= 2 && m <= 4) return `spring ${y}`;
  if (m >= 5 && m <= 7) return `summer ${y}`;
  if (m >= 8 && m <= 10) return `fall ${y}`;
  return `winter ${y}`;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function topicDiscoveryPrompt(season) {
  return `You are a content strategist for ManicBot — a SaaS platform that helps nail salons with online booking, AI receptionist, and marketing automation.

Generate EXACTLY 10 blog topic ideas for nail salon owners. Current season: ${season}.

EACH topic must have:
- slug: URL-friendly kebab-case (unique, max 50 chars)
- category: one of "tips", "business", "trends", "marketing", "tech"
- queryRu: Russian query/angle (1 sentence, max 200 chars)
- queryEn: English query/angle (1 sentence, max 200 chars)
- keywords: object with ru, ua, en, pl arrays (3-5 keywords each, in the respective language)

Cover themes like: client acquisition, team management, pricing, social media, automation, seasonal campaigns, competition, customer retention, Google ranking, Instagram marketing, WhatsApp for business.

IMPORTANT: Return ONLY valid JSON. No markdown fences, no other text. The exact structure:
{"topics": [
  {"slug": "...", "category": "...", "queryRu": "...", "queryEn": "...", "keywords": {"ru": ["...", "..."], "ua": ["...", "..."], "en": ["...", "..."], "pl": ["...", "..."]}},
  ...
]}`;
}

// Write the article ONCE, in a single language, ~2000 words. Asking for all
// four languages in one JSON would be ~8000 words → unreliable to parse; we
// generate one body and localize the rest (see translatePrompt).
function bodyPrompt(topic, lang = 'ru') {
  const langName = LANG_NAMES[lang] || 'Russian';
  return `You are an expert blog writer for ManicBot — a SaaS platform that helps nail salons with online booking, an AI receptionist, and marketing automation.

Write ONE in-depth, genuinely useful blog article in ${langName} about: "${topic.queryEn}".

RULES:
- Language: ${langName}. Write natively, not translated.
- Length: about ${TARGET_WORDS} words (between ${MIN_BODY_WORDS} and ${MAX_BODY_WORDS}). This is a long-form pillar article — go deep.
- Audience: nail-salon owners in Poland, Ukraine, and Russian-speaking markets.
- Structure: a strong intro, 5-8 themed sections (each a few paragraphs), and a conclusion. Use a plain-text section heading line before each section.
- Include concrete, practical advice, realistic numbers/statistics, examples, and step-by-step tips.
- PLAIN TEXT only: paragraphs separated by double newlines, headings on their own line. NO Markdown (no #, no **, no bullets with * or -).
- Active voice, practical tone, no fluff. Must be useful even to a reader who never uses ManicBot.
- End with a soft CTA mentioning ManicBot as one solution, not the main focus.

Respond with valid JSON ONLY (no markdown fences), this EXACT single-object shape:
{"title": "...", "excerpt": "1-2 sentence summary", "body": "the full ~${TARGET_WORDS}-word article in ${langName}"}`;
}

// Localize an already-written article into another language, keeping length,
// structure and facts but adapting phrasing and SEO keywords to that market.
function translatePrompt(topic, fromLang, toLang, source) {
  const fromName = LANG_NAMES[fromLang] || fromLang;
  const toName = LANG_NAMES[toLang] || toLang;
  return `You are a senior localization editor for ManicBot (nail-salon SaaS).

Below is a long-form blog article written in ${fromName} (as JSON). Localize it into ${toName} for nail-salon owners in that market.

Source (${fromName}):
${JSON.stringify(source)}

RULES:
- Produce natural, native ${toName} — localize, do NOT translate word-for-word. Adapt idioms, examples and SEO keywords to the ${toName}-speaking market.
- Keep the SAME structure, section count and approximate length (~${TARGET_WORDS} words, between ${MIN_BODY_WORDS} and ${MAX_BODY_WORDS}).
- Keep all facts, numbers and the soft ManicBot CTA.
- PLAIN TEXT only, no Markdown.

Respond with valid JSON ONLY (no fences), this EXACT shape:
{"title": "...", "excerpt": "1-2 sentence summary in ${toName}", "body": "the full localized article in ${toName}"}`;
}

function revisePrompt(draft, feedback, lang = 'ru') {
  const langName = LANG_NAMES[lang] || 'Russian';
  const source = {
    title: draft.article.titles[lang],
    excerpt: draft.article.excerpts[lang],
    body: draft.article.bodies[lang],
  };
  return `You are an editor revising a long-form ${langName} blog article for ManicBot (nail-salon SaaS).

Current article (${langName}, as JSON):
${JSON.stringify(source)}

Revision instructions from the owner:
"${feedback}"

Keep plain-text format (no Markdown), keep it long-form (~${TARGET_WORDS} words), keep the soft ManicBot CTA.
Respond with valid JSON ONLY, the EXACT shape: {"title": "...", "excerpt": "...", "body": "..."}`;
}

// ─── Parsing & validation ─────────────────────────────────────────────────────

function parseArticleJSON(text) {
  const raw = String(text ?? '');
  try { return JSON.parse(raw); } catch { /* keep trying */ }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* keep trying */ }
  }
  const brace = raw.match(/\{[\s\S]*"titles"[\s\S]*"bodies"[\s\S]*\}/);
  if (brace) {
    try { return JSON.parse(brace[0]); } catch { /* fall through */ }
  }
  throw new Error('Could not parse article JSON from LLM response');
}

function validateArticle(article) {
  for (const lang of LANGS) {
    if (!article?.titles?.[lang]) throw new Error(`Missing title for ${lang}`);
    if (!article?.excerpts?.[lang]) throw new Error(`Missing excerpt for ${lang}`);
    const body = article?.bodies?.[lang];
    if (!body) throw new Error(`Missing body for ${lang}`);
    const words = String(body).trim().split(/\s+/).length;
    if (words < MIN_BODY_WORDS) throw new Error(`Body for ${lang} is too short (${words} words)`);
    if (words > MAX_BODY_WORDS) throw new Error(`Body for ${lang} is too long (${words} words)`);
  }
  return true;
}

// Validate a single-language {title, excerpt, body} object (one i18n unit).
function validateOneLang(obj, lang) {
  if (!obj?.title) throw new Error(`Missing title for ${lang}`);
  if (!obj?.excerpt) throw new Error(`Missing excerpt for ${lang}`);
  if (!obj?.body) throw new Error(`Missing body for ${lang}`);
  const words = String(obj.body).trim().split(/\s+/).length;
  if (words < MIN_BODY_WORDS) throw new Error(`Body for ${lang} is too short (${words} words, need ~${TARGET_WORDS})`);
  if (words > MAX_BODY_WORDS) throw new Error(`Body for ${lang} is too long (${words} words)`);
  return true;
}

// Parse a single-language {title, excerpt, body} object from an LLM response.
function parseOneJSON(text) {
  const raw = String(text ?? '');
  try { return JSON.parse(raw); } catch { /* keep trying */ }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* keep trying */ }
  }
  const brace = raw.match(/\{[\s\S]*"body"[\s\S]*\}/);
  if (brace) {
    try { return JSON.parse(brace[0]); } catch { /* fall through */ }
  }
  throw new Error('Could not parse single-language JSON from LLM response');
}

// Fold per-language {title,excerpt,body} units into the {titles,excerpts,bodies}
// shape the rest of the pipeline (buildRow, D1, preview) expects.
function assembleArticle(perLang) {
  const titles = {}, excerpts = {}, bodies = {};
  for (const lang of LANGS) {
    const u = perLang[lang] || {};
    titles[lang] = u.title;
    excerpts[lang] = u.excerpt;
    bodies[lang] = u.body;
  }
  return { titles, excerpts, bodies };
}

function validateTopics(topics) {
  if (!Array.isArray(topics)) return [];
  return topics
    .filter(t => t && t.slug && t.queryRu && t.queryEn)
    .slice(0, 10);
}

// ─── D1 row ───────────────────────────────────────────────────────────────────

function buildRow({ slug, topic, article, image, now, status = 'published' }) {
  const date = new Date(now * 1000).toISOString().split('T')[0];
  return {
    id: `blog_${now}_${slug}`,
    slug,
    status,
    category: topic.category || 'tips',
    cover_url: image.url,
    cover_alt_json: JSON.stringify({
      ru: `Иллюстрация к статье "${article.titles.ru}"`,
      ua: `Ілюстрація до статті "${article.titles.ua}"`,
      en: `Illustration for "${article.titles.en}"`,
      pl: `Ilustracja do artykułu "${article.titles.pl}"`,
    }),
    cover_credit: image.credit,
    titles_json: JSON.stringify(article.titles),
    excerpts_json: JSON.stringify(article.excerpts),
    bodies_json: JSON.stringify(article.bodies),
    keywords_json: JSON.stringify(topic.keywords || {}),
    related_slugs_json: JSON.stringify([]),
    published_date: date,
    updated_date: date,
    created_at: now,
    updated_at: now,
    published_at: now,
    archived_at: null,
    created_by_web_user_id: 'blog_autopilot',
    updated_by_web_user_id: 'blog_autopilot',
  };
}

// ─── Image pick ───────────────────────────────────────────────────────────────

function pickImage(topic, pool = IMAGE_POOL, rng = Math.random) {
  const words = `${topic.queryRu || ''} ${topic.queryEn || ''}`.toLowerCase().split(/\s+/);
  const scored = pool.map((img, i) => {
    const score = img.keywords.filter(kw => words.some(w => w.includes(kw) || kw.includes(w))).length;
    return { img, score, i };
  });
  scored.sort((a, b) => b.score - a.score || rng() - 0.5);
  const top = scored[0];
  if (top.score > 0) return top.img;
  return pool[Math.floor(rng() * pool.length)];
}

// ─── Telegram preview ─────────────────────────────────────────────────────────

function wordCounts(article) {
  return LANGS.map(l => `${l}:${String(article.bodies[l] || '').trim().split(/\s+/).length}`).join(' ');
}

function buildPreviewText(draft) {
  const { topic, article, image, slug } = draft;
  return [
    `📝 <b>${escapeHtml(article.titles.ru)}</b>`,
    '',
    escapeHtml(article.excerpts.ru),
    '',
    `🏷 <code>${escapeHtml(slug)}</code> · ${escapeHtml(topic.category || 'tips')}`,
    `📊 Слова: ${wordCounts(article)}`,
    `🖼 Обложка: ${escapeHtml(image.credit)}`,
  ].join('\n');
}

function buildPreviewKeyboard(slug) {
  // "Читать целиком" lets the owner read the full article in Telegram before
  // deciding — the preview above shows only the excerpt. The bot renders the
  // full body (commands/blog.js handles blog:read / blog:rl).
  return [
    [{ text: '📖 Читать целиком', callback_data: `blog:read:${slug}` }],
    [{ text: '✅ Опубликовать', callback_data: `blog:pub:${slug}` }],
    [
      { text: '✏️ Переделать', callback_data: `blog:rev:${slug}` },
      { text: '⏭ Пропустить', callback_data: `blog:skip:${slug}` },
    ],
  ];
}

// ─── Topic rotation (state shape identical to v1) ─────────────────────────────

const TOPIC_CACHE_TTL_DAYS = 7;
const USED_SLUGS_KEPT = 5;

function pickTopicFromPool(state, pool, source) {
  const s = { topicIndex: 0, usedSlugs: [], ...state };
  if (s.source !== source) {
    s.topicIndex = 0;
    s.usedSlugs = [];
  }
  let topic = null;
  const recentlyUsed = new Set(s.usedSlugs || []);
  for (let attempt = 0; attempt < pool.length * 2; attempt++) {
    const candidate = pool[s.topicIndex % pool.length];
    s.topicIndex = (s.topicIndex + 1) % pool.length;
    if (!recentlyUsed.has(candidate.slug) || recentlyUsed.size >= pool.length) {
      topic = candidate;
      break;
    }
  }
  if (!topic) topic = pool[0];
  s.usedSlugs = [...(s.usedSlugs || []), topic.slug].slice(-USED_SLUGS_KEPT);
  s.source = source;
  return { topic, state: s };
}

function shouldRefreshTopics(topics, mtimeMs, nowMs) {
  const ageDays = (nowMs - (mtimeMs || 0)) / 86400000;
  const usable = Array.isArray(topics) && topics.length > 0 && topics.some(t => t && t.slug);
  return !(usable && ageDays < TOPIC_CACHE_TTL_DAYS);
}

// ─── Draft store ──────────────────────────────────────────────────────────────

function createDraftStore(baseDir = BASE_DIR) {
  const root = path.join(baseDir, 'marketing', 'articles');
  const dirs = {
    drafts: path.join(root, 'drafts'),
    published: path.join(root, 'published'),
    skipped: path.join(root, 'skipped'),
  };

  function ensure() {
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  }

  function draftFile(slug) { return path.join(dirs.drafts, `${slug}.json`); }

  function saveDraft(draft) {
    ensure();
    fs.writeFileSync(draftFile(draft.slug), JSON.stringify(draft, null, 2));
    return draftFile(draft.slug);
  }

  function loadDraft(slug) {
    return JSON.parse(fs.readFileSync(draftFile(slug), 'utf8'));
  }

  function listPending() {
    ensure();
    return fs.readdirSync(dirs.drafts)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''))
      .sort();
  }

  function moveDraft(slug, dest) {
    if (!dirs[dest]) throw new Error(`Unknown draft destination: ${dest}`);
    ensure();
    fs.renameSync(draftFile(slug), path.join(dirs[dest], `${slug}.json`));
  }

  return { saveDraft, loadDraft, listPending, moveDraft, dirs };
}

module.exports = {
  LANGS, MIN_BODY_WORDS, MAX_BODY_WORDS,
  IMAGE_POOL, FALLBACK_TOPICS,
  getSeason,
  LANG_NAMES, TARGET_WORDS,
  topicDiscoveryPrompt, bodyPrompt, translatePrompt, revisePrompt,
  parseArticleJSON, parseOneJSON, validateArticle, validateOneLang, validateTopics,
  assembleArticle,
  buildRow, pickImage,
  buildPreviewText, buildPreviewKeyboard,
  pickTopicFromPool, shouldRefreshTopics,
  createDraftStore,
};
