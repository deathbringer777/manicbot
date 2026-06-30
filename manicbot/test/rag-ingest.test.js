import { describe, it, expect } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { buildTenantChunks, reindexTenantKb } from '../src/services/ragIngest.js';
import { phaseRagReindex } from '../src/handlers/cron.js';

const J = (o) => JSON.stringify(o);

describe('buildTenantChunks (pure)', () => {
  it('emits one FAQ chunk per language, skipping inactive rows', () => {
    const chunks = buildTenantChunks({
      faqs: [
        { id: 'q1', question_json: J({ ru: 'Делаете снятие?', en: 'Do you remove gel?' }), answer_json: J({ ru: 'Да, 30 zł', en: 'Yes, 30 zł' }), active: 1 },
        { id: 'q2', question_json: J({ ru: 'Скрытый' }), answer_json: J({ ru: 'нет' }), active: 0 },
      ],
      services: [],
      masters: [],
    });
    const ids = chunks.map((c) => c.id);
    expect(ids).toContain('salon_faq:q1:ru:0');
    expect(ids).toContain('salon_faq:q1:en:0');
    expect(ids.some((id) => id.startsWith('salon_faq:q2'))).toBe(false); // inactive skipped
    const ru = chunks.find((c) => c.id === 'salon_faq:q1:ru:0');
    expect(ru.content).toContain('Делаете снятие?');
    expect(ru.content).toContain('Да, 30 zł');
    expect(ru.lang).toBe('ru');
  });

  it('emits a service chunk only for active, visible services', () => {
    const chunks = buildTenantChunks({
      faqs: [],
      services: [
        { svc_id: 'gel', names: J({ ru: 'Гель-лак' }), description: 'Стойкое покрытие', promo: '-20%', active: 1, hidden: 0 },
        { svc_id: 'sec', names: J({ ru: 'Секрет' }), description: 'x', active: 1, hidden: 1 },
        { svc_id: 'off', names: J({ ru: 'Выкл' }), description: 'y', active: 0, hidden: 0 },
      ],
      masters: [],
    });
    const ids = chunks.map((c) => c.id);
    expect(ids).toEqual(['services:gel:mul:0']);
    expect(chunks[0].content).toContain('Гель-лак');
    expect(chunks[0].content).toContain('Стойкое покрытие');
    expect(chunks[0].content).toContain('-20%');
  });

  it('emits a master chunk only when a bio is present', () => {
    const chunks = buildTenantChunks({
      faqs: [],
      services: [],
      masters: [
        { chat_id: 111, name: 'Аня', bio: '10 лет опыта, наращивание', active: 1 },
        { chat_id: 222, name: 'Без био', bio: null, active: 1 },
      ],
    });
    expect(chunks.map((c) => c.id)).toEqual(['masters:111:mul:0']);
    expect(chunks[0].content).toContain('Аня');
    expect(chunks[0].content).toContain('10 лет опыта');
  });
});

// ctx whose embed returns a distinct vector per input text; counts embed calls.
function embedCtx(tenantId = 'A') {
  const ctx = makeCtx({ tenantId });
  ctx._embedBatches = 0;
  ctx._embedTexts = 0;
  ctx.AI = {
    run: async (_model, { text }) => {
      ctx._embedBatches += 1;
      ctx._embedTexts += text.length;
      return { data: text.map((_t, i) => [1 + i * 0.01, 0, 0]) };
    },
  };
  return ctx;
}

function seedSources(ctx, tenantId) {
  ctx.db._getTable('salon_faq').push(
    { tenant_id: tenantId, id: 'q1', question_json: J({ ru: 'Делаете снятие?' }), answer_json: J({ ru: 'Да, 30 zł' }), active: 1 },
    { tenant_id: tenantId, id: 'q2', question_json: J({ ru: 'Парковка?' }), answer_json: J({ ru: 'Во дворе' }), active: 1 },
  );
  ctx.db._getTable('services').push(
    { tenant_id: tenantId, svc_id: 'gel', names: J({ ru: 'Гель-лак' }), description: 'Стойкое', promo: null, active: 1, hidden: 0 },
  );
  ctx.db._getTable('masters').push(
    { tenant_id: tenantId, chat_id: 111, name: 'Аня', bio: 'Наращивание', active: 1 },
  );
}

