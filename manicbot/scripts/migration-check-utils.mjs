/**
 * Pure helpers for the migration-number collision guard.
 *
 * Why this exists: wrangler tracks applied D1 migrations by EXACT filename and
 * applies them in lexicographic filename order. Two migrations that share the
 * same numeric prefix (e.g. `0097_a.sql` + `0097_b.sql`) are a latent hazard —
 * if they ever carry an ordering dependency, lexicographic-by-suffix ordering
 * can apply them in the wrong sequence, and a future author who *reuses* a
 * number can collide with an already-applied file ("duplicate column" on
 * `wrangler d1 migrations apply`). CLAUDE.md warns about this verbally; this
 * turns the warning into a CI gate so the NEXT collision is caught at PR time —
 * while the file can still be renamed safely, before it reaches prod.
 *
 * The "migration number" is the token before the first underscore, so the
 * historical `a`-suffix slot-in pattern (`0012` vs `0012a`) is correctly
 * treated as two DISTINCT numbers, not a collision.
 */

/**
 * Extract a migration's number token: the leading run of chars up to (but not
 * including) the first underscore. `0097_web_users_active_tenant.sql` -> "0097";
 * `0012a_login_attempts.sql` -> "0012a".
 *
 * @param {string} filename - a basename like `0097_foo.sql`
 * @returns {string|null} the number token, or null if the name has no `_`
 */
export function migrationNumber(filename) {
  const base = filename.replace(/.*\//, '');
  const underscore = base.indexOf('_');
  if (underscore <= 0) return null;
  return base.slice(0, underscore);
}

/**
 * Group `.sql` migration filenames by their number token and return every
 * token that maps to more than one file, EXCLUDING tokens explicitly allowed
 * (frozen-in-prod historical collisions that can no longer be renamed).
 *
 * @param {string[]} filenames - migration basenames (any non-`.sql` entries ignored)
 * @param {Set<string>|string[]} [allowlist] - number tokens permitted to collide
 * @returns {{number: string, files: string[]}[]} sorted by number token
 */
export function findDuplicateMigrationNumbers(filenames, allowlist = new Set()) {
  const allowed = allowlist instanceof Set ? allowlist : new Set(allowlist);
  const byNumber = new Map();
  for (const name of filenames) {
    if (!name.endsWith('.sql')) continue;
    const num = migrationNumber(name);
    if (!num) continue;
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(name);
  }
  const dupes = [];
  for (const [num, files] of byNumber) {
    if (files.length > 1 && !allowed.has(num)) {
      dupes.push({ number: num, files: files.slice().sort() });
    }
  }
  return dupes.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
}

/**
 * Frozen historical collisions: number tokens that ALREADY collide in prod and
 * cannot be renamed (wrangler has them recorded under their exact filenames; at
 * least one is a non-idempotent `ALTER TABLE ADD COLUMN` that would fail on
 * re-apply). New collisions are NOT allowed — this set must never grow without
 * a prod-schema reason.
 *
 *   0097 — `0097_web_users_active_tenant.sql` (#282) + `0097_appointments_
 *          overlap_unassigned.sql` (#287) merged in parallel 2026-05-30/31.
 *          Both applied to prod d1_migrations under distinct filenames; the
 *          web_users one is a bare ADD COLUMN (not re-appliable). Frozen.
 */
export const ALLOWED_DUPLICATE_MIGRATION_NUMBERS = new Set(['0097']);
