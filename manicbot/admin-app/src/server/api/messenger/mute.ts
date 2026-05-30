/**
 * Per-member thread mute helpers (migration 0067 `thread_members.muted_until`).
 *
 * Mute is notification-only: a muted member still sees unread badges and new
 * messages in the inbox, they just don't get a notification-bell row. Mute
 * never gates read receipts or message delivery.
 */

/** Sentinel "muted indefinitely" — 2100-01-01, far beyond any real `until`. */
export const MUTE_FOREVER = 4102444800;

/** A member is muted iff `muted_until` is set and still in the future. */
export function isMuted(mutedUntil: number | null | undefined, nowSec: number): boolean {
  return typeof mutedUntil === "number" && mutedUntil > nowSec;
}

/**
 * Filter thread members down to those who should receive a notification —
 * everyone whose mute has expired or was never set. Used by the bell fan-out
 * in `sendMessage` so muted members stay quiet.
 */
export function filterActiveRecipients<
  T extends { memberRef: string; mutedUntil: number | null },
>(members: T[], nowSec: number): string[] {
  return members.filter((m) => !isMuted(m.mutedUntil, nowSec)).map((m) => m.memberRef);
}
