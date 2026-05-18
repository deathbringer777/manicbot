/**
 * Stable error_type slugs for channel-related captureError() calls.
 *
 * Why this exists: until PR 3 the IGHealthCard matched open errors via
 * substring search on the message text (`%instagram%`, `%OAuthException%`,
 * etc.). The matcher silently missed any error message that didn't include
 * the expected keyword, and translations into ru/ua/pl were impossible
 * because the surface displayed the raw English message.
 *
 * Callers now stamp a slug from this file on each captureError; the admin-app
 * queries `error_events` by `error_type IN (…)` and looks up the localized
 * label by slug in i18n.
 *
 * Slugs are public contract — renames are breaking changes for the dashboard.
 * Add new ones at the bottom; never re-use a removed slug.
 */
export const CHANNEL_ERROR_TYPE = Object.freeze({
  /** AES-GCM decrypt of channel_configs.token_encrypted failed (key rotated). */
  IG_TOKEN_DECRYPT: 'channel.ig.token_decrypt_failed',
  /** Page Access Token rejected by Graph (revoked / expired / not Page-typed). */
  IG_TOKEN_REJECTED: 'channel.ig.token_rejected',
  /** App is no longer in /{page_id}/subscribed_apps OR missing required fields. */
  IG_SUBSCRIPTION_LOST: 'channel.ig.subscription_lost',
  /** Channel-health probe blew up before completing (network / parse). */
  IG_HEALTH_PROBE_FAILED: 'channel.ig.health_probe_failed',
  /** Meta webhook signature didn't match either configured App Secret. */
  META_WEBHOOK_SIGNATURE_MISMATCH: 'channel.meta.signature_mismatch',
  /** /admin/ig-resubscribe could not re-register the Page webhook. */
  IG_RESUBSCRIBE_FAILED: 'channel.ig.resubscribe_failed',
  /** Outbound send returned code 190 / 200 → token is dead. */
  IG_INTEGRATION_NEEDS_REAUTH: 'channel.ig.needs_reauth',
});

/**
 * Slugs that the IGHealthCard treats as "the channel is broken".
 * Health state = `broken` whenever any of these is in `status='open'`.
 */
export const IG_BROKEN_ERROR_TYPES = Object.freeze([
  CHANNEL_ERROR_TYPE.IG_TOKEN_DECRYPT,
  CHANNEL_ERROR_TYPE.IG_TOKEN_REJECTED,
  CHANNEL_ERROR_TYPE.IG_INTEGRATION_NEEDS_REAUTH,
]);

/**
 * Slugs that indicate degraded but not fully broken state (warning).
 */
export const IG_DEGRADED_ERROR_TYPES = Object.freeze([
  CHANNEL_ERROR_TYPE.IG_SUBSCRIPTION_LOST,
  CHANNEL_ERROR_TYPE.IG_RESUBSCRIBE_FAILED,
  CHANNEL_ERROR_TYPE.META_WEBHOOK_SIGNATURE_MISMATCH,
  CHANNEL_ERROR_TYPE.IG_HEALTH_PROBE_FAILED,
]);

/** Combined: any IG error_type we care to surface. */
export const IG_ALL_ERROR_TYPES = Object.freeze([
  ...IG_BROKEN_ERROR_TYPES,
  ...IG_DEGRADED_ERROR_TYPES,
]);
