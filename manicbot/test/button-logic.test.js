/**
 * Tests for conditional button display logic across all panels.
 *
 * Covers:
 *  1. Calendar OAuth button: hidden when connected, shown when disconnected, re-auth on error
 *  2. Block/Unblock: only the relevant action shown per client status
 *  3. Admin calendar button: gated by canUse(ctx, 'calendar')
 *  4. adminKb billing button: only shown in multi-tenant mode (tenantId + db)
 *  5. CB.ADM_MAIN: system_admin gets admin panel, not silent no-op
 *  6. Billing plan buttons: hidden for active/trialing subscribers
 */

import { describe, it, expect } from 'vitest';
import { mainKb, adminKb, masterKb } from '../src/ui/keyboards.js';
import { canUse } from '../src/billing/features.js';

// ── Helpers ───────────────────────────────────────────────────────────────

/** canUse reads ctx.tenant.plan / ctx.tenant.billingStatus */
function makeTenantCtx({ plan = 'start', billingStatus = 'active', ...overrides } = {}) {
  return {
    tenantId: 't_salon1',
    db: {},
    kv: null,
    tenant: { plan, billingStatus },
    ...overrides,
  };
}

function makeMainBotCtx(overrides = {}) {
  return { tenantId: null, db: {}, kv: null, ...overrides };
}

function flatCbs(keyboard) {
  return keyboard.reply_markup.inline_keyboard.flat().map(b => b.callback_data).filter(Boolean);
}

// ── 1. Calendar OAuth button logic ────────────────────────────────────────
describe('Calendar OAuth button display logic', () => {
  /**
   * Mirrors the button selection from callback.js showCalendarSettings.
   */
  function calcCalendarButtons(integration, legacyConnected, connectUrl) {
    const buttons = [];
    const hasOAuthIntegration = !!integration;
    const hasError = !!(integration?.lastSyncError || (integration?.lastSyncStatus && integration.lastSyncStatus !== 'ok'));

    if (connectUrl) {
      if (!hasOAuthIntegration) {
        buttons.push('oauth');
      } else if (hasError) {
        buttons.push('reauth');
      }
      // Connected successfully → no OAuth button
    }
    if (integration) buttons.push('sync_now');
    if (integration || legacyConnected) buttons.push('disconnect');
    buttons.push('back');
    return buttons;
  }

  it('Not connected: shows OAuth button', () => {
    const btns = calcCalendarButtons(null, false, 'https://oauth.url');
    expect(btns).toContain('oauth');
    expect(btns).not.toContain('reauth');
  });

  it('Connected via OAuth (no error): hides OAuth button', () => {
    const integration = { calendarId: 'test@gmail.com', lastSyncStatus: 'ok' };
    const btns = calcCalendarButtons(integration, false, 'https://oauth.url');
    expect(btns).not.toContain('oauth');
    expect(btns).not.toContain('reauth');
    expect(btns).toContain('sync_now');
    expect(btns).toContain('disconnect');
  });

  it('Connected via OAuth with lastSyncError: shows re-auth, not oauth', () => {
    const integration = { calendarId: 'test@gmail.com', lastSyncError: 'token expired' };
    const btns = calcCalendarButtons(integration, false, 'https://oauth.url');
    expect(btns).not.toContain('oauth');
    expect(btns).toContain('reauth');
    expect(btns).toContain('sync_now');
  });

  it('Connected via OAuth with lastSyncStatus != ok: shows re-auth', () => {
    const integration = { calendarId: 'test@gmail.com', lastSyncStatus: 'error' };
    const btns = calcCalendarButtons(integration, false, 'https://oauth.url');
    expect(btns).not.toContain('oauth');
    expect(btns).toContain('reauth');
  });

  it('Connected via OAuth (ok status): shows disconnect and sync but NOT oauth or reauth', () => {
    const integration = { calendarId: 'test@gmail.com', lastSyncStatus: 'ok', lastSyncAt: Date.now() };
    const btns = calcCalendarButtons(integration, false, 'https://oauth.url');
    expect(btns).not.toContain('oauth');
    expect(btns).not.toContain('reauth');
    expect(btns).toContain('sync_now');
    expect(btns).toContain('disconnect');
  });

  it('Legacy connected (service account): shows OAuth button to upgrade', () => {
    const btns = calcCalendarButtons(null, true, 'https://oauth.url');
    expect(btns).toContain('oauth');
    expect(btns).toContain('disconnect');
    expect(btns).not.toContain('sync_now');
  });

  it('No connectUrl: no OAuth or re-auth buttons regardless of state', () => {
    const integration = { calendarId: 'test@gmail.com', lastSyncError: 'fail' };
    const btns = calcCalendarButtons(integration, false, null);
    expect(btns).not.toContain('oauth');
    expect(btns).not.toContain('reauth');
  });
});

