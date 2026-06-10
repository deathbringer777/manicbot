#!/usr/bin/env node
/**
 * blog-autopilot.js — Nightly blog post generator for ManicBot.
 *
 * Architecture:
 *   1. Topic Discovery — Anthropic Claude generates 10 fresh topics (weekly)
 *   2. Article Generation — Anthropic Claude primary, Groq fallback
 *   3. Image Selection — keyword-matched from curated pool
 *   4. Deployment — writes to Cloudflare D1, falls back to local storage
 *
 * ENV (from ~/manicbot-backend/.env):
 *   ANTHROPIC_KEY (required) — Claude API key
 *   GROQ_KEY (optional) — fallback LLM
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID (optional — for D1 deploy)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { URL } = require('url');

const BASE_DIR = path.join(os.homedir(), 'manicbot-backend');
require('dotenv').config({ path: path.join(BASE_DIR, '.env') });

// ─── Config ──────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
let GROQ_KEY = process.env.GROQ_KEY;
if (!GROQ_KEY) {
  try {
    const envPath = path.join(os.homedir(), 'automation', 'tg-bot', '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^GROQ_KEY=(.+)$/m);
    if (match) GROQ_KEY = match[1].trim();
  } catch {}
}
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_DB = process.env.D1_DATABASE_ID;

const LOG_FILE = path.join(BASE_DIR, 'logs', 'blog-autopilot.log');
const STATE_FILE = path.join(BASE_DIR, 'marketing', 'blog-autopilot-state.json');
const TOPICS_FILE = path.join(BASE_DIR, 'marketing', 'blog-topics.json');
const ARTICLES_DIR = path.join(BASE_DIR, 'marketing', 'articles');

// ─── Curated image pool ──────────────────────────────────────────────────────
const IMAGE_POOL = [
  { url: 'https://images.unsplash.com/photo-1607779097040-26e80aa78e66?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['manicure', 'nails', 'beauty'] },
  { url: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['messenger', 'communication', 'app'] },
  { url: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['ai', 'robot', 'automation'] },
  { url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['pricing', 'money', 'business'] },
  { url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['analytics', 'data', 'charts'] },
  { url: 'https://images.unsplash.com/photo-1571290274554-6a2eaa771e5f?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['client', 'service', 'hands'] },
  { url: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['technician', 'work', 'salon'] },
  { url: 'https://images.unsplash.com/photo-1633681926022-84c23e8cb2d6?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['empty', 'chair', 'waiting'] },
  { url: 'https://images.unsplash.com/photo-1606327054629-64c8b0fd6e4f?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['calendar', 'schedule', 'google'] },
  { url: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=1600&q=80&auto=format&fit=crop', credit: 'Unsplash', keywords: ['whatsapp', 'instagram', 'chat'] },
  { url: 'https://images.pexels.com/photos/4960359/pexels-photo-4960359.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['nail', 'technician', 'client'] },
  { url: 'https://images.pexels.com/photos/7388966/pexels-photo-7388966.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['team', 'salon', 'staff'] },
  { url: 'https://images.pexels.com/photos/3183125/pexels-photo-3183125.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['laptop', 'analytics', 'desk'] },
  { url: 'https://images.pexels.com/photos/1303087/pexels-photo-1303087.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['gift', 'present', 'marketing'] },
  { url: 'https://images.pexels.com/photos/8886104/pexels-photo-8886104.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['phone', 'client', 'booking'] },
  { url: 'https://images.pexels.com/photos/3764649/pexels-photo-3764649.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['appointment', 'calendar', 'planner'] },
  { url: 'https://images.pexels.com/photos/3998391/pexels-photo-3998391.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['social', 'media', 'marketing'] },
  { url: 'https://images.pexels.com/photos/4101144/pexels-photo-4101144.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['smartphone', 'online', 'booking'] },
  { url: 'https://images.pexels.com/photos/4210355/pexels-photo-4210355.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['growth', 'success', 'business'] },
  { url: 'https://images.pexels.com/photos/4498124/pexels-photo-4498124.jpeg?auto=compress&cs=tinysrgb&w=1600', credit: 'Pexels', keywords: ['relax', 'spa', 'wellness'] },
];

// ─── Hardcoded fallback topics (when discovery fails) ────────────────────────
const FALLBACK_TOPICS = [
  { slug: 'booking-reminders-automation', category: 'tips',
    queryRu: 'напоминания о записи для nail-салона: как снизить неявки (no-show)',
    queryEn: 'automated booking reminders for nail salons: reduce no-shows',
    keywords: { ru: ['напоминания о записи', 'no-show салон', 'снижение неявок', 'автоматические напоминания'], ua: ['нагадування про запис', 'no-show салон', 'зниження неявок', 'автоматичні нагадування'], en: ['booking reminders', 'no-show salon', 'reduce missed appointments', 'automated reminders'], pl: ['przypomnienia o wizycie', 'no-show salon', 'zmniejszenie nieobecności', 'automatyczne przypomnienia'] } },
  { slug: 'instagram-direct-bookings', category: 'tips',
    queryRu: 'как настроить запись через Instagram Direct для салона красоты',
    queryEn: 'how to set up Instagram Direct booking for a beauty salon',
    keywords: { ru: ['Instagram Direct запись', 'салон красоты инстаграм', 'мессенджер запись'], ua: ['Instagram Direct запис', 'салон краси інстаграм', 'месенджер запис'], en: ['Instagram Direct booking', 'beauty salon Instagram', 'messenger booking'], pl: ['Instagram Direct rezerwacja', 'salon urody Instagram', 'rezerwacja przez komunikator'] } },
  { slug: 'client-feedback-loops', category: 'business',
    queryRu: 'сбор обратной связи от клиентов nail-салона: отзывы, опросы, аналитика',
    queryEn: 'client feedback for nail salons: reviews, surveys, analytics',
    keywords: { ru: ['обратная связь салон', 'отзывы клиентов', 'опрос клиентов nail-салона'], ua: ["зворотній зв'язок салон", 'відгуки клієнтів', 'опитування клієнтів nail-салону'], en: ['client feedback salon', 'customer reviews', 'nail salon surveys'], pl: ['informacje zwrotne salon', 'opinie klientów', 'ankiety salon paznokci'] } },
  { slug: 'staff-scheduling-software', category: 'business',
    queryRu: 'программы для управления расписанием сотрудников салона красоты',
    queryEn: 'staff scheduling software for beauty salons',
    keywords: { ru: ['расписание сотрудников салон', 'управление персоналом', 'график работы мастеров'], ua: ['розклад співробітників салон', 'управління персоналом', 'графік роботи майстрів'], en: ['staff scheduling salon', 'employee management', 'master schedule'], pl: ['harmonogram pracowników salon', 'zarządzanie personelem', 'grafik masterów'] } },
  { slug: 'online-booking-psychology', category: 'trends',
    queryRu: 'психология онлайн-записи: почему клиенты выбирают салон по кнопке "записаться"',
    queryEn: 'psychology of online booking: why clients choose a salon by the "book now" button',
    keywords: { ru: ['психология записи', 'онлайн бронирование', 'поведение клиентов'], ua: ['психологія запису', 'онлайн бронювання', 'поведінка клієнтів'], en: ['booking psychology', 'online reservation', 'client behavior'], pl: ['psychologia rezerwacji', 'rezerwacja online', 'zachowanie klientów'] } },
  { slug: 'work-hours-optimization', category: 'tips',
    queryRu: 'оптимальное рабочее время nail-салона: часы пик, выходные, продление',
    queryEn: 'optimal nail salon working hours: peak times, weekends, extended hours',
    keywords: { ru: ['рабочее время салона', 'часы пик салон', 'продление работы салона'], ua: ['робочий час салону', 'години пік салон', 'подовження роботи салону'], en: ['salon working hours', 'peak hours salon', 'extended salon hours'], pl: ['godziny pracy salonu', 'godziny szczytu salon', 'wydłużone godziny salonu'] } },
  { slug: 'loyalty-programs-nail', category: 'business',
    queryRu: 'программы лояльности для nail-салона: копилки, скидки, рефералы',
    queryEn: 'loyalty programs for nail salons: stamp cards, discounts, referrals',
    keywords: { ru: ['программа лояльности салон', 'копилка маникюр', 'скидки постоянным клиентам', 'реферальная программа'], ua: ['програма лояльності салон', 'скарбничка манікюр', 'знижки постійним клієнтам', 'реферальна програма'], en: ['loyalty program salon', 'stamp card manicure', 'repeat client discounts', 'referral program'], pl: ['program lojalnościowy salon', 'karta stałego klienta manicure', 'rabaty dla stałych klientów', 'program poleceń'] } },
  { slug: 'google-business-profile', category: 'tips',
    queryRu: 'Google Business Profile для салона красоты: как подняться в поиске',
    queryEn: 'Google Business Profile for beauty salons: how to rank higher',
    keywords: { ru: ['Google Business Profile салон', 'SEO салона красоты', 'продвижение салона в Google'], ua: ['Google Business Profile салон', 'SEO салону краси', 'просування салону в Google'], en: ['Google Business Profile salon', 'beauty salon SEO', 'salon Google ranking'], pl: ['Google Business Profile salon', 'SEO salonu urody', 'pozycjonowanie salonu Google'] } },
  { slug: 'mobile-app-vs-web-booking', category: 'trends',
    queryRu: 'мобильное приложение или веб-запись: что лучше для салона в 2026',
    queryEn: 'mobile app vs web booking: what is better for a salon in 2026',
    keywords: { ru: ['мобильное приложение запись', 'веб-виджет для салона', 'онлайн запись приложение'], ua: ['мобільний застосунок запис', 'веб-віджет для салону', 'онлайн запис застосунок'], en: ['mobile app booking', 'web widget salon', 'online booking app vs web'], pl: ['aplikacja mobilna rezerwacja', 'widget internetowy salon', 'rezerwacja online aplikacja vs web'] } },
  { slug: 'seasonal-nail-trends', category: 'trends',
    queryRu: 'сезонные тренды маникюра 2026: лето, осень, зима, весна',
    queryEn: 'seasonal nail trends 2026: summer, fall, winter, spring',
    keywords: { ru: ['тренды маникюра 2026', 'сезонный маникюр', 'модные цвета маникюра'], ua: ['тренди манікюру 2026', 'сезонний манікюр', 'модні кольори манікюру'], en: ['nail trends 2026', 'seasonal manicure', 'trendy nail colors'], pl: ['trendy paznokci 2026', 'sezonowy manicure', 'modne kolory paznokci'] } },
];

// ─── Utils ───────────────────────────────────────────────────────────────────
function timestamp() { return new Date().toISOString(); }
function log(msg) {
  const line = `[${timestamp()}] ${msg}\n`;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isJson = options.body && typeof options.body === 'object' &&
      options.headers && options.headers['Content-Type'] === 'application/json';
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      timeout: options.timeout || 180000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (isJson) req.write(JSON.stringify(options.body));
    else if (options.body && typeof options.body === 'string') req.write(options.body);
    req.end();
  });
}

// ─── 1. Topic Discovery (Anthropic) ──────────────────────────────────────────
async function discoverTopics() {
  fs.mkdirSync(path.dirname(TOPICS_FILE), { recursive: true });

  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8')); } catch {}
  const topics = Array.isArray(existing) ? existing : (existing.topics || []);

  // Check if we need refresh: empty topics or >7 days old
  const stat = fs.existsSync(TOPICS_FILE) ? fs.statSync(TOPICS_FILE) : null;
  const ageDays = stat ? (Date.now() - stat.mtimeMs) / 86400000 : 999;

  if (topics.length > 0 && ageDays < 7 && topics.some(t => t.slug)) {
    log(`Topics cache fresh: ${topics.length} topics, ${Math.round(ageDays)}d old`);
    return topics;
  }

  log('Generating fresh topics via Anthropic...');
  const season = getSeason();

  const prompt = `You are a content strategist for ManicBot — a SaaS platform that helps nail salons with online booking, AI receptionist, and marketing automation.

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

  const response = await callAnthropic(prompt, 0.9);
  let parsed;
  try { parsed = JSON.parse(response); } catch {
    // Try to extract JSON from markdown fences
    const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) try { parsed = JSON.parse(match[1]); } catch {}
  }

  const newTopics = parsed?.topics || parsed || [];
  if (!Array.isArray(newTopics) || newTopics.length < 3) {
    log('Topic discovery returned invalid data, keeping existing topics');
    return topics.length > 0 ? topics : FALLBACK_TOPICS;
  }

  // Validate and normalize
  const valid = newTopics.filter(t => t.slug && t.queryRu && t.queryEn).slice(0, 10);
  if (valid.length < 3) {
    log('Not enough valid topics, keeping fallback');
    return topics.length > 0 ? topics : FALLBACK_TOPICS;
  }

  fs.writeFileSync(TOPICS_FILE, JSON.stringify(valid, null, 2));
  log(`Generated ${valid.length} fresh topics`);
  return valid;
}

function getSeason() {
  const d = new Date();
  const m = d.getMonth();
  const y = d.getFullYear();
  if (m >= 2 && m <= 4) return `spring ${y}`;
  if (m >= 5 && m <= 7) return `summer ${y}`;
  if (m >= 8 && m <= 10) return `fall ${y}`;
  return `winter ${y}`;
}

// ─── 2. Pick topic (rotation) ────────────────────────────────────────────────
function pickTopic(discovered) {
  let state = { topicIndex: 0, lastRun: null, source: 'fallback', usedSlugs: [] };
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}

  const pool = (discovered && discovered.length > 0) ? discovered : FALLBACK_TOPICS;
  const source = (discovered && discovered.length > 0) ? 'discovered' : 'fallback';

  // If source changed, reset index
  if (state.source !== source) {
    state.topicIndex = 0;
    state.usedSlugs = [];
  }

  // Try to pick a topic not recently used
  let topic = null;
  const recentlyUsed = new Set(state.usedSlugs || []);

  for (let attempt = 0; attempt < pool.length * 2; attempt++) {
    const candidate = pool[state.topicIndex % pool.length];
    state.topicIndex = (state.topicIndex + 1) % pool.length;
    if (!recentlyUsed.has(candidate.slug) || recentlyUsed.size >= pool.length) {
      topic = candidate;
      break;
    }
  }

  if (!topic) topic = pool[0];

  // Track used slugs (keep last 5)
  state.usedSlugs = [...(state.usedSlugs || []), topic.slug].slice(-5);
  state.lastRun = timestamp();
  state.source = source;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  return topic;
}

// ─── 3. Anthropic Claude (primary LLM) ──────────────────────────────────────
async function callAnthropic(prompt, temperature = 0.7) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY not set');

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 32000,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  };

  const response = await httpJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    timeout: 180000,
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body,
  });

  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response);
    throw new Error(`Anthropic rate limited (${retryAfter}s)`);
  }
  if (response.status !== 200) {
    const errMsg = response.data?.error?.message || response.body || 'Unknown error';
    throw new Error(`Anthropic API error ${response.status}: ${errMsg}`);
  }

  const content = response.data?.content;
  if (!content || !Array.isArray(content) || !content[0]?.text) {
    throw new Error('Empty Anthropic response');
  }

  let text = content[0].text;

  // Strip markdown fences for JSON extraction
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  return text;
}

async function callGroq(prompt, model = GROQ_MODEL) {
  if (!GROQ_KEY) throw new Error('GROQ_KEY not set');

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 32000,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  };

  const response = await httpJson('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    timeout: 180000,
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response);
    throw new Error(`Groq rate limited (${retryAfter}s)`);
  }
  if (response.status !== 200) {
    throw new Error(`Groq API error ${response.status}: ${response.data?.error?.message || response.body}`);
  }

  let content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty Groq response');

  if (typeof content === 'string' && content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  return content;
}

function parseRetryAfter(response) {
  const h = response.headers?.['retry-after'] || response.headers?.['Retry-After'];
  if (h) return parseInt(h) || 60;
  const msg = response.data?.error?.message || '';
  const m = msg.match(/(\d+)m(\d+)s/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  const m2 = msg.match(/(\d+)s/);
  if (m2) return parseInt(m2[1]) || 60;
  return 60;
}

// ─── 4. Generate article (4 languages) ──────────────────────────────────────
async function generateArticle(topic) {
  const LANG = ['ru', 'ua', 'en', 'pl'];
  const LANG_NAMES = { ru: 'Russian', ua: 'Ukrainian', en: 'English', pl: 'Polish' };

  const prompt = `You are a blog writer for ManicBot — a SaaS platform that helps nail salons with online booking, AI receptionist, and marketing automation.

Write a blog article about: "${topic.queryEn}".

RULES:
- Write in PLAIN TEXT with paragraphs separated by double newlines. No Markdown (no ##, no **, no *).
- Write for salon owners in Poland, Ukraine, and Russian-speaking markets.
- Include practical tips and real numbers/statistics.
- Each language variant must be 400-600 words.
- Active voice, short paragraphs, practical tone.
- End with a soft CTA — mention ManicBot as a solution but don't make it the main focus.
- The article MUST be useful even if the reader never uses ManicBot.

Respond with valid JSON ONLY inside \`\`\`json ... \`\`\` fences. The JSON must match this EXACT structure:
{
  "titles": { "ru": "title", "ua": "title", "en": "title", "pl": "title" },
  "excerpts": { "ru": "short summary 1-2 sentences", "ua": "short summary", "en": "short summary", "pl": "short summary" },
  "bodies": { "ru": "full article text in Russian", "ua": "full article text in Ukrainian", "en": "full article text in English", "pl": "full article text in Polish" }
}

Each body must be 400-600 words of useful, practical content about "${topic.queryRu}".`;

  let lastError;
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const useGroq = attempt > 3;
    const provider = useGroq ? 'Groq' : 'Anthropic';

    try {
      let response;
      if (useGroq) {
        if (!GROQ_KEY) {
          lastError = 'GROQ_KEY not set, skipping Groq fallback';
          log(`Groq unavailable, skipping (attempt ${attempt}/${maxAttempts})`);
          continue;
        }
        response = await callGroq(prompt);
      } else {
        response = await callAnthropic(prompt);
      }

      const article = parseArticleJSON(response);
      validateArticle(article);
      return article;

    } catch (err) {
      lastError = err.message;
      if (attempt < maxAttempts) {
        const wait = Math.min(30, Math.pow(2, attempt)) * 1000;
        log(`${provider} error (attempt ${attempt}/${maxAttempts}): ${err.message} — retry in ${wait/1000}s`);
        await sleep(wait);
      }
    }
  }

  throw new Error(`All providers failed after ${maxAttempts} attempts: ${lastError}`);
}

function parseArticleJSON(text) {
  // Try JSON.parse directly first
  try { return JSON.parse(text); } catch {}

  // Try extracting from markdown fences
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }

  // Try finding JSON object in the text
  const braceMatch = text.match(/\{[\s\S]*"titles"[\s\S]*"bodies"[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }

  throw new Error('Could not parse JSON from LLM response');
}

function validateArticle(article) {
  const LANG = ['ru', 'ua', 'en', 'pl'];
  for (const lang of LANG) {
    if (!article.titles?.[lang]) throw new Error(`Missing title for ${lang}`);
    if (!article.excerpts?.[lang]) throw new Error(`Missing excerpt for ${lang}`);
    if (!article.bodies?.[lang]) throw new Error(`Missing body for ${lang}`);
  }
}

// ─── 5. Pick image ───────────────────────────────────────────────────────────
function pickImage(topic) {
  const words = (topic.queryRu + ' ' + topic.queryEn).toLowerCase().split(/\s+/);
  const scored = IMAGE_POOL.map((img, i) => {
    const matchCount = img.keywords.filter(kw => words.some(w => w.includes(kw) || kw.includes(w))).length;
    // Prefer images not used recently (random tiebreaker)
    return { img, score: matchCount, i };
  });
  scored.sort((a, b) => b.score - a.score || Math.random() - 0.5);
  const pick = scored[0].score > 0 ? scored[0] : scored[Math.floor(Math.random() * scored.length)];
  return pick.img;
}

// ─── 6. Deploy to D1 via Cloudflare API ──────────────────────────────────────
async function deployToD1(slug, topic, article, image) {
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().split('T')[0];
  const id = `blog_${now}_${slug}`;

  const row = {
    id,
    slug,
    status: 'published',
    category: topic.category,
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
    keywords_json: JSON.stringify(topic.keywords),
    related_slugs_json: JSON.stringify([]),
    published_date: today,
    updated_date: today,
    created_at: now,
    updated_at: now,
    published_at: now,
    archived_at: null,
    created_by_web_user_id: 'blog_autopilot',
    updated_by_web_user_id: 'blog_autopilot',
  };

  // Try D1 via CF API
  if (CF_ACCOUNT && CF_TOKEN && D1_DB) {
    try {
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `?${i + 1}`);
      const values = cols.map(k => row[k]);
      const sql = `INSERT OR IGNORE INTO blog_posts (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;

      const response = await httpJson(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_DB}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params: values }),
      });

      if (response.data?.success) {
        const meta = response.data?.result?.[0]?.meta || {};
        log(`D1 insert: changes=${meta.changes}, slug=${slug}`);
        return { method: 'd1', slug, id };
      }

      const errors = response.data?.errors || [{ message: 'Unknown error' }];
      log(`D1 insert failed: ${JSON.stringify(errors)}`);
      if (errors.some(e => e.code === 7500)) {
        log('CF API token lacks D1 write permission — falling back to local storage');
      }
    } catch (err) {
      log(`D1 HTTP error: ${err.message}`);
    }
  }

  // Fallback: save locally
  const articleFile = path.join(ARTICLES_DIR, `${slug}.json`);
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  fs.writeFileSync(articleFile, JSON.stringify(row, null, 2));
  log(`Saved locally: ${articleFile}`);
  return { method: 'local', file: articleFile, slug, id };
}

// ─── 7. Health check — test if D1 is reachable ─────────────────────────────
async function healthCheck() {
  const checks = [];
  checks.push(`Anthropic: ${ANTHROPIC_KEY ? 'key set' : 'NO KEY'}`);
  checks.push(`Anthropic model: ${ANTHROPIC_MODEL}`);

  if (CF_ACCOUNT && CF_TOKEN && D1_DB) {
    try {
      const response = await httpJson(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_DB}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${CF_TOKEN}` },
        timeout: 15000,
      });
      checks.push(`D1: ${response.data?.success ? 'OK' : 'FAIL'}`);
    } catch (err) {
      checks.push(`D1: FAIL (${err.message})`);
    }
  } else {
    checks.push('D1: SKIP (not configured)');
  }

  return checks;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  log('=== Blog Autopilot start ===');

  if (!ANTHROPIC_KEY) {
    log('ERROR: ANTHROPIC_KEY not found in .env');
    log('Add: ANTHROPIC_KEY=sk-ant-... to ~/manicbot-backend/.env');
    log('=== Blog Autopilot FAILED (no key) ===');
    process.exit(1);
  }

  try {
    // Step 0: Health check (lightweight)
    const health = await healthCheck();
    health.forEach(h => log(`  Health: ${h}`));

    // Step 1: Topic discovery (weekly refresh)
    const discovered = await discoverTopics();
    log(`Topics available: ${discovered.length}`);

    // Step 2: Pick topic
    const topic = pickTopic(discovered);
    log(`Topic: ${topic.slug} (${topic.category})${topic.queryRu ? ' — ' + topic.queryRu.slice(0, 60) : ''}`);

    // Step 3: Check slug uniqueness
    let slugExists = false;
    if (CF_ACCOUNT && CF_TOKEN && D1_DB) {
      try {
        const check = await httpJson(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_DB}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CF_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql: 'SELECT slug FROM blog_posts WHERE slug = ?1', params: [topic.slug] }),
          timeout: 15000,
        });
        slugExists = check.data?.result?.[0]?.results?.length > 0;
      } catch {}
    } else {
      // Check locally instead
      const localFile = path.join(ARTICLES_DIR, `${topic.slug}.json`);
      slugExists = fs.existsSync(localFile);
    }

    if (slugExists) {
      log(`Slug "${topic.slug}" exists — skipping to avoid dupes`);
      log(`=== Blog Autopilot done (skip, exists, ${Date.now() - start}ms) ===`);
      return;
    }

    // Step 4: Generate article
    log('Generating article via Anthropic Claude...');
    const article = await generateArticle(topic);
    const totalWords = ['ru', 'ua', 'en', 'pl'].reduce((sum, lang) =>
      sum + (article.bodies?.[lang]?.split(/\s+/).length || 0), 0);
    log(`Generated: ${totalWords} words across 4 languages`);

    // Step 5: Pick image
    const image = pickImage(topic);
    log(`Image: ${path.basename(image.url)} (${image.credit})`);

    // Step 6: Deploy
    log('Deploying...');
    const result = await deployToD1(topic.slug, topic, article, image);

    log(`Published: "${article.titles.ru}" (${topic.slug}) via ${result.method}`);
    log(`=== Blog Autopilot done (${Date.now() - start}ms) ===`);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    log(`=== Blog Autopilot FAILED (${Date.now() - start}ms) ===`);
    process.exit(1);
  }
}

main();
