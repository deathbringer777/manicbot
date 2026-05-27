/**
 * /api/subscribe (and alias /api/email-subscribe) — newsletter ingest.
 *
 * The landing page at manicbot.com hosts a "Stay in the loop" form. Pre-fix
 * the form posted to a non-existent /api/email-subscribe endpoint, got a
 * landing-SPA shell back with HTTP 200, and showed "Subscribed. Check your
 * inbox" — but no D1 row was created and no email was sent. Users were
 * subscribing into a void.
 *
 * Architecture:
 *   landing form -> Worker /api/subscribe
 *                -> D1 newsletter_subscribers (UPSERT idempotent on email)
 *                -> fire-and-forget POST to admin-app
 *                   /api/internal/newsletter-welcome
 *                -> admin-app calls Resend, stamps welcome_sent_at
 *
 * The Worker MUST NOT call Resend directly — Resend lives in admin-app and
 * its API key is a Pages secret, not a Worker secret. The Bearer token used
 * for the internal call is `INTERNAL_API_TOKEN` (new secret, present on
 * both Worker and Pages).
 *
 * Security model:
 *   * Allowlisted languages + sources + a strict email regex.
 *   * IP rate-limited 60/min via the same shared D1 limiter as /api/track.
 *   * Hard body cap (8 KB), method gate (POST only).
 *   * Always 202 on accept and on dedup — never leak whether an email was
 *     already subscribed (email-enumeration defense).
 *   * If INTERNAL_API_TOKEN or ADMIN_APP_URL is unset, the welcome step is
 *     a graceful no-op + welcome_send_error is stamped. Subscribe still
 *     returns 202 so the form UX never regresses on misconfiguration.
 */

import {
  SUBSCRIBE_RATE_LIMIT_MAX,
  SUBSCRIBE_RATE_LIMIT_WINDOW_MS,
  buildSubscriberInsertParams,
  generateUnsubscribeToken,
  parseSubscribePayload,
} from './subscribeHttpLogic.js';
import { dbGet, dbRun } from '../utils/db.js';
import { checkAndIncrement } from '../utils/rateLimit.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

const MAX_BODY_BYTES = 8_192;
const SUBSCRIBE_RATE_LIMIT_WINDOW_SEC = Math.floor(
  SUBSCRIBE_RATE_LIMIT_WINDOW_MS / 1000,
);
const WELCOME_PATH = '/api/internal/newsletter-welcome';
const WELCOME_TIMEOUT_MS = 6_000;

async function rateLimitOk(env, ip) {
  if (!env?.DB) return true;
  try {
    const res = await checkAndIncrement(
      { db: env.DB },
      ip,
      'subscribe',
      SUBSCRIBE_RATE_LIMIT_MAX,
      SUBSCRIBE_RATE_LIMIT_WINDOW_SEC,
    );
    return !res.limited;
  } catch (e) {
    // Fail-open on limiter hiccups, identical to /api/track. A misbehaving
    // limiter must never block legitimate subscribers from reaching D1.
    log.error('subscribeHttp.rateLimit', e instanceof Error ? e : new Error(String(e)));
    return true;
  }
}

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
    'unknown'
  );
}

async function readBoundedJson(request) {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) return { ok: false, error: 'too_large' };
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, error: 'too_large' };
  if (text.length === 0) return { ok: false, error: 'empty' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'bad_json' };
  }
}

/**
 * Atomically insert a new subscriber. Returns one of:
 *   { kind: 'inserted', token }   — fresh subscriber, token freshly minted.
 *   { kind: 'reactivated', token } — previously unsubscribed, now active
 *                                    again; token re-used (stable).
 *   { kind: 'noop' }              — active row already exists; silent dedup.
 *
 * In all cases the public response is 202 — the kind drives the welcome
 * dispatch decision: 'inserted' and 'reactivated' fire welcome, 'noop' does
 * not.
 *
 * @param {{ DB: D1Database }} env
 * @param {ReturnType<typeof buildSubscriberInsertParams>} row
 */
