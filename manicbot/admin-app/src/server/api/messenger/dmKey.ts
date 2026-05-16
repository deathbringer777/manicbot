/**
 * Deterministic DM key for staff_dm threads.
 *
 * Used by the partial UNIQUE index `idx_threads_dm_unique ON (tenant_id, dm_key)
 * WHERE kind='staff_dm'` to dedupe DM threads regardless of which side opens
 * them.
 *
 * Format: `min:max` where both ids are compared as strings (web_users.id is a
 * TEXT primary key). String comparison is fine — both ids come from the same
 * column and follow the same encoding.
 *
 * Worker mirrors this in `manicbot/src/services/messengerThreads.js`. Both
 * MUST produce the same key for the same pair, otherwise UNIQUE breaks.
 */
export function computeDmKey(a: string, b: string): string {
  if (!a || !b) {
    throw new Error("computeDmKey: both ids required");
  }
  if (a === b) {
    throw new Error("computeDmKey: cannot DM yourself");
  }
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
