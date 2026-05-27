/**
 * /api/subscribe (and alias /api/email-subscribe) — newsletter ingest.
 *
 * The landing page at manicbot.com hosts a "Stay in the loop" form. Pre-fix
 * the form posted to a non-existent /api/email-subscribe endpoint, got a
 * landing-SPA shell back with HTTP 200, and showed "Subscribed. Check your
 * inbox" — but no D1 row was created and no email was sent. Users were
 * subscribing into a void.
 *
 * Architecture (migration 0092 — double-opt-in):
 *   landing form -> Worker /api/subscribe
 *                -> D1 newsletter_subscribers (UPSERT idempotent on email)
 *                -> mint confirm_token (32-hex, 7d TTL)
 *                -> fire-and-forget POST to admin-app
 *                   /api/internal/newsletter-confirm
 *                -> admin-app calls Resend with the confirm-click link
 *
 * The Worker MUST NOT call Resend directly — Resend lives in admin-app and
 * its API key is a Pages secret, not a Worker secret. The Bearer token used
 * for the internal call is `INTERNAL_API_TOKEN` (shared with admin-app).
 *
 * The WELCOME email (post-confirm acknowledgement) is dispatched from
 * /confirm-subscription after the subscriber clicks the link — see
 * confirmSubscriptionHttp.js. That side mints an `unsubscribe_token`
 * and embeds it in the welcome's one-click unsub URL.
 *
 * Security model:
 *   * Allowlisted languages + sources + a strict email regex.
 *   * IP rate-limited 60/min via the same shared D1 limiter as /api/track.
 *   * Hard body cap (8 KB), method gate (POST only).
 *   * Always 202 on accept and on dedup — never leak whether an email was
 *     already subscribed (email-enumeration defense).
 *   * If INTERNAL_API_TOKEN or ADMIN_APP_URL is unset, the confirm step is
 *     a graceful no-op + welcome_send_error is stamped (column reused as
 *     the dispatch-error bucket for both confirm and welcome paths).
 *     Subscribe still returns 202 so the form UX never regresses on
 *     misconfiguration.
 */

import {
  SUBSCRIBE_RATE_LIMIT_MAX,
  SUBSCRIBE_RATE_LIMIT_WINDOW_MS,
  buildSubscriberInsertParams,
  parseSubscribePayload,
} from './subscribeHttpLogic.js';
import {
  generateNewsletterToken,
  CONFIRM_TOKEN_TTL_SEC,
} from '../services/newsletterTokens.js';
import { dbGet, dbRun } from '../utils/db.js';
import { checkAndIncrement } from '../utils/rateLimit.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

const MAX_BODY_BYTES = 8_192;
const SUBSCRIBE_RATE_LIMIT_WINDOW_SEC = Math.floor(
  SUBSCRIBE_RATE_LIMIT_WINDOW_MS / 1000,
);
const CONFIRM_PATH = '/api/internal/newsletter-confirm';
const CONFIRM_DISPATCH_TIMEOUT_MS = 6_000;

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

/**
 * Test-only seam: lets the vitest suite `vi.spyOn(__test,
 * 'mintConfirmTokenForTest')` to pin the exact CSPRNG output that lands
 * in the INSERT row + the dispatch body. Re-exported as `__test` at the
 * end of the file alongside other internal helpers.
 */
export const __test = {
  rateLimitOk,
  mintConfirmTokenForTest: () => generateNewsletterToken(),
  // `tryInsertSubscriber` and the SUBSCRIBE_RATE_LIMIT_WINDOW_SEC / CONFIRM_PATH
  // constants are attached at the bottom of the file once they are in scope.
};

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
 * Atomically insert a new subscriber. Returns
 * `{ inserted: boolean, confirmToken: string | null }`.
 *
 * `confirmToken` is the freshly minted DOI token for newly-inserted rows,
 * or `null` for dedup (existing row). Callers use it to dispatch the
 * confirm-click email; for dedup we deliberately don't re-mint or re-send.
 *
 * @param {{ DB: D1Database }} env
 * @param {ReturnType<typeof buildSubscriberInsertParams>} row
 */
