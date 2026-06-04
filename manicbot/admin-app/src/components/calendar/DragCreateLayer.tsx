"use client";

/**
 * DragCreateLayer — wraps a calendar column body and turns
 * pointer-down + drag into a "create slot" callback. The Google
 * Calendar parity behaviour: drag = pick a range, click = 1-hour slot.
 *
 * Used by SalonDayView (one wrapper per master column) and
 * SalonWeekView (one wrapper per day column). The wrapper renders
 * its `children` (existing appointment blocks, grid lines, etc.)
 * on top of the captured layer, plus a translucent ghost rectangle
 * while the user is dragging.
 *
 * Lives in its own component so each column gets its own
 * `useDragToCreate` hook instance — calling hooks inside `.map()`
 * loops would break React's rules-of-hooks.
 */

import type { ReactNode } from "react";
import { useDragToCreate, minutesToHHMM, type DragGhost } from "~/lib/calendar/useDragToCreate";
import type { AnchorRect } from "~/lib/calendar/useAnchoredPosition";

interface Props {
  /** Date this column represents — passed straight to `onCreateAt`. */
  date: string;
  /** Master id this column belongs to (Day view: per-master; Week view:
   *  null because the column is per-day, not per-master). */
  masterId: number | null;
  hourHeight: number;
  hourStart: number;
  hourEnd: number;
  /** Total px height of the column body. Drives both the absolute layer
   *  size and the ghost positioning bounds. */
  totalHeight: number;
  /** Fired on pointerup / click with the resolved geometry. The caller
   *  is expected to open a booking dialog with this prefill. */
  onCreateAt?: (info: {
    date: string;
    masterId: number | null;
    time: string;       // HH:MM
    durationMin: number;
    modifier: DragGhost["modifier"];
    /** Viewport rect of the slot — anchors a quick-create popover. */
    anchorRect?: AnchorRect | null;
  }) => void;
  children: ReactNode;
  /** Optional test id suffix so day vs week wrappers don't collide. */
  testIdPrefix?: string;
  /** Touch/coarse-pointer flag → forwarded to useDragToCreate to disable
   *  drag-create and let the grid scroll natively on touch. */
  isTouch?: boolean;
}

export function DragCreateLayer({
  date,
  masterId,
  hourHeight,
  hourStart,
  hourEnd,
  totalHeight,
  onCreateAt,
  children,
  testIdPrefix = "drag",
  isTouch = false,
}: Props) {
  const { ghost, bind } = useDragToCreate({
    hourHeight,
    hourStart,
    hourEnd,
    isTouch,
    snapMin: 15,
    defaultDurationMin: 60,
    onCommit: (g) => {
      onCreateAt?.({
        date,
        masterId,
        time: minutesToHHMM(g.startMin),
        durationMin: g.durationMin,
        modifier: g.modifier,
        anchorRect: g.anchorRect ?? null,
      });
    },
  });

  // Without an `onCreateAt` callback, behave as a pass-through wrapper —
  // useful for read-only roles or for parents that opt out of drag.
  if (!onCreateAt) {
    return (
      <div
        className="relative"
        style={{ height: totalHeight }}
        data-testid={`${testIdPrefix}-readonly`}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      {...bind}
      className="relative"
      style={{ height: totalHeight, ...bind.style }}
      data-testid={`${testIdPrefix}-layer`}
      data-date={date}
      data-master-id={masterId ?? ""}
    >
      {children}
      {ghost && (
        <div
          aria-hidden
          data-testid={`${testIdPrefix}-ghost`}
          className="absolute left-1 right-1 rounded-lg border-2 border-dashed pointer-events-none flex flex-col items-center justify-center text-[10px] font-bold text-brand-700 dark:text-brand-100"
          style={{
            top: ghost.top,
            height: ghost.height,
            background: "rgba(124,58,237,0.18)",
            borderColor: "rgba(124,58,237,0.7)",
            zIndex: 25,
          }}
        >
          <span className="tabular-nums leading-none">
            {minutesToHHMM(ghost.startMin)}
          </span>
          <span className="tabular-nums opacity-70 leading-none">
            {minutesToHHMM(ghost.startMin + ghost.durationMin)}
          </span>
        </div>
      )}
    </div>
  );
}
