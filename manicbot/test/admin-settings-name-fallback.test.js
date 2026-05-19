/**
 * Pins the read fallback chain for the salon name in
 * `showAdminSettings` (Worker `src/ui/admin.js`).
 *
 * The bot displays the salon name on line 1 of the admin "⚙️ Salon
 * Settings" panel. Before the fix it read ONLY `ctx.tenant.salon.name`
 * and fell back to `ctx.SALON_NAME` (a legacy env default) — which
 * left the seed-tenants and any tenant whose `salon` JSON was created
 * without an explicit `name` key showing a "—" placeholder, even
 * though `tenants.name` held the right value all along.
 *
 * The fixed read order is:
 *   salon.name → ctx.tenant.name → ctx.SALON_NAME → "—".
 *
 * The admin-app write path mirrors `name` into the JSON for new
 * writes (see `salon-update-profile-name-mirror.test.ts`), but legacy
 * rows that were never re-saved still need this fallback to render
 * correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent = [];
vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async (_ctx, _cid, text, kb) => { sent.push({ text, kb }); }),
  sendPhoto: vi.fn(),
  edit: vi.fn(),
}));

vi.mock('../src/services/state.js', () => ({
  clearState: vi.fn(async () => {}),
  setState: vi.fn(async () => {}),
  getState: vi.fn(async () => null),
}));

vi.mock('../src/services/users.js', () => ({
  getLang: vi.fn(async () => 'ru'),
  isCreator: vi.fn(() => false),
  isAdmin: vi.fn(async () => true),
}));

vi.mock('../src/billing/features.js', () => ({
  canUse: vi.fn(() => false),
}));

import { showAdminSettings } from '../src/ui/admin.js';

function makeCtx({ salon, tenantName, envName } = {}) {
  return {
    tenantId: 't_test',
    tenant: { name: tenantName ?? null, salon: salon ?? null, plan: 'pro', billingStatus: 'active' },
    SALON_NAME: envName ?? undefined,
    db: null,
    kv: null,
  };
}

describe('showAdminSettings — salon name fallback chain', () => {
  beforeEach(() => { sent.length = 0; });

  it('prefers salon.name when present', async () => {
    await showAdminSettings(makeCtx({
      salon: { name: 'From Salon JSON' },
      tenantName: 'From Column',
      envName: 'From Env',
    }), 1);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('From Salon JSON');
    expect(sent[0].text).not.toContain('From Column');
  });

  it('falls back to tenants.name when salon JSON has no name (seed-tenant case)', async () => {
    await showAdminSettings(makeCtx({
      salon: { phone: '+48 999' },           // salon JSON exists but no `name` key
      tenantName: 'ManicBot Demo Studio',    // tenants.name column populated
      envName: 'IgnoredEnvDefault',
    }), 1);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('ManicBot Demo Studio');
  });

  it('falls back to tenants.name when salon JSON is null', async () => {
    await showAdminSettings(makeCtx({
      salon: null,
      tenantName: 'Studio Z',
    }), 1);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('Studio Z');
  });

  it('falls back to SALON_NAME env when both salon.name and tenants.name are empty', async () => {
    await showAdminSettings(makeCtx({
      salon: null,
      tenantName: null,
      envName: 'EnvDefaultName',
    }), 1);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('EnvDefaultName');
  });

  it('uses "—" only when every layer is empty', async () => {
    await showAdminSettings(makeCtx({}), 1);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('🏠 <b>—</b>');
  });
});
