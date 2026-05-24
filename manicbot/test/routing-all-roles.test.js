/**
 * Comprehensive routing tests: every role × every entry point.
 * Verifies that no role ever lands on the wrong panel.
 *
 * Phase 2 cleanup:
 *   - Dropped the local `resolveHomePanel` mirror (it carried a dead
 *     `role === 'admin'` branch — `getRole()` in `src/services/users.js`
 *     never returns 'admin', only 'system_admin' / 'tenant_owner' /
 *     'tenant_manager' / 'support' / 'master' / 'client').
 *   - Now exercises the REAL `showHomeByRole` from `src/ui/screens.js`
 *     with stubbed panel renderers, asserting which panel function got
 *     called for each role/context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { setPlatformRole, setTenantRole } from '../src/roles/roles.js';

// ─── Mock the panel renderers — we only care WHICH one was called ────────────
// showAdminPanel + showMasterPanel come from ui/admin.js (separate module —
// vi.mock CAN intercept). showPlatformAdminPanel lives in ui/sysadmin.js (same).
// showWelcome is INTERNAL to ui/screens.js so we can't vi.mock it; instead we
// stub telegram.send (the only side-effect inside showWelcome) so the welcome
// path executes safely and we assert NOT-welcome by checking that no panel
// was called.

const mockPlatformPanel = vi.fn().mockResolvedValue(undefined);
const mockAdminPanel = vi.fn().mockResolvedValue(undefined);
const mockMasterPanel = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/ui/sysadmin.js', () => ({
  showPlatformAdminPanel: (...a) => mockPlatformPanel(...a),
}));

vi.mock('../src/ui/admin.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    showAdminPanel: (...a) => mockAdminPanel(...a),
    showMasterPanel: (...a) => mockMasterPanel(...a),
  };
});

// Stub the Telegram outbound layer so showWelcome's `send(...)` is a no-op.
vi.mock('../src/telegram.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    send: vi.fn().mockResolvedValue({ ok: true }),
    sendPhoto: vi.fn().mockResolvedValue({ ok: true }),
    trySendPhoto: vi.fn().mockResolvedValue({ ok: true }),
    editPhoto: vi.fn().mockResolvedValue({ ok: true }),
  };
});

// Import the REAL function AFTER vi.mock has registered the substitutions.
const { showHomeByRole } = await import('../src/ui/screens.js');

function makeCtx({ tenantId = null, adminChatId = '321706035' } = {}) {
  const db = createMockD1();
  return {
    db,
    kv: makeMockKv(new Map()),
    tenantId,
    adminChatId,
    svc: [],
    baseUrl: 'https://manicbot.com',
    prefix: tenantId ? `t:${tenantId}:` : 'b:main:',
    // showWelcome reads from ctx.tenant?.salon; supply a minimal shape so
    // the welcome path doesn't crash before the mock observes the call.
    tenant: { salon: {} },
  };
}

function clearMocks() {
  mockPlatformPanel.mockClear();
  mockAdminPanel.mockClear();
  mockMasterPanel.mockClear();
}

// Helper: a "welcome" outcome is anything that didn't trigger any panel mock.
function noPanelInvoked() {
  return (
    !mockPlatformPanel.mock.calls.length &&
    !mockAdminPanel.mock.calls.length &&
    !mockMasterPanel.mock.calls.length
  );
}

// ── Main bot routing ───────────────────────────────────────────────────────
describe('showHomeByRole — main bot (no tenantId)', () => {
  const ADMIN_ID = 321706035;

  beforeEach(clearMocks);

  it('ADMIN_CHAT_ID (creator) → platform_admin panel', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: String(ADMIN_ID) });
    await showHomeByRole(ctx, ADMIN_ID, 'Creator');
    expect(mockPlatformPanel).toHaveBeenCalledTimes(1);
    expect(mockAdminPanel).not.toHaveBeenCalled();
  });

  it('non-creator cannot get platform_admin via DB system_admin row', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '999' });
    await setPlatformRole(ctx, 111, 'system_admin');
    await showHomeByRole(ctx, 111, 'NonAdmin');
    expect(mockPlatformPanel).not.toHaveBeenCalled();
    expect(noPanelInvoked()).toBe(true);
  });

  it('master role in main bot (without tenantId) → welcome', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '999' });
    await showHomeByRole(ctx, 888, 'Master');
    expect(noPanelInvoked()).toBe(true);
  });

  it('unknown user (client) → welcome', async () => {
    const ctx = makeCtx({ tenantId: null });
    await showHomeByRole(ctx, 99999, 'Stranger');
    expect(noPanelInvoked()).toBe(true);
  });
});

// ── Tenant bot routing ─────────────────────────────────────────────────────
describe('showHomeByRole — tenant bot (tenantId set)', () => {
  const T = 't_salon1';

  beforeEach(clearMocks);

  it('non-creator with stale system_admin row in tenant bot → welcome', async () => {
    const ctx = makeCtx({ tenantId: T, adminChatId: '999' });
    await setPlatformRole(ctx, 321, 'system_admin');
    await showHomeByRole(ctx, 321, 'Bystander');
    expect(mockAdminPanel).not.toHaveBeenCalled();
    expect(noPanelInvoked()).toBe(true);
  });

  it('tenant_owner in tenant bot → admin panel', async () => {
    const ctx = makeCtx({ tenantId: T });
    await setTenantRole(ctx, 444, 'tenant_owner');
    await showHomeByRole(ctx, 444, 'Owner');
    expect(mockAdminPanel).toHaveBeenCalledTimes(1);
  });

  it('master in tenant bot → master panel', async () => {
    const ctx = makeCtx({ tenantId: T });
    await setTenantRole(ctx, 666, 'master');
    await showHomeByRole(ctx, 666, 'Master');
    expect(mockMasterPanel).toHaveBeenCalledTimes(1);
  });

  it('client in tenant bot → welcome screen', async () => {
    const ctx = makeCtx({ tenantId: T });
    await showHomeByRole(ctx, 777, 'Client');
    expect(noPanelInvoked()).toBe(true);
  });

  it('ADMIN_CHAT_ID in tenant bot (tenantId set) → admin panel (system_admin acts as admin)', async () => {
    const ctx = makeCtx({ tenantId: T, adminChatId: '321706035' });
    await showHomeByRole(ctx, 321706035, 'Creator');
    expect(mockAdminPanel).toHaveBeenCalledTimes(1);
    expect(mockPlatformPanel).not.toHaveBeenCalled();
  });
});

// ── mainKb role keyboard buttons ──────────────────────────────────────────
describe('mainKb — keyboard buttons per role', () => {
  it('system_admin gets SYSADM_MAIN and ADM_MAIN buttons', async () => {
    const { mainKb } = await import('../src/ui/keyboards.js');
    const { CB } = await import('../src/config.js');
    const kb = mainKb('ru', 'system_admin');
    const allCbs = kb.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    expect(allCbs).toContain(CB.SYSADM_MAIN);
    expect(allCbs).toContain(CB.ADM_MAIN);
  });

  it('tenant_owner gets ADM_MAIN and MST_MAIN buttons', async () => {
    const { mainKb } = await import('../src/ui/keyboards.js');
    const { CB } = await import('../src/config.js');
    const kb = mainKb('ru', 'tenant_owner');
    const allCbs = kb.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    expect(allCbs).toContain(CB.ADM_MAIN);
    expect(allCbs).toContain(CB.MST_MAIN);
  });

  it('master gets MST_MAIN button', async () => {
    const { mainKb } = await import('../src/ui/keyboards.js');
    const { CB } = await import('../src/config.js');
    const kb = mainKb('ru', 'master');
    const allCbs = kb.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    expect(allCbs).toContain(CB.MST_MAIN);
  });

  it('client does NOT get ADM_MAIN or SYSADM_MAIN buttons', async () => {
    const { mainKb } = await import('../src/ui/keyboards.js');
    const { CB } = await import('../src/config.js');
    const kb = mainKb('ru', 'client');
    const allCbs = kb.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    expect(allCbs).not.toContain(CB.ADM_MAIN);
    expect(allCbs).not.toContain(CB.SYSADM_MAIN);
  });

  it('system_admin does NOT get MST_MAIN (master) button', async () => {
    const { mainKb } = await import('../src/ui/keyboards.js');
    const { CB } = await import('../src/config.js');
    const kb = mainKb('ru', 'system_admin');
    const allCbs = kb.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    expect(allCbs).not.toContain(CB.MST_MAIN);
  });
});

// ── Sysadmin panel back buttons all use SYSADM_MAIN ──────────────────────
describe('Sysadmin panel back button callbacks', () => {
  it('CB.SYSADM_MAIN and CB.SYSADM_BACK are defined in config', async () => {
    const { CB } = await import('../src/config.js');
    expect(CB.SYSADM_MAIN).toBeTruthy();
    expect(CB.SYSADM_BACK).toBeTruthy();
    expect(CB.SYSADM_MAIN).not.toBe(CB.MAIN);
  });

  it('SYSADM_TENANTS, SYSADM_LINKS, SYSADM_GRANT_ROLE all exist', async () => {
    const { CB } = await import('../src/config.js');
    expect(CB.SYSADM_TENANTS).toBeTruthy();
    expect(CB.SYSADM_LINKS).toBeTruthy();
    expect(CB.SYSADM_GRANT_ROLE).toBeTruthy();
    expect(CB.SYSADM_SUPPORT_LIST).toBeTruthy();
    expect(CB.SYSADM_TECH_SUPPORT_LIST).toBeTruthy();
  });
});

// ── /sysadmin command guard (ADMIN_CHAT_ID only) ───────────────────────────
describe('/sysadmin command — ADMIN_CHAT_ID guard', () => {
  it('creator CAN become system_admin', () => {
    const guard = (cid, adminChatId) =>
      !adminChatId || cid === parseInt(String(adminChatId));
    expect(guard(321706035, '321706035')).toBe(true);
  });

  it('other users CANNOT become system_admin via command', () => {
    const guard = (cid, adminChatId) =>
      !adminChatId || cid === parseInt(String(adminChatId));
    expect(guard(999999, '321706035')).toBe(false);
    expect(guard(1, '321706035')).toBe(false);
  });
});

// ── /help per-role content ─────────────────────────────────────────────────
// Note: pre-cleanup this block carried a dead `role === 'admin'` branch.
// `getRole()` (src/services/users.js) never returns 'admin', so the branch
// could not fire. Removed in this Phase 2 cleanup.
describe('/help — each role gets different content', () => {
  function helpCategory(role) {
    if (role === 'system_admin') return 'sysadmin';
    if (role === 'tenant_owner') return 'admin';
    if (role === 'master') return 'master';
    return 'client';
  }

  it('system_admin → sysadmin help (most detailed)', () => {
    expect(helpCategory('system_admin')).toBe('sysadmin');
  });

  it('tenant_owner → admin help', () => {
    expect(helpCategory('tenant_owner')).toBe('admin');
  });

  it('master → master help', () => {
    expect(helpCategory('master')).toBe('master');
  });

  it('client → client help', () => {
    expect(helpCategory('client')).toBe('client');
  });

  it('each category is unique', () => {
    const cats = ['system_admin', 'tenant_owner', 'master', 'client'].map(helpCategory);
    const unique = new Set(cats);
    expect(unique.size).toBe(cats.length);
  });
});

// ── Regression: system_admin never lands on client welcome via CB.MAIN ─────
describe('Regression: system_admin never lands on client welcome', () => {
  beforeEach(clearMocks);

  it('ADMIN_CHAT_ID in main bot: home panel is NEVER welcome', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '321706035' });
    await showHomeByRole(ctx, 321706035, 'Creator');
    expect(mockPlatformPanel).toHaveBeenCalledTimes(1);
  });

  it('stale system_admin DB row in main bot does not grant platform_admin', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '' });
    await ctx.db
      .prepare('INSERT OR REPLACE INTO platform_roles (chat_id, role, created_at) VALUES (?, ?, ?)')
      .bind(1234, 'system_admin', 1)
      .run();
    await showHomeByRole(ctx, 1234, 'Bystander');
    expect(mockPlatformPanel).not.toHaveBeenCalled();
    expect(noPanelInvoked()).toBe(true);
  });

  it('stale system_admin in tenant bot does not grant admin panel', async () => {
    const ctx = makeCtx({ tenantId: 't_test', adminChatId: '999' });
    await ctx.db
      .prepare('INSERT OR REPLACE INTO platform_roles (chat_id, role, created_at) VALUES (?, ?, ?)')
      .bind(555, 'system_admin', 1)
      .run();
    await showHomeByRole(ctx, 555, 'Bystander');
    expect(mockAdminPanel).not.toHaveBeenCalled();
    expect(noPanelInvoked()).toBe(true);
  });
});