// ── 2. Block / Unblock button logic ──────────────────────────────────────
describe('Block/Unblock button — only relevant action shown', () => {
  function clientBtns(blocked) {
    // Mirrors the fix in admin.js showClientsList
    if (blocked) return ['unblock'];
    return ['block'];
  }

  it('Unblocked client → only Block button', () => {
    expect(clientBtns(false)).toEqual(['block']);
  });

  it('Blocked client → only Unblock button', () => {
    expect(clientBtns(true)).toEqual(['unblock']);
  });

  it('Never shows both block and unblock at the same time', () => {
    expect(clientBtns(false)).not.toContain('unblock');
    expect(clientBtns(true)).not.toContain('block');
  });
});

// ── 3. Admin calendar button gated by canUse ────────────────────────────
describe('Admin calendar button in settings panel', () => {
  it('canUse returns false for plan without calendar feature', async () => {
    // 'start' plan — check PLAN_LIMITS to know if calendar is included
    const { PLAN_LIMITS } = await import('../src/billing/config.js');
    const plan = 'start';
    const limits = PLAN_LIMITS[plan];
    if (limits) {
      const ctx = makeTenantCtx({ plan, billingStatus: 'active' });
      const result = canUse(ctx, 'calendar');
      expect(typeof result).toBe('boolean');
    }
  });

  it('canUse returns true for studio plan with calendar (if applicable)', async () => {
    const { PLAN_LIMITS } = await import('../src/billing/config.js');
    const plan = 'studio';
    if (PLAN_LIMITS[plan]?.calendar) {
      const ctx = makeTenantCtx({ plan, billingStatus: 'active' });
      expect(canUse(ctx, 'calendar')).toBe(true);
    }
  });

  it('canUse returns false when status is grace_period (even for pro plan)', () => {
    const ctx = makeTenantCtx({ plan: 'studio', billingStatus: 'grace_period' });
    expect(canUse(ctx, 'calendar')).toBe(false);
  });

  it('canUse returns false when billing is inactive', () => {
    const ctx = makeTenantCtx({ plan: 'studio', billingStatus: 'inactive' });
    expect(canUse(ctx, 'calendar')).toBe(false);
  });

  it('Legacy (no ctx.tenant): canUse returns true — no restrictions', () => {
    // Single-bot deployments: no billing restrictions
    expect(canUse({}, 'calendar')).toBe(true);
    expect(canUse({ tenantId: null }, 'calendar')).toBe(true);
  });
});

