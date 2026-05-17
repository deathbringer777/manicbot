/**
 * Review Collector plugin — worker-side helper.
 *
 * Called from the rating-callback handler in `src/handlers/callback.js`
 * AFTER `createReview` + the thank-you message. When a client rates 4★ or
 * 5★ AND the tenant has the review-collector plugin installed (enabled = 1)
 * AND at least one of `googleReviewUrl` / `yandexReviewUrl` is set in the
 * install's settings_json, this helper sends a follow-up Telegram message
 * with inline-button CTAs to the configured review URLs.
 *
 * Silent no-op in legacy single-bot mode (no ctx.tenantId), on rating < 4,
 * on missing plugin row, on empty URLs, or on any throw — the original
 * rating UX must never regress because the plugin failed.
 */

import { dbGet } from '../utils/db.js';
import { send } from '../telegram.js';

const DEFAULT_MESSAGE =
  '🙏 Спасибо за оценку! Если несложно, поделитесь отзывом — это сильно нам помогает.';

/**
 * @param {object} ctx — tenant context (must carry `tenantId` + `db`)
 * @param {string|number} cid — chat id to reply to
 * @param {number} rating — 1..5, only 4/5 trigger the CTA
 * @returns {Promise<boolean>} — true if a follow-up was actually sent
 */
export async function maybeSendReviewCta(ctx, cid, rating) {
  if (!Number.isFinite(rating) || rating < 4) return false;
  if (!ctx?.tenantId) return false;

  let row = null;
  try {
    row = await dbGet(
      ctx,
      `SELECT settings_json FROM plugin_installations
       WHERE tenant_id = ? AND plugin_slug = 'review-collector' AND enabled = 1
       LIMIT 1`,
      ctx.tenantId,
    );
  } catch {
    return false;
  }
  if (!row?.settings_json) return false;

  /** @type {{googleReviewUrl?: string; yandexReviewUrl?: string; customMessage?: string}} */
  let settings;
  try {
    settings = JSON.parse(row.settings_json);
  } catch {
    return false;
  }

  const google = typeof settings.googleReviewUrl === 'string' ? settings.googleReviewUrl.trim() : '';
  const yandex = typeof settings.yandexReviewUrl === 'string' ? settings.yandexReviewUrl.trim() : '';
  if (!google && !yandex) return false;

  const text = (typeof settings.customMessage === 'string' && settings.customMessage.trim()
    ? settings.customMessage
    : DEFAULT_MESSAGE
  ).slice(0, 280);

  const buttons = [];
  if (google) buttons.push([{ text: '⭐ Оставить отзыв в Google', url: google }]);
  if (yandex) buttons.push([{ text: '⭐ Оставить отзыв в Яндексе', url: yandex }]);

  try {
    await send(ctx, cid, text, { reply_markup: { inline_keyboard: buttons } });
    return true;
  } catch {
    return false;
  }
}
