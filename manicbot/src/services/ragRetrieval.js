/**
 * RAG retrieval chokepoint — the ONLY place the bot reads the knowledge base.
 *
 * Concentrating retrieval here keeps the tenant-isolation logic in one
 * auditable, unit-tested spot. The scope is resolved from server-trusted
 * `ctx` + `role` (never from user input) and is FAIL-CLOSED: an unknown role,
 * or a tenant-scoped caller without a concrete `ctx.tenantId`, retrieves
 * NOTHING rather than everything.
 *
 * Phase 2 ships only the per-tenant salon KB, which lives in the tenant-scoped
 * D1 table `rag_chunks` (bge-m3 Float32-BLOB embeddings, brute-forced in the
 * Worker). Isolation rides the `WHERE tenant_id = ?` invariant the CI scanner
 * gates. The public blog ('public') and internal docs ('internal') corpora are
 * Vectorize-backed and wired in later phases; until then they return [].
 *
 * Every code path is wrapped so retrieval is STRICTLY ADDITIVE: any failure
 * (no AI binding, embed error, timeout, empty corpus) yields [] and the caller
 * falls back to today's static prompt — retrieval never blocks an answer.
 */
import { dbAll } from '../utils/db.js';
import { embedTexts } from './embeddings.js';
import { deserializeEmbedding, rankTopK } from './ragVectorMath.js';
import { RAG_TOP_K, RAG_MIN_SCORE, RAG_RETRIEVAL_TIMEOUT_MS } from '../config.js';
import { log } from '../utils/logger.js';

const TENANT_ROLES = new Set(['client', 'master', 'tenant_owner', 'tenant_manager']);

/**
 * Resolve which corpus scope a caller may read, from trusted context + role.
 * @returns {'tenant'|'public'|'internal'|null} null = fail closed (no access)
 */
export function resolveScope(ctx, role) {
  if (role === 'system_admin') return 'internal'; // God-Mode ops bot (Phase 5)
  if (role === 'public') return 'public';          // public /ai page (Phase 4)
  if (TENANT_ROLES.has(role)) return 'tenant';
  return null;
}

/**
 * Retrieve the most relevant knowledge chunks for a query.
 * @param {any} ctx
 * @param {{ queryText: string, role: string }} args
 * @returns {Promise<Array<{ content: string, sourceTable: string, lang: string|null, score: number }>>}
 */
export async function retrieveContext(ctx, { queryText, role } = {}) {
  try {
    const scope = resolveScope(ctx, role);
    // Phase 2: only the tenant D1 corpus is wired. public/internal → [] for now.
    if (scope !== 'tenant') return [];
    if (!ctx?.tenantId) return []; // fail-closed: no tenant boundary → nothing

    const q = String(queryText || '').trim();
    if (q.length < 2) return [];

    return await withTimeout(retrieveTenant(ctx, q), RAG_RETRIEVAL_TIMEOUT_MS);
  } catch (e) {
    log.error('rag.retrieve', e instanceof Error ? e : new Error(String(e?.message)));
    return [];
  }
}

/**
 * Tenant KB read: embed the query, load this tenant's chunks (WHERE tenant_id=?
 * — the isolation boundary), rank by cosine, post-filter defensively.
 */
async function retrieveTenant(ctx, queryText) {
  const vecs = await embedTexts(ctx, [queryText]);
  const queryVec = vecs && vecs[0];
  if (!queryVec) return [];

  // Tenant-scoped read. `tenant_id = ?` is the access boundary (CI-gated).
  const rows = await dbAll(
    ctx,
    'SELECT tenant_id, id, content, source_table, lang, embedding FROM rag_chunks WHERE tenant_id = ?',
    ctx.tenantId,
  );
  if (!rows.length) return [];

  const candidates = rows
    // Defense-in-depth: assert tenant ownership again even though the query
    // already filtered — guards a future refactor that widens the SELECT.
    .filter((r) => r.tenant_id === ctx.tenantId)
    .map((r) => ({ ...r, embedding: deserializeEmbedding(r.embedding) }));

  const top = rankTopK(queryVec, candidates, { topK: RAG_TOP_K, minScore: RAG_MIN_SCORE });
  return top.map(({ item, score }) => ({
    content: item.content,
    sourceTable: item.source_table,
    lang: item.lang ?? null,
    score,
  }));
}

/**
 * Resolve `promise`, or `[]` if it exceeds `ms`. Clears the timer either way so
 * no dangling timeout keeps the isolate (or a test runner) alive.
 */
async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return Array.isArray(result) ? result : [];
  } finally {
    clearTimeout(timer);
  }
}
