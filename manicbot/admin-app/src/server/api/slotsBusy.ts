import { and, eq, ne, or } from "drizzle-orm";
import { appointments, appointmentBlocks, services } from "~/server/db/schema";

/**
 * Fallback appointment length (minutes) when an existing appointment has no
 * per-appointment duration override AND its service has been deleted/renamed.
 * Mirrors the `?? 60` fallback in appointments.rescheduleAppointment. A missing
 * duration must still block its slot — never silently allow a double-booking by
 * dropping the row from the overlap check.
 */
const DEFAULT_APPT_MIN = 60;

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

interface BusyArgs {
  db: DbInstance;
  tenantId: string;
  masterId: number;
  date: string;          // YYYY-MM-DD
  startTime: string;     // HH:MM
  durationMin: number;   // minutes
  /** Skip this appointment id (for re-schedule conflict check). */
  excludeAppointmentId?: string;
  /** Skip this block id (for "edit this block" flows). */
  excludeBlockId?: string;
}

interface BusyResult {
  busy: boolean;
  conflict?: { kind: "appointment" | "block"; id: string };
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Returns whether the requested (master, date, startTime, durationMin) tuple
 * would collide with either an existing appointment or an appointment_block.
 *
 * Why a shared helper: both `appointments.createManual` AND
 * `appointmentBlocks.create` need the union — otherwise a master could
 * end up double-booked between a client appointment and a "lunch" block,
 * and the dashboard would render two overlapping cards in the day grid.
 *
 * The check pulls only the active rows (`cancelled = 0` for both tables;
 * blocks also exclude `excludeBlockId`) for the given date/master and
 * tests interval overlap in JS — D1 doesn't have an interval-overlap
 * primitive and the daily working set is small (<100 rows in practice).
 */
export async function slotsBusy(args: BusyArgs): Promise<BusyResult> {
  const candStart = timeToMinutes(args.startTime);
  const candEnd = candStart + args.durationMin;

  // ── Existing appointments on the same master/date (active only) ──────
  const aptRows = await args.db
    .select({
      id: appointments.id,
      time: appointments.time,
      svcId: appointments.svcId,
      duration: appointments.duration,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, args.tenantId),
        eq(appointments.masterId, args.masterId),
        eq(appointments.date, args.date),
        eq(appointments.cancelled, 0),
      ),
    );

  // Resolve per-service durations once for any apt rows that exist.
  if (aptRows.length > 0) {
    const svcIds = Array.from(new Set(aptRows.map((r) => r.svcId)));
    const svcRows = await args.db
      .select({ svcId: services.svcId, duration: services.duration })
      .from(services)
      .where(eq(services.tenantId, args.tenantId));
    const svcDuration = new Map(svcRows.map((s) => [s.svcId, s.duration]));
    for (const a of aptRows) {
      if (args.excludeAppointmentId && a.id === args.excludeAppointmentId) continue;
      // Resolve the slot the appointment actually occupies: its per-appointment
      // duration override (drag-to-resize, 0106) wins; else the service's
      // nominal duration; else DEFAULT_APPT_MIN when the service was deleted.
      // NEVER skip the row on a missing duration — dropping it from the overlap
      // check would let a new booking double-book the master.
      const dur = a.duration ?? svcDuration.get(a.svcId) ?? DEFAULT_APPT_MIN;
      const aStart = timeToMinutes(a.time);
      const aEnd = aStart + dur;
      if (rangesOverlap(candStart, candEnd, aStart, aEnd)) {
        return { busy: true, conflict: { kind: "appointment", id: a.id } };
      }
    }
  }

  // ── Existing blocks on the same master/date ──────────────────────────
  // For multi-day time_off, end_date >= candDate AND date <= candDate; for
  // single-day rows end_date is null and date == candDate.
  const blockRows = await args.db
    .select({
      id: appointmentBlocks.id,
      type: appointmentBlocks.type,
      date: appointmentBlocks.date,
      time: appointmentBlocks.time,
      durationMin: appointmentBlocks.durationMin,
      endDate: appointmentBlocks.endDate,
    })
    .from(appointmentBlocks)
    .where(
      and(
        eq(appointmentBlocks.tenantId, args.tenantId),
        eq(appointmentBlocks.masterId, args.masterId),
        eq(appointmentBlocks.cancelled, 0),
      ),
    );

  for (const b of blockRows) {
    if (args.excludeBlockId && b.id === args.excludeBlockId) continue;
    // Multi-day time_off rows: any candidate date inside [date, endDate]
    // is fully blocked, regardless of time-of-day.
    if (b.endDate && b.endDate >= args.date && b.date <= args.date) {
      return { busy: true, conflict: { kind: "block", id: b.id } };
    }
    // Single-day rows: only blocking when same date AND time intervals
    // intersect.
    if (b.date === args.date) {
      const bStart = timeToMinutes(b.time);
      const bEnd = bStart + b.durationMin;
      if (rangesOverlap(candStart, candEnd, bStart, bEnd)) {
        return { busy: true, conflict: { kind: "block", id: b.id } };
      }
    }
  }

  return { busy: false };
}

/**
 * Convenience wrapper for the "drag-to-create" path: returns just the
 * boolean. Use the full `slotsBusy` when you need the conflict id (e.g.
 * to surface "слот уже занят записью X" in the UI).
 */
export async function isSlotBusy(args: BusyArgs): Promise<boolean> {
  return (await slotsBusy(args)).busy;
}

// `or`/`ne` aren't used yet but kept imported for future range-overlap
// SQL-side optimization without an editor flag. Underscore-prefix to
// silence the no-unused-vars lint rule.
void or;
void ne;
