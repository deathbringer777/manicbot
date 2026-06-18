/**
 * Reservation slot routing — decide how a «Резерв времени» quick-create
 * (drag-on-grid → CreateSlotPopover) resolves the master for the block.
 *
 * `appointment_blocks.master_id` is NOT NULL, so a reservation MUST target
 * exactly one master. The quick-create popover may or may not carry one:
 *   - Day view, dragged on a master column → masterId is known.
 *   - Week view (day columns, no master) / Day view "unassigned" column → null.
 *
 * The previous wiring resolved the null case by blocking EVERY master — one
 * hatched lock-block per column (the salon owner's "куча блоков" report). A
 * single reservation never means "block the whole team". Routing:
 *   - explicit master            → use it directly (no prompt);
 *   - no master, exactly one     → use that sole master (single-master salon);
 *   - no master, several/none    → defer to the picker dialog so the owner
 *                                  chooses one (or opts into «Все мастера»).
 *
 * The fan-out option survives only as an EXPLICIT choice inside the dialog.
 */
export type ReservationRoute =
  | { kind: "single"; masterId: number }
  | { kind: "dialog" };

export function resolveReservationRoute(
  masterId: number | null | undefined,
  masterIds: number[],
): ReservationRoute {
  if (masterId != null) return { kind: "single", masterId };
  if (masterIds.length === 1) return { kind: "single", masterId: masterIds[0]! };
  return { kind: "dialog" };
}
