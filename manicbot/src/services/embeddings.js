/**
 * Multilingual text embeddings via Workers AI (`@cf/baai/bge-m3`).
 *
 * Shared by the RAG retrieval path (embed the user query) and the ingestion job
 * handler (embed chunks). Mirrors the dual model invocation in ai.js: REST first
 * (explicit account token) then the `AI` binding. The model id is centralized in
 * config (RAG_EMBED_MODEL) and stored per chunk so query/ingest drift is
 * detectable — never hardcode a different id at a call site.
 */
import { RAG_EMBED_MODEL } from '../config.js';
import { log } from '../utils/logger.js';

const EMBED_RUN_URL = 'https://api.cloudflare.com/client/v4/accounts';
// bge-m3 ctx window is 60k tokens; cap input defensively (a chunk/query far
// shorter than this in practice) so a pathological input can't blow the call.
const MAX_EMBED_CHARS = 2000;

/**
 * Embed one or more texts. Returns an array of `number[]` vectors aligned with
 * the (non-empty) inputs, or `null` on any failure — callers degrade gracefully.
 *
 * @param {any} ctx
 * @param {string|string[]} texts
 * @returns {Promise<number[][]|null>}
 */
export async function embedTexts(ctx, texts) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const clean = arr
    .map((t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, MAX_EMBED_CHARS))
    .filter(Boolean);
  if (!clean.length) return null;

  // REST path (preferred — explicit account token, matches ai.js).
  const token = ctx?.WORKERS_AI_API_TOKEN;
  const accountId = ctx?.CLOUDFLARE_ACCOUNT_ID;
  if (token && accountId) {
    try {
      const url = `${EMBED_RUN_URL}/${accountId}/ai/run/${encodeURIComponent(RAG_EMBED_MODEL)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean }),
      });
      if (res.ok) {
        const data = await res.json();
        const vecs = data?.result?.data ?? data?.data;
        if (Array.isArray(vecs) && vecs.length) return vecs;
      } else {
        log.error('rag.embed.rest', new Error(`Workers AI embed error ${res.status}`), { status: res.status });
      }
    } catch (e) {
      log.error('rag.embed.rest', e instanceof Error ? e : new Error(String(e?.message)));
    }
  }

  // Binding fallback.
  if (ctx?.AI) {
    try {
      const out = await ctx.AI.run(RAG_EMBED_MODEL, { text: clean });
      const vecs = out?.data;
      if (Array.isArray(vecs) && vecs.length) return vecs;
    } catch (e) {
      log.error('rag.embed.binding', e instanceof Error ? e : new Error(String(e?.message)));
    }
  }

  return null;
}
