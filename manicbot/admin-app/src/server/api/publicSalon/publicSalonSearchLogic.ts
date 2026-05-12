/**
 * Pure helpers for the FTS5-backed `publicSalon.search` / `autocomplete`
 * procedures. Split out of the router so they can be unit-tested in plain
 * Node without spinning up a tRPC caller or mocking Drizzle.
 *
 * Background — see migration `0004_fts_search.sql` (virtual table
 * `tenant_fts USING fts5(tenant_id UNINDEXED, content, tokenize='unicode61
 * remove_diacritics 1')`) and migration `0054_tenant_fts_triggers.sql`
 * (which installs the INSERT/UPDATE/DELETE triggers that keep `tenant_fts`
 * in sync with `tenants.search_text`).
 *
 * The router was previously running `LIKE '%q%'` against
 * `tenants.search_text` — a full table scan that the relax.md §4 P0-5
 * audit flagged as the hot-path bottleneck. Switching to `MATCH ?` brings
 * the keystroke cost from O(N) to O(log N) and gives us free Polish /
 * Ukrainian / Russian / English handling via the unicode61 tokenizer.
 */

import { hasCyrillic, cyrillicToLatin } from "~/lib/searchNormalize";

/**
 * Tokens accepted by SQLite FTS5: ASCII / Cyrillic letters and digits.
 * Anything else (punctuation, quotes, operators like AND/OR/NOT, glob
 * metacharacters, etc.) gets stripped so user input cannot inject a
 * malformed FTS query that would throw `SQL logic error`.
 *
 * Strict: we deliberately do NOT pass `*` through here — the trailing
 * prefix marker is added by `buildFtsMatchExpression` itself.
 */
const FTS_SAFE_TOKEN = /[\p{L}\p{N}]+/gu;

const MAX_TOKENS = 6;
const MAX_TOKEN_LEN = 32;
const MIN_TOKEN_LEN = 1;

/**
 * Convert raw user input into a safe FTS5 MATCH expression.
 *
 * - Splits on non-letter/digit boundaries (handles spaces, dashes, dots).
 * - Lowercases (unicode61 is case-insensitive but keeping consistent
 *   makes debugging easier).
 * - Adds a `*` prefix marker to the last token so a partial keystroke
 *   like "man" matches "manicure".
 * - For Cyrillic input we also emit the Latin transliteration as an
 *   OR-branch so legacy `search_text` rows that were stored in Latin
 *   form remain findable. Each branch carries its own prefix marker.
 *
 * Returns `null` if no usable token survives sanitisation — callers must
 * treat that as "empty result" without ever sending the raw input to D1.
 */
export function buildFtsMatchExpression(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tokens = extractTokens(trimmed);
  if (tokens.length === 0) return null;

  const primary = ftsPhraseFromTokens(tokens);
  if (!primary) return null;

  // For Cyrillic queries, also emit the Latin form so search_text rows
  // stored with `cyrillicToLatin` continue to match. The two branches are
  // joined by FTS5's `OR` operator (uppercase, space-separated — that's
  // the documented syntax).
  if (hasCyrillic(trimmed)) {
    const latinTokens = extractTokens(cyrillicToLatin(trimmed));
    const secondary = ftsPhraseFromTokens(latinTokens);
    if (secondary && secondary !== primary) {
      return `${primary} OR ${secondary}`;
    }
  }

  return primary;
}

function extractTokens(input: string): string[] {
  const tokens: string[] = [];
  const matches = input.toLowerCase().match(FTS_SAFE_TOKEN);
  if (!matches) return tokens;
  for (const tok of matches) {
    if (tok.length < MIN_TOKEN_LEN) continue;
    tokens.push(tok.length > MAX_TOKEN_LEN ? tok.slice(0, MAX_TOKEN_LEN) : tok);
    if (tokens.length >= MAX_TOKENS) break;
  }
  return tokens;
}

/**
 * Compose a token list into an FTS5 phrase. Every token gets a trailing
 * `*` so the user does not have to type the full word; the trailing
 * marker is also the only way prefix matching is exposed by FTS5.
 */
function ftsPhraseFromTokens(tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}*`).join(" ");
}

/**
 * Cache-Control header value used by all public read endpoints. 60s edge
 * cache with a 5-minute stale-while-revalidate window — matches the
 * recommendation in relax.md §4 P2-9. Mutable so tests can lock the
 * exact string.
 */
export const PUBLIC_CACHE_CONTROL =
  "public, s-maxage=60, stale-while-revalidate=300";

/**
 * Paths that should receive the public Cache-Control header. tRPC's URL
 * pathname for a query looks like `/api/trpc/publicSalon.getProfile`
 * (single) or `/api/trpc/publicSalon.getProfile,publicSalon.getCities`
 * (batched). We match by *contains* on the comma-separated path list.
 *
 * The list is intentionally short — adding a new entry requires a
 * deliberate decision because edge caching can leak user-specific data
 * if any of these procedures ever start reading the session.
 */
export const PUBLIC_CACHEABLE_PROCEDURES: readonly string[] = [
  "publicSalon.getProfile",
  "publicSalon.getCities",
  "publicSalon.autocomplete",
];

/**
 * Decide whether a tRPC request batch is cacheable. We require *every*
 * procedure in the batch to be in the cacheable allow-list — if one of
 * them is a mutation or a private query, edge caching the response
 * would expose private data.
 */
export function shouldCacheTrpcPath(pathParam: string | null | undefined): boolean {
  if (!pathParam) return false;
  const procs = pathParam.split(",").map((p) => p.trim()).filter(Boolean);
  if (procs.length === 0) return false;
  return procs.every((p) => PUBLIC_CACHEABLE_PROCEDURES.includes(p));
}
