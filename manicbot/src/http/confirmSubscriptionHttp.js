/**
 * GET /confirm-subscription?token=<32-hex>
 *
 * Closes the double-opt-in loop for newsletter subscribers:
 *
 *   1. Validate the token shape (32-64 lowercase hex).
 *   2. Look up the row by `confirm_token`.
 *   3. If `confirmed_at IS NOT NULL` → idempotent success page (re-click is
 *      a benign no-op, not an error).
 *   4. If `confirm_token_expires_at <= now` → expired page (link the user
 *      can resubscribe from).
 *   5. Otherwise:
 *      a. Mint a new `unsubscribe_token`.
 *      b. UPDATE row: stamp `confirmed_at`, clear `confirm_token`,
 *         clear `confirm_token_expires_at`, set `unsubscribe_token`.
 *      c. Fire-and-forget POST to admin-app
 *         /api/internal/newsletter-welcome with the new unsub token
 *         so the welcome email carries a working one-click unsub URL.
 *      d. Render success landing page.
 *
 * Rate limit: shared 60/min D1 limiter by IP (same key shape as /api/track
 * and /api/subscribe). On limiter hiccup we fail-open — never penalize a
 * legit confirm click with 429 because Redis equivalent had a bad day.
 *
 * Method gate: GET only. Email clients always GET on link click; we never
 * accept POST here so a misfired CSRF probe is a 405, not a quiet success.
 */

import {
  parseTokenFromUrl,
  renderConfirmSuccessPage,
  renderConfirmExpiredPage,
  renderNewsletterErrorPage,
  resolvePageLang,
} from './newsletterDoiLogic.js';
import { generateNewsletterToken } from '../services/newsletterTokens.js';
import { dbGet, dbRun } from '../utils/db.js';
import { checkAndIncrement } from '../utils/rateLimit.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SEC = 60;
const WELCOME_PATH = '/api/internal/newsletter-welcome';
const WELCOME_TIMEOUT_MS = 6_000;

// Indirection so the test suite can stub the CSPRNG and assert the exact
// token that lands in the UPDATE + welcome dispatch.
export const __test = {
  mintTokenForTest: () => generateNewsletterToken(),
};

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
    'unknown'
  );
}

function htmlResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function dispatchWelcomeWithUnsubToken(env, email, lang, unsubscribeToken) {
  if (!env?.ADMIN_APP_URL || !env?.INTERNAL_API_TOKEN) {
    log.error(
      'confirmSubscriptionHttp.welcome',
      new Error('missing env: ADMIN_APP_URL or INTERNAL_API_TOKEN'),
    );
    return;
  }
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
      body: JSON.stringify({ email, lang: lang ?? 'en', unsubscribeToken }),
      signal: ac.signal,
    });
    if (!res.ok) {
      log.error(
        'confirmSubscriptionHttp.welcome',
        new Error(`admin_app_${res.status}`),
      );
    }
  } catch (e) {
    log.error(
      'confirmSubscriptionHttp.welcome',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{ waitUntil?: (p:Promise<any>) => void } | undefined} executionCtx
 */
export async function handleConfirmSubscriptionRequest(request, env, executionCtx) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  // Rate limit FIRST — cheaper than D1, and bots that bash random tokens
  // shouldn't burn DB rows.
  const ip = clientIp(request);
  if (env?.DB) {
    try {
      const r = await checkAndIncrement(
        { db: env.DB },
        ip,
        'confirm_sub',
        RATE_LIMIT_MAX,
        RATE_LIMIT_WINDOW_SEC,
      );
      if (r.limited) return htmlResponse('rate limited', 429);
    } catch (e) {
      log.error(
        'confirmSubscriptionHttp.rateLimit',
        e instanceof Error ? e : new Error(String(e?.message || e)),
      );
      // fail-open
    }
  }

  const parsed = parseTokenFromUrl(request.url);
  if (!parsed.ok) {
    return htmlResponse(renderNewsletterErrorPage('ru'), 400);
  }

  if (!env?.DB) {
    return htmlResponse(renderNewsletterErrorPage('ru'), 503);
  }

  let row;
  try {
    row = await dbGet(
      { db: env.DB },
      `SELECT email, lang, confirm_token_expires_at, confirmed_at
         FROM newsletter_subscribers
        WHERE confirm_token = ?`,
      parsed.token,
    );
  } catch (e) {
    log.error(
      'confirmSubscriptionHttp.select',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
    return htmlResponse(renderNewsletterErrorPage('ru'), 500);
  }

  if (!row) {
    return htmlResponse(renderNewsletterErrorPage('ru'), 404);
  }

  const lang = resolvePageLang(row.lang);

  // Idempotent: already-confirmed re-click is success, not error.
  if (row.confirmed_at) {
    return htmlResponse(renderConfirmSuccessPage(lang), 200);
  }

  if (
    row.confirm_token_expires_at === null ||
    row.confirm_token_expires_at === undefined ||
    row.confirm_token_expires_at <= nowSec()
  ) {
    return htmlResponse(renderConfirmExpiredPage(lang), 410);
  }

  const unsubscribeToken = __test.mintTokenForTest();
  const confirmedAt = nowSec();

  try {
    await dbRun(
      { db: env.DB },
      `UPDATE newsletter_subscribers
          SET confirmed_at = ?,
              confirm_token = NULL,
              confirm_token_expires_at = NULL,
              unsubscribe_token = COALESCE(unsubscribe_token, ?)
        WHERE email = ?`,
      confirmedAt,
      unsubscribeToken,
      row.email,
    );
  } catch (e) {
    log.error(
      'confirmSubscriptionHttp.update',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
    return htmlResponse(renderNewsletterErrorPage(lang), 500);
  }

  const welcome = dispatchWelcomeWithUnsubToken(env, row.email, row.lang, unsubscribeToken);
  if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(welcome);
  } else {
    // tests / legacy ctx — await so the side effect is observable
    try {
      await welcome;
    } catch {
      // already logged
    }
  }

  return htmlResponse(renderConfirmSuccessPage(lang), 200);
}
