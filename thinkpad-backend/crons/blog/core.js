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
const MIN_BODY_WORDS = 250;  // below this the article is garbage, not "concise"
const MAX_BODY_WORDS = 1200;

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

function articlePrompt(topic) {
  return `You are a blog writer for ManicBot — a SaaS platform that helps nail salons with online booking, AI receptionist, and marketing automation.

Write a blog article about: "${topic.queryEn}".

RULES:
- Write in PLAIN TEXT with paragraphs separated by double newlines. No Markdown (no ##, no **, no *).
- Write for salon owners in Poland, Ukraine, and Russian-speaking markets.
- Include practical tips and real numbers/statistics.
- Each language variant must be 400-600 words.
- Active voice, short paragraphs, practical tone.
- End with a soft CTA — mention ManicBot as a solution but don't make it the main focus.
- The article MUST be useful even if the reader never uses ManicBot.

Respond with valid JSON ONLY. The JSON must match this EXACT structure:
{
  "titles": { "ru": "title", "ua": "title", "en": "title", "pl": "title" },
  "excerpts": { "ru": "short summary 1-2 sentences", "ua": "short summary", "en": "short summary", "pl": "short summary" },
  "bodies": { "ru": "full article text in Russian", "ua": "full article text in Ukrainian", "en": "full article text in English", "pl": "full article text in Polish" }
}

Each body must be 400-600 words of useful, practical content about "${topic.queryRu}".`;
}

function revisePrompt(draft, feedback) {
  return `You are an editor revising a 4-language blog article for ManicBot (nail-salon SaaS).

Here is the current article as JSON:
${JSON.stringify({ titles: draft.article.titles, excerpts: draft.article.excerpts, bodies: draft.article.bodies })}

Revision instructions from the owner (apply them to ALL four languages, keep meaning consistent across languages):
"${feedback}"

Keep the same plain-text format (no Markdown), 400-600 words per body, soft ManicBot CTA at the end.
Respond with valid JSON ONLY in the exact same {"titles": {...}, "excerpts": {...}, "bodies": {...}} structure.`;
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
  topicDiscoveryPrompt, articlePrompt, revisePrompt,
  parseArticleJSON, validateArticle, validateTopics,
  buildRow, pickImage,
  buildPreviewText, buildPreviewKeyboard,
  pickTopicFromPool, shouldRefreshTopics,
  createDraftStore,
};
