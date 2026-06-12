/**
 * Optimistic-merge layer for appointment status mutations.
 *
 * Same shape & purpose as the `pendingMoves` / `applyPendingMoves` pair in
 * SalonDashboard's drag-to-reschedule flow — but for confirm / cancel /
 * reject / no-show actions fired from the AptCard status dropdown
 * (`StatusActionMenu`). Without an optimistic layer the user perceives
 * the 300–800 ms invalidate→refetch gap as "click did nothing" because
 * the card stays in its previous state until canonical data arrives.
 *
 * Patch shape is intentionally aligned with the fields `AptCard` reads to
 * compute `statusKey` and the pill label:
 *   statusKey = a.noShow ? "no_show" : a.cancelled ? "cancelled" : a.status
 *   pill label = NO_SHOW_LABELS[a.noShowBy] | CANCELLED_BY_LABELS[a.cancelledBy] | …
 * If any of those reads changes, this module's StatusPatch type changes
 * with it.
 */

export type StatusPatch = {
  status?: "confirmed" | "cancelled" | "rejected" | "no_show";
  cancelled?: 0 | 1;
  cancelledBy?: "client" | "master" | "admin" | null;
  noShow?: 0 | 1;
  noShowBy?: "client" | "master" | null;
};

export type PendingStatusPatches = Record<string, StatusPatch>;

/** Patch for an admin-initiated cancel — flips cancelled flag + author. */
export function buildCancelPatch(): StatusPatch {
  return { status: "cancelled", cancelled: 1, cancelledBy: "admin" };
}

/**
 * Patch for confirm / reject status flips. We reset `cancelled` + `cancelledBy`
 * defensively so an undo (cancelled → confirmed) clears the previous flag set
 * while the canonical refetch is still in flight.
 */
export function buildStatusChangePatch(status: "confirmed" | "rejected"): StatusPatch {
  return { status, cancelled: 0, cancelledBy: null };
}

/** Patch for a no-show mark — both flag + author. */
export function buildNoShowPatch(noShowBy: "client" | "master"): StatusPatch {
  return { status: "no_show", noShow: 1, noShowBy };
}

/**
 * Layer in-flight status mutations over a fresh server snapshot. Returns
 * `rows` unchanged when there are no pending patches so the caller can
 * use it as a no-op-cheap wrapper at every filter site.
 */
export function applyPendingStatusChanges<T extends { id: string | number }>(
  rows: T[] | undefined,
  patches: PendingStatusPatches,
): T[] {
  if (!rows) return [];
  const ids = Object.keys(patches);
  if (ids.length === 0) return rows;
  return rows.map((r) => {
    const patch = patches[String(r.id)];
    return patch ? { ...r, ...patch } : r;
  });
}

// ─── Pending reschedule moves (drag-to-move) ───────────────────────────────
// DC-8 (dedup 2026-06-12): the drag-to-reschedule optimistic layer was
// hand-copied into SalonDashboard and master/ScheduleTab. Unified here next to
// its status-change twin. A move patches date/time (+ optional master) and
// recomputes `ts` (epoch seconds) so list-mode `ORDER BY ts` keeps the dragged
// row in place until the server round-trip lands.

export type PendingMove = { date: string; time: string; masterId?: number };
export type PendingMoves = Record<string, PendingMove>;

/**
 * Apply in-flight reschedule moves over a fresh server snapshot. `masterId` is
 * carried only when the patch supplies a truthy one (single-master columns
 * never change master, so it is a no-op there) — preserving the prior
 * `patch.masterId || r.masterId` semantics. Returns `rows` unchanged when
 * there are no pending moves.
 */
export function applyPendingMoves<T extends { id: string | number; masterId?: number | null }>(
  rows: T[] | undefined,
  pending: PendingMoves,
): T[] {
  if (!rows) return [];
  if (Object.keys(pending).length === 0) return rows;
  return rows.map((r) => {
    const patch = pending[String(r.id)];
    if (!patch) return r;
    const [hh, mm] = patch.time.split(":").map(Number);
    const [y, mo, d] = patch.date.split("-").map(Number);
    const ts = Math.floor(Date.UTC(y!, mo! - 1, d!, hh!, mm!) / 1000);
    return { ...r, date: patch.date, time: patch.time, masterId: patch.masterId || r.masterId, ts };
  });
}
