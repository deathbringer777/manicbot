/**
 * platformSettings — tiny key/value store for platform-global, operator-controlled
 * switches (table `platform_settings`, migration 0122). PLATFORM-scoped: no
 * tenant_id by design. First consumer is the secondary messaging send-pause gate.
 */

import { dbGet } from '../utils/db.js';

/** Read a platform_settings string value, or null when unset. */
export async function getPlatformSetting(ctx, key) {
  const row = await dbGet(
    ctx, 'SELECT value FROM platform_settings WHERE key = ? LIMIT 1', key,
  ).catch(() => null);
  return row?.value ?? null;
}

/**
 * Operator secondary send-pause gate. Default false (not paused) when unset, so
 * adding the row never enables sending — it can only ever pause. The master gate
 * is still env `MESSAGING_SEND_ENABLED`; effective sending = enabled && !paused.
 */
export async function isSendPaused(ctx) {
  return (await getPlatformSetting(ctx, 'messaging_send_paused')) === '1';
}