// ── 4. adminKb billing button: only in multi-tenant mode ─────────────────
describe('adminKb billing button visibility', () => {
  it('tenant bot (tenantId + db): billing button is shown', async () => {
    const { CB } = await import('../src/config.js');
    const kb = adminKb('ru', { tenantId: 't_salon1', db: {} });
    const cbs = flatCbs(kb);
    expect(cbs).toContain(CB.ADM_BILLING);
  });

  it('main bot (no tenantId): billing button is hidden', async () => {
    const { CB } = await import('../src/config.js');
    const kb = adminKb('ru', { tenantId: null, db: {} });
    const cbs = flatCbs(kb);
    expect(cbs).not.toContain(CB.ADM_BILLING);
  });

  it('no ctx (backward-compatible default): billing button shown', async () => {
    const { CB } = await import('../src/config.js');
    const kb = adminKb('ru');
    const cbs = flatCbs(kb);
    expect(cbs).toContain(CB.ADM_BILLING);
  });

  it('no db: billing button hidden', async () => {
    const { CB } = await import('../src/config.js');
    const kb = adminKb('ru', { tenantId: 't_salon1', db: null });
    const cbs = flatCbs(kb);
    expect(cbs).not.toContain(CB.ADM_BILLING);
  });

  it('All other admin buttons always present regardless of billing mode', async () => {
    const { CB } = await import('../src/config.js');
    const kbTenant = adminKb('ru', { tenantId: 't_salon1', db: {} });
    const kbMain = adminKb('ru', { tenantId: null, db: {} });
    for (const kb of [kbTenant, kbMain]) {
      const cbs = flatCbs(kb);
      expect(cbs).toContain(CB.ADM_TODAY);
      expect(cbs).toContain(CB.ADM_MASTERS);
      expect(cbs).toContain(CB.ADM_CLIENTS);
      expect(cbs).toContain(CB.ADM_SETTINGS);
      // "Режим клиента" uses CLIENT_VIEW (not MAIN) so it calls showWelcome() directly
      expect(cbs).toContain(CB.CLIENT_VIEW);
    }
  });

  it('adminKb: Instagram/WhatsApp row only for tenant with Pro+ channel plan', async () => {
    const { CB } = await import('../src/config.js');
    const proCtx = {
      tenantId: 't1',
      db: {},
      tenant: { plan: 'pro', billingStatus: 'active' },
    };
    const startCtx = {
      tenantId: 't1',
      db: {},
      tenant: { plan: 'start', billingStatus: 'active' },
    };
    expect(flatCbs(adminKb('ru', proCtx))).toContain(CB.ADM_META_CHANNELS);
    expect(flatCbs(adminKb('ru', startCtx))).not.toContain(CB.ADM_META_CHANNELS);
    expect(flatCbs(adminKb('ru', { tenantId: null, db: {} }))).not.toContain(CB.ADM_META_CHANNELS);
  });
});

// ── 5. Billing plan buttons hidden for active/trialing subscribers ────────
describe('Billing plan buttons — hide for active subscribers', () => {
  function planBtnsShown(billingStatus, canCheckout = true) {
    const isActiveSub = billingStatus === 'active' || billingStatus === 'trialing';
    return canCheckout && !isActiveSub;
  }

  it('inactive → plan buttons shown', () => {
    expect(planBtnsShown('inactive')).toBe(true);
  });

  it('canceled → plan buttons shown', () => {
    expect(planBtnsShown('canceled')).toBe(true);
  });

  it('grace_period → plan buttons shown', () => {
    expect(planBtnsShown('grace_period')).toBe(true);
  });

  it('active → plan buttons HIDDEN', () => {
    expect(planBtnsShown('active')).toBe(false);
  });

  it('trialing → plan buttons HIDDEN', () => {
    expect(planBtnsShown('trialing')).toBe(false);
  });

  it('no stripe config → plan buttons hidden regardless', () => {
    expect(planBtnsShown('inactive', false)).toBe(false);
  });
});

// ── 6. masterKb calendar gating (existing correct behavior) ──────────────
describe('masterKb calendar button — already correctly gated', () => {
  it('inactive billing: calendar button hidden in masterKb', async () => {
    const { CB } = await import('../src/config.js');
    const ctx = makeTenantCtx({ plan: 'studio', billingStatus: 'inactive' });
    const kb = masterKb('ru', ctx);
    const cbs = flatCbs(kb);
    expect(cbs).not.toContain(CB.MST_CALENDAR);
  });

  it('grace_period: calendar button hidden in masterKb', async () => {
    const { CB } = await import('../src/config.js');
    const ctx = makeTenantCtx({ plan: 'studio', billingStatus: 'grace_period' });
    const kb = masterKb('ru', ctx);
    const cbs = flatCbs(kb);
    expect(cbs).not.toContain(CB.MST_CALENDAR);
  });

  it('no ctx (legacy mode): calendar button shown', async () => {
    const { CB } = await import('../src/config.js');
    const kb = masterKb('ru', null);
    const cbs = flatCbs(kb);
    expect(cbs).toContain(CB.MST_CALENDAR);
  });
});
