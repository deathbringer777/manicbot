'use strict';
/**
 * dedup.js — keyword dedup keys (adapted from lead-scout/dedup.js).
 *
 * Two keyword records collide if they normalize to the same (lang, text):
 * lowercased, NFKC-folded, whitespace-collapsed, trailing punctuation stripped.
 * Language is part of the key so a term spelled the same across languages never
 * false-merges. mergeKeywords() unions many collector outputs, keeping the
 * richest record and accumulating which sources surfaced each keyword.
 */
function normalizeKeyword(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.,;:]+$/g, '');
}
function keywordKey(keyword, lang = 'pl') {
  const norm = normalizeKeyword(keyword);
  return norm ? `${lang}:${norm}` : null;
}
function createDeduper() {
  const seen = new Set();
  return {
    isDuplicate(kw) { const k = keywordKey(kw.keyword, kw.lang); return k ? seen.has(k) : false; },
    add(kw) { const k = keywordKey(kw.keyword, kw.lang); if (k) seen.add(k); return k; },
    size() { return seen.size; },
  };
}

/** Union keyword arrays (earlier = higher priority for kept fields); later dup
 *  hits only contribute their `source` to the kept record's sources list. */
function mergeKeywords(...lists) {
  const out = [];
  const index = new Map(); // key → record in out
  for (const list of lists) {
    for (const kw of list || []) {
      const k = keywordKey(kw.keyword, kw.lang);
      if (!k) continue;
      const existing = index.get(k);
      if (existing) {
        if (kw.source) existing.sources = Array.from(new Set([...(existing.sources || []), kw.source]));
        // back-fill signals a later source may carry (e.g. trends rising flag).
        if (kw.rising) existing.rising = true;
        if (kw.gscImpressions && !existing.gscImpressions) { existing.gscImpressions = kw.gscImpressions; existing.gscPosition = kw.gscPosition; }
        continue;
      }
      const record = { ...kw, sources: [kw.source].filter(Boolean) };
      index.set(k, record);
      out.push(record);
    }
  }
  return out;
}

module.exports = { normalizeKeyword, keywordKey, createDeduper, mergeKeywords };