describe('reindexTenantKb', () => {
  it('indexes all chunks for the tenant and records a content hash + embedding', async () => {
    const ctx = embedCtx('A');
    seedSources(ctx, 'A');
    const res = await reindexTenantKb(ctx, 'A');
    expect(res.error).toBeFalsy();
    const rows = ctx.db._getTable('rag_chunks');
    expect(rows.length).toBe(4); // 2 faq (ru) + 1 service + 1 master
    expect(rows.every((r) => r.tenant_id === 'A')).toBe(true);
    expect(rows.every((r) => r.content_hash && r.embedding && r.model === '@cf/baai/bge-m3')).toBe(true);
    expect(res.indexed).toBe(4);
    expect(res.skipped).toBe(0);
  });

  it('is idempotent: a second run with no changes re-embeds nothing', async () => {
    const ctx = embedCtx('A');
    seedSources(ctx, 'A');
    await reindexTenantKb(ctx, 'A');
    const batchesAfterFirst = ctx._embedBatches;
    const res2 = await reindexTenantKb(ctx, 'A');
    expect(res2.indexed).toBe(0);
    expect(res2.skipped).toBe(4);
    expect(ctx._embedBatches).toBe(batchesAfterFirst); // no new embed batch
    expect(ctx.db._getTable('rag_chunks').length).toBe(4);
  });

  it('re-indexes only a changed chunk and deletes a removed one', async () => {
    const ctx = embedCtx('A');
    seedSources(ctx, 'A');
    await reindexTenantKb(ctx, 'A');

    // Edit q1's answer; delete q2 entirely.
    const faqs = ctx.db._getTable('salon_faq');
    faqs.find((f) => f.id === 'q1').answer_json = J({ ru: 'Да, теперь 35 zł' });
    ctx.db.prepare('DELETE FROM salon_faq WHERE tenant_id = ? AND id = ?').bind('A', 'q2');
    const kept = faqs.filter((f) => f.id !== 'q2');
    ctx.db._tables.set('salon_faq', kept);

    const res = await reindexTenantKb(ctx, 'A');
    expect(res.indexed).toBe(1); // only q1:ru changed
    expect(res.deleted).toBe(1); // q2:ru removed
    const ids = ctx.db._getTable('rag_chunks').map((r) => r.id);
    expect(ids).toContain('salon_faq:q1:ru:0');
    expect(ids).not.toContain('salon_faq:q2:ru:0');
  });

  it('never touches another tenant\'s chunks', async () => {
    const ctx = embedCtx('A');
    seedSources(ctx, 'A');
    // Pre-existing chunk for tenant B.
    ctx.db._getTable('rag_chunks').push({ tenant_id: 'B', id: 'salon_faq:bX:ru:0', content: 'B private', content_hash: 'zzz', embedding: [1, 0, 0], model: 'm' });
    await reindexTenantKb(ctx, 'A');
    const bRows = ctx.db._getTable('rag_chunks').filter((r) => r.tenant_id === 'B');
    expect(bRows.length).toBe(1);
    expect(bRows[0].content).toBe('B private');
  });

  it('does NOT wipe existing chunks when embedding fails', async () => {
    const ctx = embedCtx('A');
    seedSources(ctx, 'A');
    await reindexTenantKb(ctx, 'A');
    const before = ctx.db._getTable('rag_chunks').length;

    // Now break embedding and force a change so a re-embed is attempted.
    ctx.AI = { run: async () => { throw new Error('AI down'); } };
    ctx.db._getTable('salon_faq').find((f) => f.id === 'q1').answer_json = J({ ru: 'changed' });
    const res = await reindexTenantKb(ctx, 'A');
    expect(res.error).toBeTruthy();
    expect(ctx.db._getTable('rag_chunks').length).toBe(before); // unchanged — no data loss
  });
});

describe('phaseRagReindex — cron freshness (flag-gated)', () => {
  it('is a no-op when RAG_KB_ENABLED is off (zero cost)', async () => {
    const ctx = embedCtx('A');
    seedSources(ctx, 'A'); // no ctx.RAG_KB_ENABLED
    await phaseRagReindex(ctx, Date.now());
    expect(ctx.db._getTable('rag_chunks').length).toBe(0);
    expect(ctx._embedBatches).toBe(0);
  });

  it('reindexes the tenant when the flag is on', async () => {
    const ctx = embedCtx('A');
    ctx.RAG_KB_ENABLED = '1';
    seedSources(ctx, 'A');
    await phaseRagReindex(ctx, Date.now());
    expect(ctx.db._getTable('rag_chunks').length).toBe(4);
  });
});