async function tryInsertSubscriber(env, row) {
  // Pre-check + INSERT OR IGNORE. The pre-check short-circuits the confirm
  // dispatch for known duplicates; INSERT OR IGNORE is the actual durable
  // guard against two concurrent submits racing past the SELECT.
  //
  // We probe by `email` (not `id`) because we don't need the surrogate
  // key — we only care "does a row exist?". This also keeps the check
  // mock-friendly (some test mocks don't auto-fill AUTOINCREMENT ids).
  const existing = await dbGet(
    { db: env.DB },
    'SELECT email FROM newsletter_subscribers WHERE email = ?',
    row.email,
  );
  if (existing) return { inserted: false, confirmToken: null };

  const confirmToken = __test.mintConfirmTokenForTest();
  const confirmExpiresAt = row.createdAt + CONFIRM_TOKEN_TTL_SEC;

  const res = await dbRun(
    { db: env.DB },
    `INSERT OR IGNORE INTO newsletter_subscribers
       (email, source, lang, anonymous_id, ip, user_agent, created_at,
        confirm_token, confirm_token_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.email,
    row.source,
    row.lang,
    row.anonymousId,
    row.ip,
    row.userAgent,
    row.createdAt,
    confirmToken,
    confirmExpiresAt,
  );

  // D1 returns `meta.changes` for INSERTs. When the UNIQUE-collision path
  // fires inside INSERT OR IGNORE, `changes` is 0 and we treat that as a
  // dedup (race-loser).
  const changes =
    typeof res?.meta?.changes === 'number'
      ? res.meta.changes
      : typeof res?.changes === 'number'
        ? res.changes
        : 1; // default to "inserted" when the binding doesn't surface meta
  if (changes <= 0) return { inserted: false, confirmToken: null };
  return { inserted: true, confirmToken };
}

/**
 * Fire-and-forget: dispatch the CONFIRM-click email through the admin-app
 * internal endpoint. The handler never awaits the resulting Resend call;
 * the admin-app route does that internally.
 *
 * Failure modes (each stamps `welcome_send_error` on the row — column name
 * preserved from the single-opt-in era, now used as the generic dispatch
 * error bucket for both confirm and welcome paths):
 *   * env.ADMIN_APP_URL unset  -> 'admin_app_url_unset'
 *   * env.INTERNAL_API_TOKEN unset  -> 'internal_api_token_unset'
 *   * non-200 from admin-app  -> 'admin_app_<status>'
 *   * network/timeout         -> 'fetch_failed'
 *
 * Returns the dispatch-state string so callers can pin behavior in tests.
 */
export async function dispatchConfirmEmail(env, email, lang, confirmToken) {
  let errorCode = null;
  try {
    if (!env?.ADMIN_APP_URL) {
      errorCode = 'admin_app_url_unset';
    } else if (!env?.INTERNAL_API_TOKEN) {
      errorCode = 'internal_api_token_unset';
    } else {
      const base = String(env.ADMIN_APP_URL).replace(/\/$/, '');
      const url = `${base}${CONFIRM_PATH}`;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), CONFIRM_DISPATCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${env.INTERNAL_API_TOKEN}`,
          },
          body: JSON.stringify({ email, lang: lang ?? 'en', confirmToken }),
          signal: ac.signal,
        });
        if (!res.ok) {
          errorCode = `admin_app_${res.status}`;
        }
      } catch (e) {
        log.error(
          'subscribeHttp.dispatchConfirmEmail',
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
      'subscribeHttp.dispatchConfirmEmail.outer',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
    errorCode = errorCode || 'fetch_failed';
  }

  if (errorCode && env?.DB) {
    // Stamp the error on the subscriber row so ops can see misconfig in
    // a single SELECT. Wrapped in try/catch so a transient D1 fail doesn't
    // break the (already best-effort) dispatch.
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
        'subscribeHttp.dispatchConfirmEmail.stampError',
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
  });

  let inserted = false;
  let confirmToken = null;
  try {
    const ins = await tryInsertSubscriber(env, row);
    inserted = ins.inserted;
    confirmToken = ins.confirmToken;
  } catch (e) {
    // Persist failure is a hard error — we don't want to leak it back,
    // but we MUST log + return 500 so retry logic can decide what to do.
    log.error(
      'subscribeHttp.insert',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
    return new Response('internal error', { status: 500 });
  }

  if (inserted && confirmToken) {
    const confirm = dispatchConfirmEmail(env, row.email, row.lang, confirmToken);
    if (executionCtx?.waitUntil) {
      executionCtx.waitUntil(confirm);
    } else {
      // No waitUntil (legacy ctx, tests) — fall through awaiting it so
      // tests can observe the side effect.
      try {
        await confirm;
      } catch {
        // already logged inside dispatchConfirmEmail
      }
    }
  }

  // Always 202 — even on dedup — to avoid email-enumeration.
  return new Response(null, { status: 202 });
}

// Attach the helpers that were declared after the initial __test object.
__test.tryInsertSubscriber = tryInsertSubscriber;
__test.SUBSCRIBE_RATE_LIMIT_WINDOW_SEC = SUBSCRIBE_RATE_LIMIT_WINDOW_SEC;
__test.CONFIRM_PATH = CONFIRM_PATH;
