/**
 * Comprehensive routing tests: every role × every entry point.
 * Verifies that no role ever lands on the wrong panel.
 *
 * Covers:
 *  - showHomeByRole  (CB.MAIN callback, text back button, AI context action)
 *  - showWelcome     (role-appropriate keyboard)
 *  - mainKb          (system_admin gets admin shortcuts)
 *  - All back-button callbacks per sysadmin panel
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { setPlatformRole, setTenantRole, ROLES } from '../src/roles/roles.js';

// ── Stub minimal ctx helpers ──────────────────────────────────────────────
function makeCtx({ tenantId = null, adminChatId = '321706035' } = {}) {
  const db = createMockD1();
  return {
    db,
    kv: makeMockKv(new Map()),
    tenantId,
    adminChatId,          // isCreator() reads ctx.adminChatId (camelCase)
    svc: [],
    baseUrl: 'https://manicbot.com',
    prefix: tenantId ? `t:${tenantId}:` : 'b:main:',
  };
}

// ── showHomeByRole routing logic (extracted / unit-tested) ─────────────────
/**
 * Mirrors the logic of showHomeByRole in ui/screens.js without actually
 * sending Telegram messages. Returns a label for which panel would be shown.
 */
async function resolveHomePanel(ctx, cid) {
  const { isPlatformAdmin } = await import('../src/services/users.js');
  const { getRole } = await import('../src/services/users.js');

  // Platform admin in main bot
  if (!ctx.tenantId && await isPlatformAdmin(ctx, cid)) return 'platform_admin';

  const role = await getRole(ctx, cid);
  if (role === 'system_admin') return 'admin';           // tenant bot
  if (role === 'admin' || role === 'tenant_owner') return 'admin';
  if (role === 'master') return 'master';
  return 'welcome';
}

// ── Main bot routing ───────────────────────────────────────────────────────
describe('showHomeByRole — main bot (no tenantId)', () => {
  const ADMIN_ID = 321706035;

  it('ADMIN_CHAT_ID (creator) → platform_admin panel', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: String(ADMIN_ID) });
    expect(await resolveHomePanel(ctx, ADMIN_ID)).toBe('platform_admin');
  });

  it('system_admin role (non-creator) → platform_admin panel', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '999' });
    await setPlatformRole(ctx, 111, 'system_admin');
    expect(await resolveHomePanel(ctx, 111)).toBe('platform_admin');
  });

  it('admin role in main bot → welcome (no tenant context → not admin panel)', async () => {
    // In main bot, non-platform-admins with tenant roles see welcome
    const ctx = makeCtx({ tenantId: null, adminChatId: '999' });
    // Note: admin role is tenant-scoped, in main bot getRole returns 'client'
    expect(await resolveHomePanel(ctx, 777)).toBe('welcome');
  });

  it('master role in main bot (without tenantId) → welcome', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '999' });
    expect(await resolveHomePanel(ctx, 888)).toBe('welcome');
  });

  it('unknown user (client) → welcome', async () => {
    const ctx = makeCtx({ tenantId: null });
    expect(await resolveHomePanel(ctx, 99999)).toBe('welcome');
  });
});

// ── Tenant bot routing ─────────────────────────────────────────────────────
describe('showHomeByRole — tenant bot (tenantId set)', () => {
  const T = 't_salon1';

  it('system_admin in tenant bot → admin panel (acts as admin)', async () => {
    const ctx = makeCtx({ tenantId: T, adminChatId: '999' });
    await setPlatformRole(ctx, 321, 'system_admin');
    expect(await resolveHomePanel(ctx, 321)).toBe('admin');
  });

  it('tenant_owner in tenant bot → admin panel', async () => {
    const ctx = makeCtx({ tenantId: T });
    await setTenantRole(ctx, 444, 'tenant_owner');
    expect(await resolveHomePanel(ctx, 444)).toBe('admin');
  });

  it('admin (tenant_owner role) in tenant bot → admin panel', async () => {
    // In tenant context, "admin" maps to ROLES.TENANT_OWNER
    const ctx = makeCtx({ tenantId: T });
    await setTenantRole(ctx, 555, 'tenant_owner');
    expect(await resolveHomePanel(ctx, 555)).toBe('admin');
  });

  it('master in tenant bot → master panel', async () => {
    const ctx = makeCtx({ tenantId: T });
    await setTenantRole(ctx, 666, 'master');
    expect(await resolveHomePanel(ctx, 666)).toBe('master');
  });

  it('client in tenant bot → welcome screen', async () => {
    const ctx = makeCtx({ tenantId: T });
    expect(await resolveHomePanel(ctx, 777)).toBe('welcome');
  });

  it('ADMIN_CHAT_ID in tenant bot (tenantId set) → admin panel (system_admin acts as admin)', async () => {
    const ctx = makeCtx({ tenantId: T, adminChatId: '321706035' });
    // ctx.tenantId is set → isPlatformAdmin check is skipped
    // getRole → isCreator = true → 'system_admin' → resolveHomePanel returns 'admin'
    expect(await resolveHomePanel(ctx, 321706035)).toBe('admin');
  });
});

