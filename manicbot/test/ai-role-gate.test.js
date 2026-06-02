import { describe, it, expect } from 'vitest';
import { canRoleRunTag, AI_TAG_ROLES } from '../src/ai.js';

// #S01-3 — fail-closed role→tag gate for the AI action pipeline.
// `pageActions` (message.js) is the dispatch allowlist; `executeAIAction`
// (ai.js) is the role gate. They live in separate files, so a privileged
// tag added to pageActions without a matching role guard would silently
// become client-reachable. `canRoleRunTag` is the single source of truth:
// default-deny — a (role, tag) pair must be explicitly allowed to run.

const CLIENT_TAGS = [
  'MY_APTS', 'PRICES', 'CATALOG', 'CONTACTS', 'MAIN', 'BOOK', 'CANCEL_ALL', 'REVIEWS', 'ABOUT',
];

const PRIVILEGED_TAGS = [
  'ADM_PANEL', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_ALL_APTS', 'ADM_MASTERS', 'ADM_CLIENTS',
  'ADM_SVC_LIST', 'ADM_CANCEL_ALL', 'ADM_CONFIRM_ALL', 'BILLING', 'BOOK_FOR_CLIENT',
  'MST_PANEL', 'MST_TODAY', 'MST_TOMORROW', 'MST_CALENDAR',
  'SYSADM_PANEL', 'TENANT_LIST', 'SUPPORT_LIST', 'CREATE_TENANT', 'BOT_NEW',
];

describe('canRoleRunTag — fail-closed role→tag gate (#S01-3)', () => {
  it('client may run every client-facing tag', () => {
    for (const tag of CLIENT_TAGS) {
      expect(canRoleRunTag('client', tag), `client should run ${tag}`).toBe(true);
    }
  });

  it('client may NOT run any privileged ADM_*/MST_*/SYSADM_*/CREATE_TENANT/BOT_NEW tag', () => {
    for (const tag of PRIVILEGED_TAGS) {
      expect(canRoleRunTag('client', tag), `client must NOT run ${tag}`).toBe(false);
    }
  });

  it('an unknown / newly-added tag defaults to DENIED for a client', () => {
    expect(canRoleRunTag('client', 'TOTALLY_NEW_TAG')).toBe(false);
    expect(canRoleRunTag('client', 'ADM_NUKE_EVERYTHING')).toBe(false);
    expect(canRoleRunTag('client', '')).toBe(false);
    expect(canRoleRunTag('client', undefined)).toBe(false);
  });

  it('an unknown tag defaults to DENIED for every role (default-deny)', () => {
    for (const role of ['client', 'master', 'tenant_owner', 'support', 'technical_support', 'system_admin']) {
      expect(canRoleRunTag(role, 'UNREGISTERED_FUTURE_TAG'), `${role} must deny unknown tag`).toBe(false);
    }
  });

  it('an unknown / null role is denied even for a known tag', () => {
    expect(canRoleRunTag('hacker', 'MY_APTS')).toBe(false);
    expect(canRoleRunTag(undefined, 'MY_APTS')).toBe(false);
    expect(canRoleRunTag(null, 'ADM_PANEL')).toBe(false);
  });

  it('technical_support has no AI action grants (denied everything)', () => {
    for (const tag of [...CLIENT_TAGS, ...PRIVILEGED_TAGS]) {
      expect(canRoleRunTag('technical_support', tag), `technical_support must NOT run ${tag}`).toBe(false);
    }
  });

  // ── positive parity: mirror the exact grants currently in executeAIAction ──
  it('tenant_owner runs its granted admin tags but not platform/master-only tags', () => {
    const allowed = [
      'BILLING', 'ADM_CLIENTS', 'ADM_ALL_APTS', 'ADM_SVC_LIST', 'BOOK_FOR_CLIENT',
      'ADM_PANEL', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_MASTERS', 'ADM_CANCEL_ALL', 'ADM_CONFIRM_ALL',
    ];
    for (const tag of allowed) expect(canRoleRunTag('tenant_owner', tag), `owner ${tag}`).toBe(true);
    for (const tag of ['SYSADM_PANEL', 'CREATE_TENANT', 'BOT_NEW', 'MST_PANEL', 'MST_CALENDAR']) {
      expect(canRoleRunTag('tenant_owner', tag), `owner must NOT run ${tag}`).toBe(false);
    }
  });

  it('master runs its granted tags but not admin/platform tags', () => {
    const allowed = ['BILLING', 'BOOK_FOR_CLIENT', 'MST_CALENDAR', 'MST_PANEL', 'MST_TODAY', 'MST_TOMORROW', 'ADM_CONFIRM_ALL'];
    for (const tag of allowed) expect(canRoleRunTag('master', tag), `master ${tag}`).toBe(true);
    for (const tag of ['ADM_PANEL', 'ADM_CLIENTS', 'SYSADM_PANEL', 'CREATE_TENANT', 'BOT_NEW']) {
      expect(canRoleRunTag('master', tag), `master must NOT run ${tag}`).toBe(false);
    }
  });

  it('support runs only platform-read + billing tags', () => {
    for (const tag of ['BILLING', 'SYSADM_PANEL', 'TENANT_LIST', 'SUPPORT_LIST']) {
      expect(canRoleRunTag('support', tag), `support ${tag}`).toBe(true);
    }
    for (const tag of ['CREATE_TENANT', 'BOT_NEW', 'ADM_PANEL', 'ADM_CLIENTS', 'MST_PANEL']) {
      expect(canRoleRunTag('support', tag), `support must NOT run ${tag}`).toBe(false);
    }
  });

  it('system_admin runs the full privileged surface except master-only MST_* tags', () => {
    // Mirrors executeAIAction: system_admin gets admin + platform + billing +
    // BOOK_FOR_CLIENT, but the MST_* panel/calendar tags are master-only.
    const masterOnly = new Set(['MST_PANEL', 'MST_TODAY', 'MST_TOMORROW', 'MST_CALENDAR']);
    for (const tag of PRIVILEGED_TAGS) {
      const expected = !masterOnly.has(tag);
      expect(canRoleRunTag('system_admin', tag), `system_admin ${tag}`).toBe(expected);
    }
  });

  it('all client tags are runnable by every staff role (no regression for shared tags)', () => {
    for (const role of ['master', 'tenant_owner', 'support', 'system_admin']) {
      for (const tag of CLIENT_TAGS) {
        expect(canRoleRunTag(role, tag), `${role} should still run client tag ${tag}`).toBe(true);
      }
    }
  });

  it('AI_TAG_ROLES is the single source: every tag maps to a Set of roles', () => {
    expect(AI_TAG_ROLES).toBeTruthy();
    for (const [tag, roles] of Object.entries(AI_TAG_ROLES)) {
      expect(roles instanceof Set, `${tag} should map to a Set`).toBe(true);
      expect(roles.size, `${tag} should grant at least one role`).toBeGreaterThan(0);
    }
  });
});
