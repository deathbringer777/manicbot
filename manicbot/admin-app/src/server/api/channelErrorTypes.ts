/**
 * Mirror of `manicbot/src/channels/error-types.js`. Kept in admin-app/server
 * so the router can query `error_events.error_type IN (…)` without reaching
 * across the Worker / admin-app boundary.
 *
 * Slugs are CONTRACT — any rename must land in both files in the same PR.
 * The 1-line pin in [src/__tests__/channel-error-types-parity.test.ts] keeps
 * the two lists in sync.
 */

export const CHANNEL_ERROR_TYPE = {
  IG_TOKEN_DECRYPT: "channel.ig.token_decrypt_failed",
  IG_TOKEN_REJECTED: "channel.ig.token_rejected",
  IG_SUBSCRIPTION_LOST: "channel.ig.subscription_lost",
  IG_HEALTH_PROBE_FAILED: "channel.ig.health_probe_failed",
  META_WEBHOOK_SIGNATURE_MISMATCH: "channel.meta.signature_mismatch",
  IG_RESUBSCRIBE_FAILED: "channel.ig.resubscribe_failed",
  IG_INTEGRATION_NEEDS_REAUTH: "channel.ig.needs_reauth",
} as const;

export type ChannelErrorTypeSlug = (typeof CHANNEL_ERROR_TYPE)[keyof typeof CHANNEL_ERROR_TYPE];

export const IG_BROKEN_ERROR_TYPES = [
  CHANNEL_ERROR_TYPE.IG_TOKEN_DECRYPT,
  CHANNEL_ERROR_TYPE.IG_TOKEN_REJECTED,
  CHANNEL_ERROR_TYPE.IG_INTEGRATION_NEEDS_REAUTH,
] as const;

export const IG_DEGRADED_ERROR_TYPES = [
  CHANNEL_ERROR_TYPE.IG_SUBSCRIPTION_LOST,
  CHANNEL_ERROR_TYPE.IG_RESUBSCRIBE_FAILED,
  CHANNEL_ERROR_TYPE.META_WEBHOOK_SIGNATURE_MISMATCH,
  CHANNEL_ERROR_TYPE.IG_HEALTH_PROBE_FAILED,
] as const;

export const IG_ALL_ERROR_TYPES = [
  ...IG_BROKEN_ERROR_TYPES,
  ...IG_DEGRADED_ERROR_TYPES,
] as const;