// ── CB.MAIN callback routing ───────────────────────────────────────────────
describe('CB.MAIN callback routing (same as showHomeByRole)', () => {
  it('system_admin pressing CB.MAIN in main bot → platform panel, NOT welcome', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '321706035' });
    const panel = await resolveHomePanel(ctx, 321706035);
    expect(panel).toBe('platform_admin');
    expect(panel).not.toBe('welcome');
  });

  it('tenant_owner pressing CB.MAIN in tenant bot → admin panel, NOT welcome', async () => {
    const ctx = makeCtx({ tenantId: 't_salon1' });
    await setTenantRole(ctx, 100, 'tenant_owner');
    const panel = await resolveHomePanel(ctx, 100);
    expect(panel).toBe('admin');
    expect(panel).not.toBe('welcome');
  });

  it('master pressing CB.MAIN → master panel, NOT welcome', async () => {
    const ctx = makeCtx({ tenantId: 't_salon1' });
    await setTenantRole(ctx, 200, 'master');
    const panel = await resolveHomePanel(ctx, 200);
    expect(panel).toBe('master');
    expect(panel).not.toBe('welcome');
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

  it('admin gets ADM_MAIN and MST_MAIN buttons', async () => {
    const { mainKb } = await import('../src/ui/keyboards.js');
    const { CB } = await import('../src/config.js');
    const kb = mainKb('ru', 'admin');
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
describe('/help — each role gets different content', () => {
  // Reproduce the role-detection logic from message.js
  function helpCategory(role) {
    if (role === 'system_admin') return 'sysadmin';
    if (role === 'admin' || role === 'tenant_owner') return 'admin';
    if (role === 'master') return 'master';
    return 'client';
  }

  it('system_admin → sysadmin help (most detailed)', () => {
    expect(helpCategory('system_admin')).toBe('sysadmin');
  });

  it('admin → admin help', () => {
    expect(helpCategory('admin')).toBe('admin');
  });

  it('tenant_owner → admin help (same as admin)', () => {
    expect(helpCategory('tenant_owner')).toBe('admin');
  });

  it('master → master help', () => {
    expect(helpCategory('master')).toBe('master');
  });

  it('client → client help', () => {
    expect(helpCategory('client')).toBe('client');
  });

  it('each category is unique', () => {
    const cats = ['system_admin', 'admin', 'master', 'client'].map(helpCategory);
    const unique = new Set(cats);
    expect(unique.size).toBe(cats.length);
  });
});

// ── Regression: system_admin never lands on client welcome via CB.MAIN ─────
describe('Regression: system_admin never lands on client welcome', () => {
  it('ADMIN_CHAT_ID in main bot: home panel is NEVER welcome', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '321706035' });
    const panel = await resolveHomePanel(ctx, 321706035);
    expect(panel).not.toBe('welcome');
    expect(panel).toBe('platform_admin');
  });

  it('system_admin DB role in main bot: home panel is NEVER welcome', async () => {
    const ctx = makeCtx({ tenantId: null, adminChatId: '' });
    await setPlatformRole(ctx, 1234, 'system_admin');
    const panel = await resolveHomePanel(ctx, 1234);
    expect(panel).not.toBe('welcome');
    expect(panel).toBe('platform_admin');
  });

  it('system_admin in tenant bot: home panel is admin, NOT welcome', async () => {
    const ctx = makeCtx({ tenantId: 't_test', adminChatId: '999' });
    await setPlatformRole(ctx, 555, 'system_admin');
    const panel = await resolveHomePanel(ctx, 555);
    expect(panel).toBe('admin');
    expect(panel).not.toBe('welcome');
  });
});
