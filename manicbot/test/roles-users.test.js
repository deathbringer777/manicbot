/**
 * Тесты ролей: создатель (ADMIN_CHAT_ID), isAdmin, isPlatformAdmin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCreator, isAdmin, isPlatformAdmin } from '../src/services/users.js';
import { setPlatformRole } from '../src/roles/roles.js';
import { createMockD1 } from './helpers/mock-db.js';

describe('isCreator', () => {
  it('returns true when cid equals adminChatId (string)', () => {
    expect(isCreator({ adminChatId: '12345' }, 12345)).toBe(true);
    expect(isCreator({ adminChatId: '12345' }, '12345')).toBe(true);
  });

  it('returns false when cid differs', () => {
    expect(isCreator({ adminChatId: '12345' }, 999)).toBe(false);
    expect(isCreator({ adminChatId: '12345' }, null)).toBe(false);
  });

  it('returns false when adminChatId is missing', () => {
    expect(isCreator({}, 12345)).toBe(false);
    expect(isCreator({ adminChatId: null }, 12345)).toBe(false);
  });

  it('returns false when cid is null/undefined', () => {
    expect(isCreator({ adminChatId: '12345' }, null)).toBe(false);
  });
});

describe('isAdmin (with creator)', () => {
  it('creator is always admin regardless of KV', async () => {
    const ctx = { adminChatId: '111', kv: {}, db: createMockD1(), prefix: 't:default:', tenantId: 'default' };
    expect(await isAdmin(ctx, 111)).toBe(true);
    expect(await isAdmin(ctx, '111')).toBe(true);
  });
});

describe('isPlatformAdmin', () => {
  it('creator is platform admin without DB', async () => {
    const ctx = { adminChatId: '777', db: null };
    expect(await isPlatformAdmin(ctx, 777)).toBe(true);
  });

  it('non-creator without db is not platform admin', async () => {
    const ctx = { adminChatId: '777', db: null };
    expect(await isPlatformAdmin(ctx, 888)).toBe(false);
  });

  it('non-creator with system_admin in D1 is platform admin', async () => {
    const db = createMockD1();
    const ctx = { adminChatId: null, db };
    await setPlatformRole(ctx, 888, 'system_admin');
    expect(await isPlatformAdmin(ctx, 888)).toBe(true);
  });

  it('support role in D1 is not platform admin', async () => {
    const db = createMockD1();
    const ctx = { adminChatId: null, db };
    await setPlatformRole(ctx, 888, 'support');
    expect(await isPlatformAdmin(ctx, 888)).toBe(false);
  });
});
