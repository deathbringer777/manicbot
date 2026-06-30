import { describe, it, expect } from 'vitest';
import {
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
  rankTopK,
} from '../src/services/ragVectorMath.js';

describe('serializeEmbedding / deserializeEmbedding', () => {
  it('round-trips a vector through a Float32 BLOB (Float32 precision)', () => {
    const original = [0.1, -0.2, 0.33333, 1, -1, 0, 0.000125, 42.5];
    const blob = serializeEmbedding(original);
    // BLOB is a byte view; 4 bytes per element.
    expect(blob).toBeInstanceOf(Uint8Array);
    expect(blob.byteLength).toBe(original.length * 4);

    const back = deserializeEmbedding(blob);
    expect(back).toBeInstanceOf(Float32Array);
    expect(back.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(back[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('deserializes from a raw ArrayBuffer (how D1 may return a BLOB)', () => {
    const blob = serializeEmbedding([1, 2, 3, 4]);
    const back = deserializeEmbedding(blob.buffer);
    expect(Array.from(back)).toEqual([1, 2, 3, 4]);
  });

  it('deserializes from a number[] and an existing Float32Array (idempotent)', () => {
    expect(Array.from(deserializeEmbedding([5, 6, 7]))).toEqual([5, 6, 7]);
    const f = Float32Array.from([8, 9]);
    expect(deserializeEmbedding(f)).toBe(f);
  });

  it('handles an UNALIGNED byte view (byteOffset not a multiple of 4) without throwing', () => {
    // A Uint8Array that is a slice of a larger buffer starting at offset 1 is
    // not 4-byte aligned — constructing Float32Array on it directly would throw.
    const f = Float32Array.from([1.5, 2.5, 3.5]); // 12 bytes
    const padded = new Uint8Array(f.byteLength + 1);
    padded.set(new Uint8Array(f.buffer), 1); // shift by 1 byte → unaligned
    const view = padded.subarray(1); // byteOffset = 1
    const back = deserializeEmbedding(view);
    expect(back.length).toBe(3);
    expect(back[0]).toBeCloseTo(1.5, 5);
    expect(back[2]).toBeCloseTo(3.5, 5);
  });

  it('returns an empty vector for null/empty input', () => {
    expect(deserializeEmbedding(null).length).toBe(0);
    expect(deserializeEmbedding(undefined).length).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical direction, -1 for opposite, ~0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBeCloseTo(1, 6); // magnitude-invariant
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('returns 0 when either vector is all zeros (no NaN)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('compares over the shorter length when dimensions differ', () => {
    // Defensive: never throws on a dimension mismatch.
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).not.toThrow();
  });
});

describe('rankTopK', () => {
  const q = [1, 0, 0];
  const candidates = [
    { id: 'a', embedding: [0.9, 0.1, 0] }, // high
    { id: 'b', embedding: [0, 1, 0] },     // orthogonal ~0
    { id: 'c', embedding: [0.99, 0, 0.01] }, // highest
    { id: 'd', embedding: [-1, 0, 0] },    // opposite
    { id: 'e' },                           // no embedding → skipped
  ];

  it('returns the topK by descending cosine score', () => {
    const top = rankTopK(q, candidates, { topK: 2 });
    expect(top.map((r) => r.item.id)).toEqual(['c', 'a']);
    expect(top[0].score).toBeGreaterThan(top[1].score);
  });

  it('drops candidates below minScore and those without an embedding', () => {
    const top = rankTopK(q, candidates, { topK: 10, minScore: 0.5 });
    const ids = top.map((r) => r.item.id);
    expect(ids).toContain('c');
    expect(ids).toContain('a');
    expect(ids).not.toContain('b'); // ~0 < 0.5
    expect(ids).not.toContain('d'); // negative
    expect(ids).not.toContain('e'); // no embedding
  });

  it('returns an empty array for empty candidates', () => {
    expect(rankTopK(q, [], { topK: 4 })).toEqual([]);
  });
});