async function tryInsertSubscriber(env, row) {
  // Pre-check by email. We need three columns to decide branch:
  //   - id (for the UPDATE in the reactivate path)
  //   - unsubscribed_at (active vs. previously-unsubscribed)
  //   - unsubscribe_token (token survives reactivate)
  const existing = await dbGet(
    { db: env.DB },
    'SELECT id, unsubscribed_at, unsubscribe_token FROM newsletter_subscribers WHERE email = ?',
    row.email,
  );

  if (existing) {
    if (existing.unsubscribed_at == null) {
      // Active subscriber → silent dedup, preserves email-enumeration defense.
      return { kind: 'noop' };
    }
    // Previously unsubscribed → reactivate. Token is stable when present
    // (covers the legacy-row case where 0090 backfill assigned one). On the
    // off chance the token is missing we mint a fresh one here as a self-heal
    // so the welcome can carry a working /u/ link.
    const token = existing.unsubscribe_token || generateUnsubscribeToken();
    // SQL kept on ONE line — the test mock-db UPDATE parser uses a single-line
    // regex (no `s` flag) and silently drops SET clauses after the first newline.
    await dbRun(
      { db: env.DB },
      'UPDATE newsletter_subscribers SET unsubscribed_at = ?, welcome_sent_at = ?, welcome_send_error = ?, unsubscribe_token = ? WHERE id = ?',
      null,
      null,
      null,
      token,
      existing.id,
    );
    return { kind: 'reactivated', token };
  }

  const res = await dbRun(
    { db: env.DB },
    `INSERT OR IGNORE INTO newsletter_subscribers
       (email, source, lang, anonymous_id, ip, user_agent, created_at, unsubscribe_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.email,
    row.source,
    row.lang,
    row.anonymousId,
    row.ip,
    row.userAgent,
    row.createdAt,
    row.unsubscribeToken,
  );

  // D1 returns `meta.changes` for INSERTs. When the UNIQUE-collision path
  // fires inside INSERT OR IGNORE, `changes` is 0 and we treat that as a
  // race-loser dedup (another isolate inserted between our SELECT and INSERT).
  const changes =
    typeof res?.meta?.changes === 'number'
      ? res.meta.changes
      : typeof res?.changes === 'number'
        ? res.changes
        : 1; // default to "inserted" when the binding doesn't surface meta
  return changes > 0
    ? { kind: 'inserted', token: row.unsubscribeToken }
    : { kind: 'noop' };
}

/**
 * Fire-and-forget: dispatch the welcome email through the admin-app
 * internal endpoint. The handler never awaits the resulting Resend call;
 * the admin-app route does that internally and stamps `welcome_sent_at`.
 *
 * Failure modes (each stamps `welcome_send_error` on the row):
 *   * env.ADMIN_APP_URL unset  -> 'admin_app_url_unset'
 *   * env.INTERNAL_API_TOKEN unset  -> 'internal_api_token_unset'
 *   * non-200 from admin-app  -> 'admin_app_<status>'
 *   * network/timeout         -> 'fetch_failed'
 *
 * Returns the welcome-state string so callers can pin behavior in tests.
 */
export async function dispatchWelcomeEmail(env, email, lang, unsubscribeToken) {
  let errorCode = null;
  try {
    if (!env?.ADMIN_APP_URL) {
      errorCode = 'admin_app_url_unset';
    } else if (!env?.INTERNAL_API_TOKEN) {
      errorCode = 'internal_api_token_unset';
    } else {
      const base = String(env.ADMIN_APP_URL).replace(/\/$/, '');
      const url = `${base}${WELCOME_PATH}`;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), WELCOME_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${env.INTERNAL_API_TOKEN}`,
          },
          body: JSON.stringify({
            email,
            lang: lang ?? 'en',
            unsubscribeToken,
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
          errorCode = `admin_app_${res.status}`;
        }
      } catch (e) {
        log.error(
          'subscribeHttp.dispatchWelcomeEmail',
          e instanceof Error ? e : new Error(String(e?.message || e)),
        );
        errorCode = 'fetch_failed';
      } finally {
        clearTimeout(t);
      }
    }
  } catch (e) {
    // Belt-and-braces — must never propagate to the caller.
    log.error(
      'subscribeHttp.dispatchWelcomeEmail.outer',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
    errorCode = errorCode || 'fetch_failed';
  }

  if (errorCode && env?.DB) {
    // Stamp the error on the subscriber row so ops can see misconfig in
    // a single SELECT. Wrapped in try/catch so a transient D1 fail doesn't
    // break the (already best-effort) welcome dispatch.
    try {
      await dbRun(
        { db: env.DB },
        `UPDATE newsletter_subscribers
            SET welcome_send_error = ?
          WHERE email = ?`,
        errorCode,
        email,
      );
    } catch (e) {
      log.error(
        'subscribeHttp.dispatchWelcomeEmail.stampError',
        e instanceof Error ? e : new Error(String(e?.message || e)),
      );
    }
  }
  return errorCode ?? 'sent';
}

