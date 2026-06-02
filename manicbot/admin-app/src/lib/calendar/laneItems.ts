/**
 * laneItems — bridges the calendar's two kinds of positioned items
 * (appointments + single-day blocks) into ONE `computeLanes()` input set
 * so they share side-by-side lanes instead of stacking on top of each
 * other.
 *
 * Before this, each view laned appointments among themselves and rendered
 * reservation/time-off blocks full-width on a separate pass — so a reserve
 * and a meeting at the same time (or two reserves) overlapped and hid each
 * other. Feeding both into the same `computeLanes()` call makes a reserve +
 * a meeting render as two equal-width columns, exactly like Google Calendar.
 *
 * IDs are namespaced (`apt:` / `block:`) before laning so a numeric
 * appointment id can never collide with a string block id; the caller looks
 * a placement back up with the same `laneKey(kind, id)`.
 *
 * Multi-day / full-day `time_off` bands are intentionally NOT laned — the
 * caller filters them out and keeps rendering them as full-width background
 * bands.
 */

import { computeLanes, type LanePlacement } from "./overlapLanes";

export type LaneKind = "apt" | "block";

/** Namespaced lane-map key — unique across the two id spaces. */
export function laneKey(kind: LaneKind, id: string | number): string {
  return `${kind}:${id}`;
}

export interface LaneAppointment {
  id: string | number;
  /** Start time "HH:MM". */
  time: string;
  /** Service duration in minutes (defaults to 60 when null/undefined). */
  duration?: number | null;
}

export interface LaneBlock {
  id: string;
  /** Start time "HH:MM". */
  time: string;
  durationMin: number;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

/**
 * Lane every appointment and single-day block in one column together.
 * Returns a placement map keyed by `laneKey(kind, id)`.
 *
 * Pass only SINGLE-DAY blocks — multi-day bands must be excluded by the
 * caller (they render as full-width background, not as laned events).
 */
export function computeColumnLanes(
  apts: ReadonlyArray<LaneAppointment>,
  singleDayBlocks: ReadonlyArray<LaneBlock>,
): Map<string, LanePlacement> {
  const items = [
    ...apts.map((a) => {
      const start = toMinutes(a.time);
      return {
        id: laneKey("apt", a.id),
        startMin: start,
        endMin: start + Math.max(15, a.duration ?? 60),
      };
    }),
    ...singleDayBlocks.map((b) => {
      const start = toMinutes(b.time);
      return {
        id: laneKey("block", b.id),
        startMin: start,
        endMin: start + Math.max(15, b.durationMin),
      };
    }),
  ];
  // computeLanes keys by item.id (our namespaced string keys).
  return computeLanes(items) as Map<string, LanePlacement>;
}
