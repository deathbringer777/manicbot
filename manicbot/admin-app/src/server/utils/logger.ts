/**
 * Structured logger for the admin-app edge runtime (Cloudflare Pages / Next.js).
 *
 * Mirrors the worker's src/utils/logger.js API:
 *   log.info('scope', { key: value })
 *   log.warn('scope', { key: value })
 *   log.error('scope', err, { extra })
 *
 * PII redaction scrubs passwords, tokens, secrets, emails, and phone numbers
 * so that Cloudflare Logpush never receives raw credentials.
 */

const REDACTED_KEYS = new Set([
  "password", "passwordhash", "password_hash",
  "token", "secret", "apikey", "api_key", "bottoken", "bot_token",
  "webhooksecret", "webhook_secret", "encryptedtoken", "encrypted_token",
  "stripesecretkey", "stripe_secret_key", "googlerefreshtoken",
  "refresh_token", "accesstoken", "access_token",
  "authorization", "cookie", "x-telegram-init-data",
]);

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /\+?[0-9]{7,15}/g;
const BOT_TOKEN_RE = /\d{8,12}:[A-Za-z0-9_-]{35}/g;
const STRIPE_KEY_RE = /(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}/g;

function redactString(val: string): string {
  return val
    .replace(BOT_TOKEN_RE, "[bot_token]")
    .replace(STRIPE_KEY_RE, "[stripe_key]")
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]");
}

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 5) return "[max_depth]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactString(obj);
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = redact(v, depth + 1);
    }
  }
  return result;
}

function write(level: string, scope: string, data: unknown): void {
  const entry = { ts: new Date().toISOString(), level, scope, ...redact(data) as object };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (scope: string, data?: Record<string, unknown>) => write("info", scope, data ?? {}),
  warn: (scope: string, data?: Record<string, unknown>) => write("warn", scope, data ?? {}),
  debug: (scope: string, data?: Record<string, unknown>) => write("debug", scope, data ?? {}),
  error: (scope: string, err: unknown, extra?: Record<string, unknown>) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.slice(0, 400) : undefined;
    write("error", scope, { message, stack, ...extra });
  },
};
