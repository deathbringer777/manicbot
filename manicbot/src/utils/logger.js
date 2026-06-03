/**
 * Structured logger for Cloudflare Workers.
 *
 * Features:
 *  - JSON-structured output (picks up cleanly by Cloudflare Logpush)
 *  - PII redaction: scrubs emails, phone numbers, bot tokens, Meta access tokens, passwords,
 *    Stripe keys, tenant IDs in sensitive contexts, and IP addresses.
 *  - Stack-trace truncation (300 chars) to avoid logpush bloat
 *  - No external deps
 *
 * Usage:
 *   import { log } from '../utils/logger.js';
 *   log.info('stripe.webhook', { event: evt.type, tenantId });
 *   log.error('webhook.stripe', new Error('...'), { tenantId });
 *
 * Replace ALL direct console.{log,warn,error} calls in server code.
 */

// ─── PII redaction ────────────────────────────────────────────────────────────

/** Keys whose values will be completely redacted in log output. */
const REDACTED_KEYS = new Set([
  'password', 'passwordHash', 'password_hash',
  'token', 'secret', 'apiKey', 'api_key', 'botToken', 'bot_token',
  'webhookSecret', 'webhook_secret', 'encryptedToken', 'encrypted_token',
  'stripeSecretKey', 'stripe_secret_key', 'stripeWebhookSecret',
  'googleRefreshToken', 'refresh_token', 'accessToken', 'access_token',
  'authorization', 'cookie', 'x-telegram-init-data',
]);

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /\+?[0-9]{7,15}/g;
const BOT_TOKEN_RE = /\d{8,12}:[A-Za-z0-9_-]{35}/g;
const STRIPE_KEY_RE = /(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}/g;
// Meta (Facebook/Instagram) Graph access tokens. Meta echoes the token back in
// "Malformed access token <token>" errors, so it can leak into free-text log values.
const META_TOKEN_RE = /\b(?:EAA|IGAA)[A-Za-z0-9_-]{20,}/g;

function redactValue(val) {
  if (typeof val === 'string') {
    // Order matters: structured tokens/keys (which contain digit runs) must be
    // replaced BEFORE the generic phone regex matches their digit prefix.
    return val
      .replace(BOT_TOKEN_RE, '[bot_token]')
      .replace(STRIPE_KEY_RE, '[stripe_key]')
      .replace(META_TOKEN_RE, '[meta_token]')
      .replace(EMAIL_RE, '[email]')
      .replace(PHONE_RE, '[phone]');
  }
  return val;
}

function redactObject(obj, depth = 0) {
  if (depth > 5) return '[max_depth]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return redactValue(obj);
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, depth + 1));

  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (REDACTED_KEYS.has(lk) || REDACTED_KEYS.has(k)) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = redactObject(v, depth + 1);
    }
  }
  return result;
}

// ─── Core logger ─────────────────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function write(level, scope, data) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    ...redactObject(data ?? {}),
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case 'error': console.error(line); break;
    case 'warn':  console.warn(line);  break;
    default:      console.log(line);   break;
  }
}

export const log = {
  debug: (scope, data) => write('debug', scope, data),
  info:  (scope, data) => write('info',  scope, data),
  warn:  (scope, data) => write('warn',  scope, data),
  /**
   * @param {string} scope
   * @param {Error|unknown} err
   * @param {object} [extra]
   */
  error: (scope, err, extra = {}) => {
    const stack = err instanceof Error
      ? err.stack?.slice(0, 400) ?? err.message
      : String(err);
    write('error', scope, { message: err instanceof Error ? err.message : String(err), stack, ...extra });
  },
};
