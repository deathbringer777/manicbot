import { describe, it, expect } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { retrieveContext, resolveScope } from '../src/services/ragRetrieval.js';

// Seed a rag_chunks row directly (bypasses the ingestion pipeline — retrieval
// is tested in isolation). `embedding` is a plain number[]; deserializeEmbedding
// accepts arrays, so no BLOB encoding is needed here.
function seedChunk(ctx, { tenantId, id, content, embedding }) {
  ctx.db._getTable('rag_chunks').push({
    tenant_id: tenantId,
    id,
    source_table: 'salon_faq',
    source_id: id,
    lang: 'ru',
    chunk_ix: 0,
    content,
    embedding,
    dim: embedding.length,
    model: '@cf/baai/bge-m3',
    content_hash: 'h',
    updated_at: 0,
  });
}

// A ctx whose Workers AI binding always embeds the query as `queryVec`.
function ctxWithEmbed(opts, queryVec) {
  const ctx = makeCtx(opts);
  ctx.AI = { run: async (_model, { text }) => ({ data: text.map(() => queryVec) }) };
  return ctx;
}

describe('resolveScope (fail-closed)', () => {
  it('maps tenant-facing roles to the tenant scope', () => {
    for (const role of ['client', 'master', 'tenant_owner', 'tenant_manager']) {
      expect(resolveScope({ tenantId: 't1' }, role)).toBe('tenant');
    }
  });
  it('maps system_admin → internal and public → public', () => {
    expect(resolveScope({}, 'system_admin')).toBe('internal');
    expect(resolveScope({}, 'public')).toBe('public');
  });
  it('returns null for unknown/empty role (fail closed)', () => {
    expect(resolveScope({ tenantId: 't1' }, 'weird')).toBeNull();
    expect(resolveScope({ tenantId: 't1' }, undefined)).toBeNull();
  });
});

describe('retrieveContext — tenant KB', () => {
  it('returns the tenant\'s own chunks ranked by similarity', async () => {
    const ctx = ctxWithEmbed({ tenantId: 'A' }, [1, 0, 0]);
    seedChunk(ctx, { tenantId: 'A', id: 'faq1', content: 'снятие гель-лака 30 zł', embedding: [0.95, 0.1, 0] });
    seedChunk(ctx, { tenantId: 'A', id: 'faq2', content: 'парковка во дворе', embedding: [0.1, 0.99, 0] }); // ~orthogonal
    const out = await retrieveContext(ctx, { queryText: 'сколько стоит снятие?', role: 'client' });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].content).toContain('снятие гель-лака');
  });

  it('NEVER returns another tenant\'s chunk — even when it is a better match (the isolation gate)', async () => {
    const ctx = ctxWithEmbed({ tenantId: 'A' }, [1, 0, 0]);
    // Tenant A: a decent match. Tenant B: a PERFECT match (cosine 1.0).
    seedChunk(ctx, { tenantId: 'A', id: 'a1', content: 'SALON-A secret price 60', embedding: [0.6, 0.8, 0] }); // 0.6
    seedChunk(ctx, { tenantId: 'B', id: 'b1', content: 'SALON-B secret price 999', embedding: [1, 0, 0] });    // 1.0
    const out = await retrieveContext(ctx, { queryText: 'price?', role: 'client' });
    const joined = out.map((c) => c.content).join(' | ');
    expect(joined).toContain('SALON-A');
    expect(joined).not.toContain('SALON-B'); // tenant_id, not similarity, decides
  });

  it('is fail-closed: tenant scope with no tenantId returns []', async () => {
    const ctx = ctxWithEmbed({ tenantId: null }, [1, 0, 0]);
    seedChunk(ctx, { tenantId: 'A', id: 'a1', content: 'x', embedding: [1, 0, 0] });
    expect(await retrieveContext(ctx, { queryText: 'price?', role: 'client' })).toEqual([]);
  });

  it('does not serve public/internal corpora on the tenant path (Phase 2 is tenant-only)', async () => {
    const ctx = ctxWithEmbed({ tenantId: 'A' }, [1, 0, 0]);
    seedChunk(ctx, { tenantId: 'A', id: 'a1', content: 'x', embedding: [1, 0, 0] });
    expect(await retrieveContext(ctx, { queryText: 'q', role: 'public' })).toEqual([]);
    expect(await retrieveContext(ctx, { queryText: 'q', role: 'system_admin' })).toEqual([]);
  });

  it('degrades gracefully to [] when embedding fails', async () => {
    const ctx = makeCtx({ tenantId: 'A' });
    ctx.AI = { run: async () => { throw new Error('AI down'); } }; // embed throws, no REST token
    seedChunk(ctx, { tenantId: 'A', id: 'a1', content: 'x', embedding: [1, 0, 0] });
    expect(await retrieveContext(ctx, { queryText: 'price?', role: 'client' })).toEqual([]);
  });

  it('returns [] for an empty corpus', async () => {
    const ctx = ctxWithEmbed({ tenantId: 'A' }, [1, 0, 0]);
    expect(await retrieveContext(ctx, { queryText: 'price?', role: 'client' })).toEqual([]);
  });

  it('drops weak matches below the score floor', async () => {
    const ctx = ctxWithEmbed({ tenantId: 'A' }, [1, 0, 0]);
    seedChunk(ctx, { tenantId: 'A', id: 'a1', content: 'orthogonal junk', embedding: [0, 1, 0] }); // score ~0 < 0.5
    expect(await retrieveContext(ctx, { queryText: 'price?', role: 'client' })).toEqual([]);
  });
});