/**
 * Public handler. Returns Response. 202 on accept/dedup, 400 on bad
 * payload, 405 on wrong method, 429 on rate limit.
 *
 * @param {Request} request
 * @param {any} env
 * @param {{ waitUntil?: (p:Promise<any>) => void } | undefined} executionCtx
 */
export async function handleSubscribeRequest(request, env, executionCtx) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const ip = clientIp(request);
  if (!(await rateLimitOk(env, ip))) {
    return new Response('rate limited', { status: 429 });
  }

  const body = await readBoundedJson(request);
  if (!body.ok) {
    return new Response('bad request', { status: 400 });
  }

  const parsed = parseSubscribePayload(body.value);
  if (!parsed.ok) {
    return new Response('bad request', { status: 400 });
  }

  if (!env?.DB) {
    // Without a DB binding we can't persist the row. Surface 503 so the
    // monitor catches it — but only after the parse/method/rate-limit
    // checks so the public failure modes are still 400/405/429.
    return new Response('storage unavailable', { status: 503 });
  }

  const row = buildSubscriberInsertParams(parsed.value, {
    ip,
    userAgent: request.headers.get('user-agent') || null,
    nowSec: nowSec(),
    unsubscribeToken: generateUnsubscribeToken(),
  });

  let dispatchToken = null;
  try {
    const ins = await tryInsertSubscriber(env, row);
    // 'inserted' = new row, fresh token; 'reactivated' = re-subscribe after
    // unsub, the token persists across the gap. Both branches fire welcome.
    // 'noop' = active row exists — silent dedup, no welcome.
    if (ins.kind === 'inserted' || ins.kind === 'reactivated') {
      dispatchToken = ins.token;
    }
  } catch (e) {
    // Persist failure is a hard error — we don't want to leak it back,
    // but we MUST log + return 500 so retry logic can decide what to do.
    log.error(
      'subscribeHttp.insert',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
    return new Response('internal error', { status: 500 });
  }

  if (dispatchToken) {
    const welcome = dispatchWelcomeEmail(env, row.email, row.lang, dispatchToken);
    if (executionCtx?.waitUntil) {
      executionCtx.waitUntil(welcome);
    } else {
      // No waitUntil (legacy ctx, tests) — fall through awaiting it so
      // tests can observe the side effect.
      try {
        await welcome;
      } catch {
        // already logged inside dispatchWelcomeEmail
      }
    }
  }

  // Always 202 — even on dedup — to avoid email-enumeration.
  return new Response(null, { status: 202 });
}

export const __test = {
  rateLimitOk,
  tryInsertSubscriber,
  SUBSCRIBE_RATE_LIMIT_WINDOW_SEC,
  WELCOME_PATH,
};
