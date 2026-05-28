/**
 * GET /newsletter/unsubscribe?token=<32-hex>
 *
 * One-click unsubscribe for newsletter subscribers. Distinct from the
 * marketing-side `/unsubscribe` (manicbot/src/http/unsubscribeHttp.js)
 * which operates on `marketing_contacts.unsubscribe_token`. Keeping the
 * two routes separate avoids cross-table coupling — if either table
 * schema changes, the other handler is unaffected.
 *
 *   1. Validate token shape (32-64 lowercase hex).
 *   2. Look up `newsletter_subscribers` by `unsubscribe_token`.
 *   3. If `unsubscribed_at IS NOT NULL` → idempotent success page.
 *   4. Otherwise stamp `unsubscribed_at` and render success page.
 *
 * Token is INTENTIONALLY NOT cleared after use. A subscriber clicking
 * the same link twice should land on the same confirmation page, not a
 * "link invalid" error — UX before purity.
 *
 * Rate limit: shared 60/min D1 limiter by IP, same shape as
 * /confirm-subscription. Fail-open on limiter hiccups.
 *
 * Method gate: GET only — email clients always GET.
 */

import {
  parseTokenFromUrl,
  renderUnsubscribeSuccessPage,
  renderNewsletterErrorPage,
  resolvePageLang,
} from './newsletterDoiLogic.js';
import { dbGet, dbRun } from '../utils/db.js';
import { checkAndIncrement } from '../utils/rateLimit.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SEC = 60;

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

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleNewsletterUnsubscribeRequest(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  const ip = clientIp(request);
  if (env?.DB) {
    try {
      const r = await checkAndIncrement(
        { db: env.DB },
        ip,
        'newsletter_unsub',
        RATE_LIMIT_MAX,
        RATE_LIMIT_WINDOW_SEC,
      );
      if (r.limited) return htmlResponse('rate limited', 429);
    } catch (e) {
      log.error(
        'newsletterUnsubscribeHttp.rateLimit',
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
      `SELECT email, lang, unsubscribed_at
         FROM newsletter_subscribers
        WHERE unsubscribe_token = ?`,
      parsed.token,
    );
  } catch (e) {
    log.error(
      'newsletterUnsubscribeHttp.select',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
    return htmlResponse(renderNewsletterErrorPage('ru'), 500);
  }

  if (!row) {
    return htmlResponse(renderNewsletterErrorPage('ru'), 404);
  }

  const lang = resolvePageLang(row.lang);

  if (row.unsubscribed_at) {
    return htmlResponse(renderUnsubscribeSuccessPage(lang), 200);
  }

  try {
    await dbRun(
      { db: env.DB },
      `UPDATE newsletter_subscribers
          SET unsubscribed_at = ?
        WHERE email = ?`,
      nowSec(),
      row.email,
    );
  } catch (e) {
    log.error(
      'newsletterUnsubscribeHttp.update',
      e instanceof Error ? e : new Error(String(e?.message || e)),
    );
    return htmlResponse(renderNewsletterErrorPage(lang), 500);
  }

  return htmlResponse(renderUnsubscribeSuccessPage(lang), 200);
}
