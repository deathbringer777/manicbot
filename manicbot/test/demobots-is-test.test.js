/**
 * Demo-bot provisioner — `is_test` flag regression.
 *
 * `is_test` is a legacy column NOT included in the `putTenant` INSERT-OR-REPLACE
 * payload, so every re-provision resets it to its schema DEFAULT (0). That made
 * the 4 demo salons (Crystal Nails / Velvet Touch / Мастер Алина / Мастер
 * Виктория) look like REAL public salons: no TEST badge, indexable, and present
 * in the sitemap (`utils/seo.js` filters `is_test = 0`).
 *
 * `ensureDemoBotsProvisioned` must therefore set `is_test = 1` explicitly right
 * after `putTenant`, mirroring what `tenant/previewTenant.js` already does for
 * the preview-landing tenant.
 *
 * Harness mirrors `preview-tenant.test.js`: mock-D1 + KV, `vi.resetModules()` to
 * reset the module-level `_demoProvisioned` flag, and a stubbed `fetch` so the
 * Telegram `setWebhook` call is a no-op. Demo tenant rows are filtered in JS
 * (the mock SQL parser drops `IN (...)` filters).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

const DEMO_TENANT_IDS = ['t_salon1', 't_salon2', 't_master1', 't_master2'];

/** Env with the 4 demo BOT_TOKEN_* vars set so the provisioning loop executes. */
function makeDemoEnv(db = createMockD1()) {
  return {
    DB: db,
    MANICBOT: makeMockKv(),
    // Each token must contain ':' — the provisioner derives botId via split(':').
    BOT_TOKEN_SALON1: '1000001:salon1secret',
    BOT_TOKEN_SALON2: '1000002:salon2secret',
    BOT_TOKEN_MASTER1: '1000003:master1secret',
    BOT_TOKEN_MASTER2: '1000004:master2secret',
    // Required by putBot to encrypt the token instead of refusing the write.
    BOT_ENCRYPTION_KEY: 'test-bot-encryption-key-0123456789abcdef',
  };
}

describe('ensureDemoBotsProvisioned — is_test flag', () => {
  let fresh;

  beforeEach(async () => {
    // setWebhook is a fire-and-forget fetch; stub it so no real network call.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    // Re-import so each test gets a fresh module-level `_demoProvisioned` flag.
    vi.resetModules();
    fresh = await import('../src/http/demoBots.js');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flags all 4 demo tenants as is_test = 1', async () => {
    const env = makeDemoEnv();
    await fresh.ensureDemoBotsProvisioned(env);

    const tenants = env.DB._getTable('tenants');
    const demos = tenants.filter(t => DEMO_TENANT_IDS.includes(t.id));
    expect(demos).toHaveLength(4);
    for (const t of demos) {
      expect(t.is_test).toBe(1);
    }
  });

  it('keeps the demo salons out of the public sitemap query (public_active=1 AND is_test=1)', async () => {
    const env = makeDemoEnv();
    await fresh.ensureDemoBotsProvisioned(env);

    // generateSitemapResponse SELECTs `WHERE public_active = 1 AND is_test = 0`.
    // The demo tenants are public_active=1, so the ONLY thing keeping them out
    // of Googlebot's sitemap is is_test=1.
    const tenants = env.DB._getTable('tenants');
    const demos = tenants.filter(t => DEMO_TENANT_IDS.includes(t.id));
    for (const t of demos) {
      expect(t.public_active).toBe(1);
      expect(t.is_test).toBe(1);
    }
  });
});
