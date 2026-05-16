"use client";

/**
 * useDragToCreate — pointer-driven hook that lets the user drag on an
 * empty cell of the calendar grid (Day or Week view) to create a new
 * booking, the way Google Calendar does it.
 *
 * Geometry contract (the hook is grid-agnostic):
 *   * `hourHeight` px corresponds to 60 minutes.
 *   * `hourStart`  (e.g. 8) is the first visible hour.
 *   * The pointer's Y coordinate is read relative to the column body
 *     element captured on `pointerdown`.
 *
 * Behaviour:
 *   * Snaps to `snapMin` increments (default 15).
 *   * Click without drag (Y delta < 6 px) creates a 1-hour slot starting
 *     at the snapped minute under the cursor.
 *   * Drag updates `ghost` so the caller can render a translucent
 *     rectangle while the drag is in progress.
 *   * On `pointerup` (or `pointercancel`), `onCommit` fires with the
 *     resolved `{ startMin, durationMin }`. The hook does not call any
 *     tRPC itself — wiring decides what dialog to open.
 *
 * Touch + mouse + pen are handled via Pointer Events, so a long-press
 * + drag on iOS works the same as a click+drag on desktop.
 */

import { useCallback, useMemo, useRef, useState } from "react";

export interface DragGhost {
  top: number;          // px, relative to the column body
  height: number;       // px, snapped to `snapMin`
  startMin: number;     // minutes since midnight
  durationMin: number;  // minutes (always >= snapMin)
  /** Modifier key the user is holding when the drag was committed.
   *  `shift` lets callers route the release to the time-reservation
   *  dialog instead of the booking dialog (matches GCal behaviour). */
  modifier: "none" | "shift" | "alt";
}

interface UseDragToCreateArgs {
  hourHeight: number;
  hourStart: number;
  hourEnd: number;
  snapMin?: number;
  /** Minimum drag length in pixels before a "click" becomes a "drag".
   *  Below this, the release is treated as a 1-hour slot click. */
  clickThresholdPx?: number;
  /** Minimum block duration in minutes. Caps both snap-tiny drags and
   *  1-hour click-creates. */
  defaultDurationMin?: number;
  /** Fired exactly once on pointerup with the resolved geometry. */
  onCommit: (g: DragGhost) => void;
}

export interface UseDragToCreateApi {
  ghost: DragGhost | null;
  /** Spread on the column body that should accept drag-create. */
  bind: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    style: { touchAction: "none" };
  };
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function yToMinutes(y: number, hourHeight: number, hourStart: number, snapMin: number): number {
  const rawMin = hourStart * 60 + (y / hourHeight) * 60;
  return snap(Math.max(0, rawMin), snapMin);
}

export function minutesToY(min: number, hourHeight: number, hourStart: number): number {
  return ((min - hourStart * 60) / 60) * hourHeight;
}

export function useDragToCreate({
  hourHeight,
  hourStart,
  hourEnd,
  snapMin = 15,
  clickThresholdPx = 6,
  defaultDurationMin = 60,
  onCommit,
}: UseDragToCreateArgs): UseDragToCreateApi {
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const startRef = useRef<{ y: number; container: HTMLDivElement; rect: DOMRect; pointerId: number; modifier: "none" | "shift" | "alt" } | null>(null);

  const clearAll = useCallback(() => {
    if (startRef.current) {
      try {
        startRef.current.container.releasePointerCapture(startRef.current.pointerId);
      } catch { /* ignore */ }
    }
    startRef.current = null;
    setGhost(null);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const y = e.clientY - start.rect.top;
    const startMin = yToMinutes(start.y, hourHeight, hourStart, snapMin);
    const endMin = yToMinutes(Math.max(start.y, y), hourHeight, hourStart, snapMin);
    const durationMin = Math.max(snapMin, endMin - startMin);
    const top = minutesToY(startMin, hourHeight, hourStart);
    const height = (durationMin / 60) * hourHeight;
    setGhost({ top, height, startMin, durationMin, modifier: start.modifier });
  }, [hourHeight, hourStart, snapMin]);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const start = startRef.current;
    if (!start) { clearAll(); return; }
    const y = e.clientY - start.rect.top;
    const dy = Math.abs(y - start.y);

    let startMin = yToMinutes(start.y, hourHeight, hourStart, snapMin);
    let durationMin: number;
    if (dy < clickThresholdPx) {
      durationMin = defaultDurationMin;
    } else {
      const endMin = yToMinutes(Math.max(start.y, y), hourHeight, hourStart, snapMin);
      durationMin = Math.max(snapMin, endMin - startMin);
    }

    // Clamp inside visible window so a slow drag past midnight or off-grid
    // doesn't produce a 23:00–01:00 block on the wrong day.
    const dayEndMin = hourEnd * 60;
    if (startMin >= dayEndMin) startMin = dayEndMin - durationMin;
    if (startMin + durationMin > dayEndMin) {
      durationMin = Math.max(snapMin, dayEndMin - startMin);
    }

    onCommit({
      top: minutesToY(startMin, hourHeight, hourStart),
      height: (durationMin / 60) * hourHeight,
      startMin,
      durationMin,
      modifier: start.modifier,
    });
    clearAll();
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
  }, [clearAll, clickThresholdPx, defaultDurationMin, hourEnd, hourHeight, hourStart, onCommit, onPointerMove, snapMin]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return; // only primary button
    const target = e.target as HTMLElement;
    // Don't hijack clicks on existing appointment chips, master headers,
    // or other interactive children — only fire on the empty grid body.
    if (target.closest("button") || target.closest("a") || target.closest('[data-no-drag]')) return;

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const modifier: "none" | "shift" | "alt" = e.shiftKey ? "shift" : e.altKey ? "alt" : "none";
    startRef.current = { y, container, rect, pointerId: e.pointerId, modifier };
    try { container.setPointerCapture(e.pointerId); } catch { /* noop */ }

    const startMin = yToMinutes(y, hourHeight, hourStart, snapMin);
    setGhost({
      top: minutesToY(startMin, hourHeight, hourStart),
      height: (defaultDurationMin / 60) * hourHeight,
      startMin,
      durationMin: defaultDurationMin,
      modifier,
    });

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    e.preventDefault();
  }, [defaultDurationMin, hourHeight, hourStart, onPointerMove, onPointerUp, snapMin]);

  return useMemo(() => ({
    ghost,
    bind: { onPointerDown, style: { touchAction: "none" as const } },
  }), [ghost, onPointerDown]);
}

/** Convert minutes-since-midnight to "HH:MM" — used by callers wiring
 *  `onCommit` to the booking dialog's `defaultTime`. */
export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(h)}:${pad(m)}`;
}
