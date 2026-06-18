/**
 * resolveReservationRoute — a «Резерв времени» quick-create must resolve to a
 * SINGLE master, never fan out to the whole team.
 *
 * Regression context: `appointment_blocks.master_id` is NOT NULL, so a
 * reservation must target exactly one master. The quick-create popover may
 * carry no master (Week view has day columns, not master columns; the Day view
 * "unassigned" column likewise). The old wiring blocked EVERY master in that
 * case — one hatched lock-block per column ("куча блоков", 6 masters → 6
 * blocks). This routing kills the fan-out: one master → use it; the sole
 * master of a single-master salon → use it; otherwise defer to the picker
 * dialog so the owner chooses (or opts into «Все мастера» explicitly).
 */
import { describe, it, expect } from "vitest";
import { resolveReservationRoute } from "~/lib/calendar/reservationRouting";

describe("resolveReservationRoute", () => {
  it("uses the explicit master when the slot was dragged on a master column", () => {
    expect(resolveReservationRoute(100, [100, 200, 300])).toEqual({ kind: "single", masterId: 100 });
  });

  it("explicit master wins even in a single-master salon", () => {
    expect(resolveReservationRoute(200, [200])).toEqual({ kind: "single", masterId: 200 });
  });

  it("targets the sole master when none is given (single-master salon)", () => {
    expect(resolveReservationRoute(null, [42])).toEqual({ kind: "single", masterId: 42 });
    expect(resolveReservationRoute(undefined, [42])).toEqual({ kind: "single", masterId: 42 });
  });

  it("defers to the dialog when the master is ambiguous (week view, multi-master)", () => {
    expect(resolveReservationRoute(null, [100, 200])).toEqual({ kind: "dialog" });
    expect(resolveReservationRoute(undefined, [100, 200, 300])).toEqual({ kind: "dialog" });
  });

  it("never fans out to all masters — an empty roster also defers to the dialog", () => {
    expect(resolveReservationRoute(null, [])).toEqual({ kind: "dialog" });
  });
});
