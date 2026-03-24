/**
 * Unified time utilities for D1 storage.
 * D1 timestamps are stored as Unix seconds (INTEGER) to match admin-app convention.
 * KV / in-memory comparisons that never touch D1 should keep using Date.now() directly.
 */

/** Current Unix time in seconds — use for all D1 writes */
export const nowSec = () => Math.floor(Date.now() / 1000);

/** Convert a millisecond duration to seconds */
export const msToSec = (ms) => Math.floor(ms / 1000);
