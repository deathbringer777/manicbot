/**
 * Тесты для функций удаления агентов в src/roles/roles.js
 * Покрывает:
 *  - removeSupportAgent (P3.4: null-check)
 *  - removeTechnicalSupportAgent (P3.5: dual-delete поведение)
 *  - removeTenantSupportAgent
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  addSupportAgent,
  removeSupportAgent,
  getSupportAgents,
  addTechnicalSupportAgent,
  removeTechnicalSupportAgent,
  getTechnicalSupportAgents,
  addTenantSupportAgent,
  removeTenantSupportAgent,
  getTenantSupportAgents,
} from '../src/roles/roles.js';
import { createMockD1 } from './helpers/mock-db.js';

function makeCtx(opts = {}) {
  return {
    db: opts.db || createMockD1(),
    tenantId: opts.tenantId || 'tenant1',
    prefix: 't:tenant1:',
  };
}

// ─── removeSupportAgent ───────────────────────────────────────────────────────

describe('removeSupportAgent', () => {
  it('возвращает false без db', async () => {
    const ctx = { db: null };
    expect(await removeSupportAgent(ctx, 100)).toBe(false);
  });

  it('возвращает false если chatId = null (P3.4)', async () => {
    const ctx = makeCtx();
    expect(await removeSupportAgent(ctx, null)).toBe(false);
  });

  it('возвращает false если chatId = undefined (P3.4)', async () => {
    const ctx = makeCtx();
    expect(await removeSupportAgent(ctx, undefined)).toBe(false);
  });

  it('возвращает true и удаляет агента', async () => {
    const ctx = makeCtx();
    await addSupportAgent(ctx, 42);
    expect(await getSupportAgents(ctx)).toContain(42);

    const result = await removeSupportAgent(ctx, 42);
    expect(result).toBe(true);
    expect(await getSupportAgents(ctx)).not.toContain(42);
  });

  it('возвращает true даже если агент не существует (idempotent)', async () => {
    const ctx = makeCtx();
    expect(await removeSupportAgent(ctx, 9999)).toBe(true);
  });

  it('удаляет только support-тип, не трогает technical', async () => {
    const ctx = makeCtx();
    await addSupportAgent(ctx, 55);
    await addTechnicalSupportAgent(ctx, 55);

    await removeSupportAgent(ctx, 55);

    expect(await getSupportAgents(ctx)).not.toContain(55);
    expect(await getTechnicalSupportAgents(ctx)).toContain(55);
  });
});

// ─── removeTechnicalSupportAgent — dual-delete (P3.5) ─────────────────────────

describe('removeTechnicalSupportAgent', () => {
  it('возвращает false без db', async () => {
    expect(await removeTechnicalSupportAgent({ db: null }, 1)).toBe(false);
  });

  it('возвращает false если chatId = null', async () => {
    const ctx = makeCtx();
    expect(await removeTechnicalSupportAgent(ctx, null)).toBe(false);
  });

  it('удаляет technical-тип', async () => {
    const ctx = makeCtx();
    await addTechnicalSupportAgent(ctx, 77);
    expect(await getTechnicalSupportAgents(ctx)).toContain(77);

    await removeTechnicalSupportAgent(ctx, 77);
    expect(await getTechnicalSupportAgents(ctx)).not.toContain(77);
  });

  it('также удаляет support-тип (намеренный dual-delete P3.5)', async () => {
    const ctx = makeCtx();
    await addSupportAgent(ctx, 77);
    await addTechnicalSupportAgent(ctx, 77);

    await removeTechnicalSupportAgent(ctx, 77);

    expect(await getTechnicalSupportAgents(ctx)).not.toContain(77);
    expect(await getSupportAgents(ctx)).not.toContain(77);
  });

  it('возвращает true если агент не существует (idempotent)', async () => {
    const ctx = makeCtx();
    expect(await removeTechnicalSupportAgent(ctx, 12345)).toBe(true);
  });
});

// ─── removeTenantSupportAgent ─────────────────────────────────────────────────

describe('removeTenantSupportAgent', () => {
  it('возвращает false без tenantId', async () => {
    const ctx = { db: createMockD1(), tenantId: null };
    expect(await removeTenantSupportAgent(ctx, 10)).toBe(false);
  });

  it('возвращает false без db', async () => {
    const ctx = { db: null, tenantId: 'tenant1' };
    expect(await removeTenantSupportAgent(ctx, 10)).toBe(false);
  });

  it('добавляет и удаляет агента тенанта', async () => {
    const ctx = makeCtx();
    await addTenantSupportAgent(ctx, 88);
    expect(await getTenantSupportAgents(ctx)).toContain(88);

    await removeTenantSupportAgent(ctx, 88);
    expect(await getTenantSupportAgents(ctx)).not.toContain(88);
  });

  it('изолирован по tenantId', async () => {
    const db = createMockD1();
    const ctx1 = makeCtx({ db, tenantId: 'tenant-A' });
    const ctx2 = makeCtx({ db, tenantId: 'tenant-B' });

    await addTenantSupportAgent(ctx1, 99);
    await addTenantSupportAgent(ctx2, 99);

    await removeTenantSupportAgent(ctx1, 99);

    expect(await getTenantSupportAgents(ctx1)).not.toContain(99);
    expect(await getTenantSupportAgents(ctx2)).toContain(99);
  });
});
