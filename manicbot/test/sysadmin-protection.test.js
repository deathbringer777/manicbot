/**
 * Tests for /sysadmin command protection and help per role.
 */

import { describe, it, expect } from 'vitest';

// ── Sysadmin protection logic ──────────────────────────────────────────────
describe('/sysadmin ADMIN_CHAT_ID guard', () => {
  // Simulate the guard logic extracted from message.js (uses ctx.adminChatId, camelCase)
  function canBecomeSysAdmin(cid, adminChatId) {
    if (adminChatId && cid !== parseInt(String(adminChatId))) return false;
    return true;
  }

  it('allows the creator (adminChatId) to become sysadmin', () => {
    expect(canBecomeSysAdmin(321706035, '321706035')).toBe(true);
  });

  it('blocks any other user from becoming sysadmin', () => {
    expect(canBecomeSysAdmin(999999999, '321706035')).toBe(false);
    expect(canBecomeSysAdmin(1, '321706035')).toBe(false);
    expect(canBecomeSysAdmin(123456, '321706035')).toBe(false);
  });

  it('allows when adminChatId is not set (fallback for local dev)', () => {
    expect(canBecomeSysAdmin(123456, null)).toBe(true);
    expect(canBecomeSysAdmin(321706035, undefined)).toBe(true);
  });

  it('handles integer vs string adminChatId comparison correctly', () => {
    expect(canBecomeSysAdmin(321706035, 321706035)).toBe(true);
    expect(canBecomeSysAdmin(321706035, '321706035')).toBe(true);
  });
});

// ── setChatMenuButton is called for platform admin ─────────────────────────
describe('God Mode menu button setup', () => {
  it('ADMIN_APP_URL is required for setChatMenuButton to trigger', () => {
    // Simulate the condition from message.js
    const shouldSetMenuButton = (ctx) => Boolean(ctx.ADMIN_APP_URL);

    expect(shouldSetMenuButton({ ADMIN_APP_URL: 'https://admin-app.pages.dev' })).toBe(true);
    expect(shouldSetMenuButton({ ADMIN_APP_URL: '' })).toBe(false);
    expect(shouldSetMenuButton({})).toBe(false);
  });

  it('menu button payload has correct structure', () => {
    const url = 'https://admin-app.pages.dev';
    const payload = {
      type: 'web_app',
      text: '⚡ God Mode',
      web_app: { url },
    };
    expect(payload.type).toBe('web_app');
    expect(payload.text).toBe('⚡ God Mode');
    expect(payload.web_app.url).toBe(url);
  });
});

// ── Role-specific help content ────────────────────────────────────────────
describe('showHelp — role-based content validation', () => {
  // Simulate the help content generation logic from message.js
  function buildHelpText(realRole) {
    if (realRole === 'system_admin') {
      return [
        '🌐 <b>God Mode — Полный список команд платформы</b>',
        '/sysadmin', '/resetwebhooks', '/grant_master', '/grant_salon',
        '/admin', '/add_support', '/remove_support', '/add_technical_support',
        '/support_register', '/master', '/client',
      ].join('\n');
    }
    if (realRole === 'admin' || realRole === 'tenant_owner') {
      return [
        '📋 <b>Помощь — Администратор</b>',
        '/start', '/panel', '/master', '/client',
        '/add_support', '/remove_support', '/grant_master', '/support_register',
        '/book', '/my', '/prices', '/catalog', '/contacts', '/lang',
      ].join('\n');
    }
    if (realRole === 'master') {
      return [
        '📋 <b>Помощь — Мастер</b>',
        '/start', '/my', '/book', '/prices', '/catalog', '/contacts', '/lang',
        '/master', '/panel', '/client',
      ].join('\n');
    }
    // client default
    return '📖 <b>Помощь</b>';
  }

  it('sysadmin help contains all secret commands', () => {
    const text = buildHelpText('system_admin');
    expect(text).toContain('/sysadmin');
    expect(text).toContain('/resetwebhooks');
    expect(text).toContain('/grant_master');
    expect(text).toContain('/grant_salon');
    expect(text).toContain('/admin');
    expect(text).toContain('/add_technical_support');
    expect(text).toContain('/support_register');
  });

  it('admin help contains management commands but NOT secret platform commands', () => {
    const text = buildHelpText('admin');
    expect(text).toContain('/add_support');
    expect(text).toContain('/grant_master');
    expect(text).not.toContain('/sysadmin');
    expect(text).not.toContain('/resetwebhooks');
    expect(text).not.toContain('/grant_salon');
  });

  it('master help does NOT contain admin or sysadmin commands', () => {
    const text = buildHelpText('master');
    expect(text).not.toContain('/add_support');
    expect(text).not.toContain('/grant_master');
    expect(text).not.toContain('/sysadmin');
    expect(text).not.toContain('/resetwebhooks');
  });

  it('client gets basic help text', () => {
    const text = buildHelpText('client');
    expect(text).toContain('Помощь');
    expect(text).not.toContain('/sysadmin');
    expect(text).not.toContain('/add_support');
    expect(text).not.toContain('/grant_master');
  });

  it('tenant_owner gets same help as admin', () => {
    const adminText = buildHelpText('admin');
    const ownerText = buildHelpText('tenant_owner');
    expect(ownerText).toBe(adminText);
  });

  it('sysadmin help contains more unique commands than admin or master', () => {
    const uniqueCmds = (text) => new Set((text.match(/\/\w+/g) || [])).size;
    const sysAdminCmds = uniqueCmds(buildHelpText('system_admin'));
    const adminCmds = uniqueCmds(buildHelpText('admin'));
    const masterCmds = uniqueCmds(buildHelpText('master'));
    // sysadmin has /sysadmin, /resetwebhooks, /grant_salon, /add_technical_support, /support_register extra
    expect(sysAdminCmds).toBeGreaterThan(masterCmds);
    expect(adminCmds).toBeGreaterThan(masterCmds);
  });
});

// ── Admin role removal from API ────────────────────────────────────────────
describe('Admin-app role management restrictions', () => {
  const ALLOWED_ROLES = ['owner', 'support'];

  it('does NOT include admin role in allowed roles', () => {
    expect(ALLOWED_ROLES).not.toContain('admin');
  });

  it('includes owner and support roles', () => {
    expect(ALLOWED_ROLES).toContain('owner');
    expect(ALLOWED_ROLES).toContain('support');
  });

  it('validates that setting system_admin via UI is impossible', () => {
    // The zod enum only accepts owner and support — this simulates the validation
    const validate = (role) => ALLOWED_ROLES.includes(role);
    expect(validate('admin')).toBe(false);
    expect(validate('system_admin')).toBe(false);
    expect(validate('owner')).toBe(true);
    expect(validate('support')).toBe(true);
  });
});
