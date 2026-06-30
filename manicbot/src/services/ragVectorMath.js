/**
 * Pure vector math for the per-tenant RAG knowledge base.
 *
 * The salon KB corpus is tiny (~tens of chunks per tenant), so we store
 * `bge-m3` embeddings as Float32 BLOBs in the tenant-scoped `rag_chunks` D1
 * table and brute-force cosine similarity in the Worker at query time. This
 * keeps tenant isolation on the `WHERE tenant_id = ?` invariant the CI scanner
 * gates (Vectorize queries are invisible to it) and stays immediately
 * consistent, which the larger public/internal corpora (Vectorize) cannot be.
 *
 * No D1 / network / model access here — these are deterministic helpers so the
 * ranking logic can be unit-tested in isolation.
 */

/**
 * Serialize a numeric embedding to a little-endian Float32 byte BLOB for D1
 * storage. Workers run little-endian and {@link deserializeEmbedding} mirrors
 * the layout, so the round-trip is exact to Float32 precision.
 *
 * @param {ArrayLike<number>} values
 * @returns {Uint8Array} 4 bytes per element (D1 accepts Uint8Array for BLOB)
 */
export function serializeEmbedding(values) {
  const f32 = Float32Array.from(values || []);
  return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Rehydrate a Float32 embedding from whatever shape the source provides:
 * a D1 BLOB (ArrayBuffer or Uint8Array), a plain number[], or an existing
 * Float32Array (returned as-is). Returns an empty vector for null/empty input.
 *
 * Copies into a fresh 4-byte-aligned buffer when the source view is unaligned
 * (a Uint8Array slice can start at any byteOffset, which would otherwise make
 * the Float32Array constructor throw).
 *
 * @param {ArrayBuffer|Uint8Array|number[]|Float32Array|null|undefined} blob
 * @returns {Float32Array}
 */
export function deserializeEmbedding(blob) {
  if (!blob) return new Float32Array(0);
  if (blob instanceof Float32Array) return blob;
  if (Array.isArray(blob)) return Float32Array.from(blob);

  const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  // Drop any trailing partial element (corrupt/truncated blob guard).
  const usableBytes = u8.byteLength - (u8.byteLength % 4);
  // Copy into a fresh, guaranteed-aligned buffer — the source view may start
  // at a non-multiple-of-4 byteOffset.
  const aligned = new Uint8Array(usableBytes);
  aligned.set(u8.subarray(0, usableBytes));
  return new Float32Array(aligned.buffer);
}

/**
 * Cosine similarity in [-1, 1]. Magnitude-invariant. Returns 0 (never NaN)
 * when either vector is zero-length or all-zeros, and compares over the
 * shorter length so a dimension mismatch can never throw.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0);
  if (n === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Rank candidates by cosine similarity to the query vector, descending.
 * Candidates lacking an `embedding` are skipped; matches below `minScore` are
 * dropped. Returns at most `topK` `{ item, score }` pairs.
 *
 * @param {ArrayLike<number>} queryVec
 * @param {Array<{ embedding?: ArrayLike<number> }>} candidates
 * @param {{ topK?: number, minScore?: number }} [opts]
 * @returns {Array<{ item: object, score: number }>}
 */
export function rankTopK(queryVec, candidates, { topK = 4, minScore = 0 } = {}) {
  const scored = [];
  for (const item of candidates || []) {
    if (!item || !item.embedding) continue;
    const score = cosineSimilarity(queryVec, item.embedding);
    if (score >= minScore) scored.push({ item, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, topK);
}
