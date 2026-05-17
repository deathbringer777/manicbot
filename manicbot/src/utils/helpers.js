import { L } from '../i18n.js';
import { VALID_LANGS } from '../config.js';

export function t(lang, key) { return L[lang]?.[key] ?? L.ru[key] ?? key; }
export function p2(n) { return String(n).padStart(2, '0'); }

/**
 * Safe parseInt — returns fallback (default NaN) when input is not a finite integer.
 */
export function safeParseInt(str, fallback = NaN) {
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function isCorrectionSvc(svcId) { return svcId === 'correction'; }

export function fmtEmoji(e) {
  return e && typeof e === 'string' && e.trim() ? e + ' ' : '';
}

export function svcName(ctx, lang, id) {
  const s = ctx.svc?.find(x => x.id === id);
  if (!s) return escHtml(id);
  return `${fmtEmoji(s.e)}${t(lang, 'svc_' + id)}`;
}

export function fill(str, vars) {
  let r = typeof str === 'string' ? str : str.join('\n');
  for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{${k}}`, v);
  return r;
}

export function detectLang(code) {
  if (!code) return null;
  const c = code.toLowerCase().slice(0, 2);
  if (c === 'uk') return 'ua';
  if (VALID_LANGS.has(c)) return c;
  return null;
}

/**
 * Telegram chat/user IDs are numeric. WhatsApp and Instagram use string identifiers
 * (phone digits or IGSID) that must not be passed through JS Number — large Instagram
 * IDs exceed Number.MAX_SAFE_INTEGER and would corrupt KV / D1 lookups.
 */
/** Meta IGSID / WA ids can be long strings; keep numeric-only to match Telegram-style ids. */
const OMNICHANNEL_CHAT_ID_RE = /^\+?[0-9]{1,64}$/;

export function isValidChatId(id) {
  if (typeof id === 'number' && Number.isFinite(id) && id !== 0) return true;
  if (typeof id === 'string' && OMNICHANNEL_CHAT_ID_RE.test(id)) return true;
  return false;
}

/**
 * Parse comma-separated trigger substrings from Worker secret INSTAGRAM_AI_TRIGGER.
 * @param {string|undefined|null} raw
 * @returns {string[]} lowercased non-empty tokens
 */
export function parseInstagramAiTriggers(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  return String(raw)
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * If Instagram channel and triggers are configured, text must contain at least one trigger substring.
 * @param {{ channel?: { type?: string }, INSTAGRAM_AI_TRIGGER?: string }} ctxOrEnv
 * @param {string} txt
 * @returns {boolean} true when handleAIChat may run for this message
 */
export function instagramAiTriggerAllows(ctxOrEnv, txt) {
  if (ctxOrEnv?.channel?.type !== 'instagram') return true;
  const triggers = parseInstagramAiTriggers(ctxOrEnv?.INSTAGRAM_AI_TRIGGER);
  if (triggers.length === 0) return true;
  const lower = String(txt ?? '').toLowerCase();
  return triggers.some(t => t.length > 0 && lower.includes(t));
}

/**
 * Short DM openers on Instagram/WhatsApp (users rarely type /start).
 * Used to route to welcome/home without hitting AI first.
 * @param {string} txt
 */
export function isLooseOmnichannelGreeting(txt) {
  const s = String(txt ?? '').trim();
  if (!s || s.length > 48) return false;
  if (s.startsWith('/')) return false;
  return /^(привет|привіт|здравствуйте|здрасте|хай|hi+|hello|hey|yo|добрый\s+(день|вечер|утро)|good\s+(morning|afternoon|evening)|вітаю|witam|cześć|servus)[.!?…\s]*$/iu.test(s);
}
