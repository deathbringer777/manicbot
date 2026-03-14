/**
 * Тесты ролей: создатель (ADMIN_CHAT_ID), isAdmin, isPlatformAdmin.
 * Роли в системе: админ (бог/создатель), саппорты, мастер, салон (tenant_owner), клиент.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCreator, isAdmin, isPlatformAdmin } from '../src/services/users.js';

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
    const ctx = { adminChatId: '111', kv: {}, prefix: 't:default:' };
    expect(await isAdmin(ctx, 111)).toBe(true);
    expect(await isAdmin(ctx, '111')).toBe(true);
  });

});

describe('isPlatformAdmin', () => {
  it('creator is platform admin without KV role', async () => {
    const ctx = { adminChatId: '777', globalKv: null };
    expect(await isPlatformAdmin(ctx, 777)).toBe(true);
  });

  it('non-creator without globalKv is not platform admin', async () => {
    const ctx = { adminChatId: '777', globalKv: null };
    expect(await isPlatformAdmin(ctx, 888)).toBe(false);
  });

  it('non-creator with system_admin in globalKv is platform admin', async () => {
    const mockKv = {
      get: vi.fn().mockResolvedValue({ role: 'system_admin', createdAt: Date.now() }),
    };
    const ctx = { adminChatId: null, globalKv: mockKv };
    expect(await isPlatformAdmin(ctx, 888)).toBe(true);
    expect(mockKv.get).toHaveBeenCalledWith('role:888', 'json');
  });

  it('support role in globalKv is not platform admin', async () => {
    const mockKv = {
      get: vi.fn().mockResolvedValue({ role: 'support', createdAt: Date.now() }),
    };
    const ctx = { adminChatId: null, globalKv: mockKv };
    expect(await isPlatformAdmin(ctx, 888)).toBe(false);
  });
});
