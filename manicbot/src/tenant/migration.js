/**
 * One-time migration: create default tenant, register bot, re-key all data from b:{botId}: to t:default:
 * Idempotent: if migration:v1:done exists, skip.
 */

import { getTenant, putTenant, putBot, defaultTenantPayload, defaultBotPayload } from './storage.js';
import { log } from '../utils/logger.js';

const MIGRATION_FLAG = 'migration:v1:done';

export async function isMigrationComplete(kv) {
  if (!kv) return false;
  try {
    const v = await kv.get(MIGRATION_FLAG, 'text');
    return v === '1';
  } catch {
    return false;
  }
}

export async function runMigration(kv, env) {
  if (!kv || !env.BOT_TOKEN || !env.WEBHOOK_SECRET) {
    return { ok: false, error: 'Missing kv, BOT_TOKEN or WEBHOOK_SECRET' };
  }
  if (await isMigrationComplete(kv)) {
    return { ok: true, skipped: true, message: 'Migration already done' };
  }

  const botId = env.BOT_TOKEN.split(':')[0];
  const oldPrefix = `b:${botId}:`;
  const newPrefix = 't:default:';

  const tenantPayload = defaultTenantPayload(botId, env);
  const tenant = await getTenant(kv, 'default');
  if (!tenant) {
    await putTenant(kv, 'default', tenantPayload);
  }

  const encryptionKey = env.BOT_ENCRYPTION_KEY || null;
  const botPayload = defaultBotPayload(botId, 'default', env.BOT_TOKEN, env.WEBHOOK_SECRET);
  await putBot(kv, botId, botPayload, encryptionKey);

  let copied = 0;
  let cursor;
  do {
    const list = await kv.list({ prefix: oldPrefix, cursor });
    for (const k of list.keys) {
      const shortKey = k.name.slice(oldPrefix.length);
      if (!shortKey) continue;
      try {
        const value = await kv.get(k.name, 'text');
        if (value != null) {
          await kv.put(newPrefix + shortKey, value, k.expiration ? { expirationTtl: k.expiration } : undefined);
          copied++;
        }
      } catch (e) {
        log.error('tenant.migration', e instanceof Error ? e : new Error(String(e.message)), { key: k.name });
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  await kv.put(MIGRATION_FLAG, '1');
  return { ok: true, copied, message: `Migration done. Copied ${copied} keys to t:default:` };
}
