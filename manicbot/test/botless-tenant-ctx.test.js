/**
 * Tests for the IG-/WA-only cron fix (2026-05-14 incident root cause #1):
 *   • buildBotlessTenantCtx — minimal ctx shape for tenants without a
 *     Telegram bot row, used by the cron queue consumer.
 *   • tenantHasActiveChannel — cheap LIMIT 1 probe used to decide
 *     whether a tenant deserves a cron tick despite botIds.length===0.
 *
 * These bypass the historical "botIds.length === 0 → ACK" gate that
 * silently dropped @manicbot_com (IG-only) cron for ~6 weeks.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildBotlessTenantCtx } from '../src/tenant/resolver.js';
import { tenantHasActiveChannel } from '../src/channels/resolver.js';

describe('buildBotlessTenantCtx', () => {
  it('returns ctx with bot/TG/channel = null but DB and tenant set', () => {
    const env = {
      DB: { prepare: () => {} },
      MANICBOT: {},
      BOT_ENCRYPTION_KEY: 'k'.repeat(32),
    };
    const tenant = { id: 't_1c305v2g5011', name: 'ManicBot Salon' };
    const ctx = buildBotlessTenantCtx(env, tenant.id, tenant);

    expect(ctx.tenantId).toBe('t_1c305v2g5011');
    expect(ctx.tenant).toEqual(tenant);
    expect(ctx.bot).toBeNull();
    expect(ctx.TG).toBeNull();
    expect(ctx.channel).toBeNull();
    expect(ctx.WEBHOOK_SECRET).toBeNull();
    expect(ctx.prefix).toBe('t:t_1c305v2g5011:');
    // Inherits env bindings from baseCtx.
    expect(ctx.db).toBe(env.DB);
    expect(ctx.BOT_ENCRYPTION_KEY).toBe(env.BOT_ENCRYPTION_KEY);
  });
});

describe('tenantHasActiveChannel', () => {
  function makeCtx(rows) {
    return {
      db: {
        prepare(sql) {
          return {
            bind() { return this; },
            async all() {
              if (sql.includes('SELECT 1 FROM channel_configs') && sql.includes("active = 1")) {
                return { results: rows };
              }
              return { results: [] };
            },
          };
        },
      },
    };
  }

  it('false when no ctx.db', async () => {
    expect(await tenantHasActiveChannel({}, 't_1')).toBe(false);
  });

  it('false when tenantId is empty', async () => {
    expect(await tenantHasActiveChannel(makeCtx([]), '')).toBe(false);
  });

  it('false when query returns no rows', async () => {
    expect(await tenantHasActiveChannel(makeCtx([]), 't_no_channels')).toBe(false);
  });

  it('true when at least one active channel exists', async () => {
    expect(await tenantHasActiveChannel(makeCtx([{ 1: 1 }]), 't_1c305v2g5011')).toBe(true);
  });

  it('swallows DB errors and returns false (never throws)', async () => {
    const ctx = {
      db: { prepare() { throw new Error('D1 down'); } },
    };
    await expect(tenantHasActiveChannel(ctx, 't_1')).resolves.toBe(false);
  });
});
