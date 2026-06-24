/**
 * slotsBusy — appointment duration resolution.
 *
 * The overlap check must reflect the slot an existing appointment ACTUALLY
 * occupies. Two ways the old code got it wrong (both → silent double-booking):
 *   1. `if (!dur) continue` dropped any appointment whose service had been
 *      deleted/renamed (svcId no longer in `services`) — the slot looked free.
 *   2. It used only the service's nominal duration, ignoring the
 *      per-appointment `duration` override (drag-to-resize, migration 0106) —
 *      a resized-longer appointment under-blocked.
 *
 * Resolution is now `appointment.duration ?? service.duration ?? 60`, matching
 * appointments.rescheduleAppointment, and the row is never skipped.
 */
import { describe, it, expect } from "vitest";
import { slotsBusy } from "~/server/api/slotsBusy";
import { createDbMock } from "./helpers/db-mock";

const BASE = { tenantId: "t_a", masterId: 1, date: "2026-05-16" } as const;

describe("slotsBusy — duration resolution", () => {
  it("still blocks an appointment whose service was deleted (no double-booking)", async () => {
    // apt at 10:00, svcId absent from services → old code did `continue` and a
    // new 10:15 booking slipped through. Now it falls back to 60m and blocks.
    const { db } = createDbMock([
      [{ id: "apt_orphan", time: "10:00", svcId: "deleted_svc", duration: null }], // appointments
      [], // services — empty (service was deleted)
      [], // blocks
    ]);
    const r = await slotsBusy({ db: db as never, ...BASE, startTime: "10:15", durationMin: 30 });
    expect(r.busy).toBe(true);
    expect(r.conflict).toMatchObject({ kind: "appointment", id: "apt_orphan" });
  });

  it("uses the per-appointment duration override, not just the service nominal", async () => {
    // Service nominal 30m ends 10:30 and would NOT overlap a 10:45 booking, but
    // the appointment was resized to 90m (ends 11:00) → must block.
    const { db } = createDbMock([
      [{ id: "apt_long", time: "10:00", svcId: "mani", duration: 90 }],
      [{ svcId: "mani", duration: 30 }],
      [],
    ]);
    const r = await slotsBusy({ db: db as never, ...BASE, startTime: "10:45", durationMin: 30 });
    expect(r.busy).toBe(true);
    expect(r.conflict).toMatchObject({ kind: "appointment", id: "apt_long" });
  });

  it("does not false-block a slot far from an orphaned appointment", async () => {
    // Orphan at 10:00 → 60m window (10:00–11:00); a 12:00 booking is free.
    const { db } = createDbMock([
      [{ id: "apt_orphan", time: "10:00", svcId: "deleted_svc", duration: null }],
      [],
      [],
    ]);
    const r = await slotsBusy({ db: db as never, ...BASE, startTime: "12:00", durationMin: 30 });
    expect(r.busy).toBe(false);
  });

  it("still resolves a valid service's nominal duration when there is no override", async () => {
    const overlap = await slotsBusy({
      db: createDbMock([
        [{ id: "apt_ok", time: "10:00", svcId: "mani", duration: null }],
        [{ svcId: "mani", duration: 60 }],
        [],
      ]).db as never,
      ...BASE,
      startTime: "10:30",
      durationMin: 30,
    });
    expect(overlap.busy).toBe(true);

    const free = await slotsBusy({
      db: createDbMock([
        [{ id: "apt_ok", time: "10:00", svcId: "mani", duration: null }],
        [{ svcId: "mani", duration: 60 }],
        [],
      ]).db as never,
      ...BASE,
      startTime: "11:30",
      durationMin: 30,
    });
    expect(free.busy).toBe(false);
  });
});
