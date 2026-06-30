/**
 * RAG ingestion — build a tenant's knowledge-base index in D1 `rag_chunks`.
 *
 * Runs in the WORKER (not the ThinkPad sidecar): a salon's corpus is tiny
 * (~tens of chunks) so chunking + one batched bge-m3 embed + the D1 writes fit
 * comfortably in a Worker invocation. Triggered by an admin endpoint / cron /
 * (later) a salon_faq save. Idempotent via a per-chunk content hash, so it is
 * safe to re-run; stale chunks (whose source was edited/removed) are pruned.
 *
 * Every D1 access is scoped by `WHERE tenant_id = ?` — the isolation boundary
 * the CI scanner gates.
 */
import { dbAll, dbRun } from '../utils/db.js';
import { embedTexts } from './embeddings.js';
import { serializeEmbedding } from './ragVectorMath.js';
import { RAG_EMBED_MODEL, RAG_EMBED_DIM } from '../config.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

const FAQ_LANGS = ['ru', 'uk', 'en', 'pl'];

function parseJsonObj(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Turn a tenant's source rows into chunk descriptors. Pure (no I/O) so the
 * chunking policy is unit-testable. Chunk id = `${sourceTable}:${sourceId}:${lang|'mul'}:${ix}`.
 *
 * @param {{ faqs?: object[], services?: object[], masters?: object[] }} sources
 * @returns {Array<{ id, sourceTable, sourceId, lang: string|null, content: string }>}
 */
export function buildTenantChunks({ faqs = [], services = [], masters = [] } = {}) {
  const chunks = [];

  // salon_faq — one chunk per (row, language present). The primary KB.
  for (const f of faqs) {
    if (f.active === 0) continue;
    const q = parseJsonObj(f.question_json);
    const a = parseJsonObj(f.answer_json);
    for (const lang of FAQ_LANGS) {
      const qt = String(q[lang] || '').trim();
      const at = String(a[lang] || '').trim();
      if (!qt && !at) continue;
      chunks.push({
        id: `salon_faq:${f.id}:${lang}:0`,
        sourceTable: 'salon_faq',
        sourceId: String(f.id),
        lang,
        content: `Вопрос: ${qt}\nОтвет: ${at}`.trim(),
      });
    }
  }

  // services — one chunk per active, visible service (name + description + promo).
  // bge-m3 is multilingual, so a single mixed-language chunk retrieves across langs.
  for (const s of services) {
    if (s.active === 0 || s.hidden === 1) continue;
    const names = parseJsonObj(s.names);
    const name = String(names.ru || names.en || names.uk || names.pl || s.svc_id || '').trim();
    const desc = String(s.description || '').trim();
    const promo = String(s.promo || '').trim();
    if (!name && !desc) continue;
    chunks.push({
      id: `services:${s.svc_id}:mul:0`,
      sourceTable: 'services',
      sourceId: String(s.svc_id),
      lang: null,
      content: `Услуга: ${name}.${desc ? ' ' + desc : ''}${promo ? ' Акция: ' + promo : ''}`.trim(),
    });
  }

  // masters — one chunk per active master that has a bio.
  for (const m of masters) {
    if (m.active === 0) continue;
    const bio = String(m.bio || '').trim();
    if (!bio) continue;
    chunks.push({
      id: `masters:${m.chat_id}:mul:0`,
      sourceTable: 'masters',
      sourceId: String(m.chat_id),
      lang: null,
      content: `Мастер ${String(m.name || '').trim()}: ${bio}`.trim(),
    });
  }

  return chunks;
}

/**
 * Rebuild the KB index for one tenant. Idempotent: only changed/new chunks are
 * re-embedded (content-hash compare), and chunks whose source is gone are
 * deleted. On embed failure the existing index is left intact (no data loss).
 *
 * @param {any} ctx
 * @param {string} tenantId
 * @returns {Promise<{ error: string|null, indexed: number, skipped: number, deleted: number, total: number }>}
 */
export async function reindexTenantKb(ctx, tenantId) {
  if (!tenantId) return { error: 'no_tenant', indexed: 0, skipped: 0, deleted: 0, total: 0 };
  try {
    // Tenant-scoped reads — `tenant_id = ?` is the isolation boundary.
    const faqs = await dbAll(ctx, 'SELECT id, question_json, answer_json, active FROM salon_faq WHERE tenant_id = ?', tenantId);
    const services = await dbAll(ctx, 'SELECT svc_id, names, description, promo, active, hidden FROM services WHERE tenant_id = ?', tenantId);
    const masters = await dbAll(ctx, 'SELECT chat_id, name, bio, active FROM masters WHERE tenant_id = ?', tenantId);

    const chunks = buildTenantChunks({ faqs, services, masters });

    const existing = await dbAll(ctx, 'SELECT id, content_hash FROM rag_chunks WHERE tenant_id = ?', tenantId);
    const existingHash = new Map(existing.map((r) => [r.id, r.content_hash]));
    const currentIds = new Set(chunks.map((c) => c.id));

    // Hash every current chunk; only (re)embed the ones that changed.
    const toEmbed = [];
    for (const c of chunks) {
      c.hash = await sha256hex(c.content);
      if (existingHash.get(c.id) !== c.hash) toEmbed.push(c);
    }

    let indexed = 0;
    if (toEmbed.length) {
      const vectors = await embedTexts(ctx, toEmbed.map((c) => c.content));
      if (!vectors || vectors.length !== toEmbed.length) {
        // Embedding unavailable — abort WITHOUT mutating the existing index.
        log.error('rag.ingest', new Error('embed_failed'), { tenantId, want: toEmbed.length });
        return { error: 'embed_failed', indexed: 0, skipped: chunks.length - toEmbed.length, deleted: 0, total: chunks.length };
      }
      const now = nowSec();
      for (let i = 0; i < toEmbed.length; i++) {
        const c = toEmbed[i];
        await dbRun(
          ctx,
          `INSERT OR REPLACE INTO rag_chunks (tenant_id, id, source_table, source_id, lang, chunk_ix, content, embedding, dim, model, content_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          tenantId, c.id, c.sourceTable, c.sourceId, c.lang, 0, c.content, serializeEmbedding(vectors[i]), RAG_EMBED_DIM, RAG_EMBED_MODEL, c.hash, now,
        );
        indexed++;
      }
    }

    // Prune chunks whose source row was edited away or deleted.
    let deleted = 0;
    for (const r of existing) {
      if (!currentIds.has(r.id)) {
        await dbRun(ctx, 'DELETE FROM rag_chunks WHERE tenant_id = ? AND id = ?', tenantId, r.id);
        deleted++;
      }
    }

    return { error: null, indexed, skipped: chunks.length - toEmbed.length, deleted, total: chunks.length };
  } catch (e) {
    log.error('rag.ingest', e instanceof Error ? e : new Error(String(e?.message)), { tenantId });
    return { error: 'reindex_failed', indexed: 0, skipped: 0, deleted: 0, total: 0 };
  }
}
