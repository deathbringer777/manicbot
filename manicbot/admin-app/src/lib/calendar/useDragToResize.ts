"use client";

/**
 * useDragToResize — pointer-driven Google-Calendar-style "drag the bottom
 * edge to change duration". Sibling of useDragToMove / useDragToCreate:
 * the START time stays put, only the END (height) follows the cursor.
 *
 * Geometry contract mirrors useDragToMove:
 *   * `hourHeight` px = 60 minutes; `hourStart` is the first visible hour.
 *   * A resize stays inside its own column, so unlike useDragToMove we don't
 *     hit-test other columns — we capture the column rect on pointerdown and
 *     read the cursor's Y against it.
 *
 * Behaviour:
 *   * `pointerdown` on the small bottom-edge handle records the item's start
 *     minute + the column rect. The caller's handle MUST stopPropagation so
 *     this gesture doesn't also start a move (useDragToMove) on the block body.
 *   * `pointermove` recomputes the snapped bottom edge → `ghost` (top fixed,
 *     height grows/shrinks) so the caller can paint a live preview.
 *   * `pointerup` fires `onResize` exactly once IF the duration actually
 *     changed (a click on the handle with no drag is a no-op).
 *   * `Escape` cancels the in-progress resize without committing.
 *
 * The hook fires no tRPC; the caller routes `kind` to the right mutation
 * (appointments.rescheduleAppointment newDurationMin vs appointmentBlocks.update).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { yToMinutes, minutesToY } from "./useDragToCreate";

export interface ResizeGhost {
  date: string;
  masterId: number | null;
  /** Fixed start minute (the top edge doesn't move during a resize). */
  startMin: number;
  /** Live, snapped duration in minutes. */
  durationMin: number;
  /** Pixel top inside the column (constant) + height for the overlay. */
  top: number;
  height: number;
}

export interface ResizeCommit {
  itemId: string | number;
  kind: "apt" | "block";
  date: string;
  masterId: number | null;
  /** Unchanged start time as HH:MM. */
  time: string;
  fromDurationMin: number;
  /** New duration after the drop (snapped, >= minDurationMin). */
  durationMin: number;
}

interface UseDragToResizeArgs {
  hourHeight: number;
  hourStart: number;
  hourEnd: number;
  /** Snap increment in minutes. Default 15. */
  snapMin?: number;
  /** Floor for the resized duration. Default 15. */
  minDurationMin?: number;
  onResize: (c: ResizeCommit) => void;
}

export interface UseDragToResizeBindArgs {
  itemId: string | number;
  kind?: "apt" | "block";
  date: string;
  masterId: number | null;
  /** Start time HH:MM — the fixed top edge. */
  time: string;
  /** Current duration in minutes — the resize baseline. */
  durationMin: number;
}

export interface UseDragToResizeApi {
  ghost: ResizeGhost | null;
  resizingId: string | number | null;
  /** Attach to the small bottom-edge handle rendered inside each block. */
  bindHandle: (args: UseDragToResizeBindArgs) => {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    style: { touchAction: "none" };
  };
}

interface ResizeState {
  itemId: string | number;
  kind: "apt" | "block";
  date: string;
  masterId: number | null;
  time: string;
  startMin: number;
  fromDurationMin: number;
  pointerId: number;
  pointerStartY: number;
  colTop: number;
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function useDragToResize({
  hourHeight,
  hourStart,
  hourEnd,
  snapMin = 15,
  minDurationMin = 15,
  onResize,
}: UseDragToResizeArgs): UseDragToResizeApi {
  const [ghost, setGhost] = useState<ResizeGhost | null>(null);
  const [resizingId, setResizingId] = useState<string | number | null>(null);
  const stateRef = useRef<ResizeState | null>(null);

  const cleanup = useCallback(() => {
    stateRef.current = null;
    setGhost(null);
    setResizingId(null);
  }, []);

  // Snapped duration from the cursor's Y, clamped to [minDuration, dayEnd].
  const durationFromPointer = useCallback(
    (clientY: number, st: ResizeState): number => {
      const yInCol = clientY - st.colTop;
      let bottomMin = yToMinutes(yInCol, hourHeight, hourStart, snapMin);
      bottomMin = Math.min(bottomMin, hourEnd * 60); // don't spill past the grid
      return Math.max(minDurationMin, bottomMin - st.startMin);
    },
    [hourEnd, hourHeight, hourStart, minDurationMin, snapMin],
  );

  const bindHandle = useCallback((args: UseDragToResizeBindArgs) => {
    const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      // Claim the gesture before the block body's move handler / the
      // DragCreateLayer beneath sees it.
      e.stopPropagation();

      const handle = e.currentTarget;
      const col = handle.closest<HTMLElement>("[data-day]");
      if (!col) return;
      const colTop = col.getBoundingClientRect().top;
      const startMin = parseHHMM(args.time);

      stateRef.current = {
        itemId: args.itemId,
        kind: args.kind ?? "apt",
        date: args.date,
        masterId: args.masterId,
        time: args.time,
        startMin,
        fromDurationMin: args.durationMin,
        pointerId: e.pointerId,
        pointerStartY: e.clientY,
        colTop,
      };
      setResizingId(args.itemId);
      setGhost({
        date: args.date,
        masterId: args.masterId,
        startMin,
        durationMin: args.durationMin,
        top: minutesToY(startMin, hourHeight, hourStart),
        height: (args.durationMin / 60) * hourHeight,
      });

      const handlers = {
        move: (ev: PointerEvent) => {
          const st = stateRef.current;
          if (!st || ev.pointerId !== st.pointerId) return;
          const durationMin = durationFromPointer(ev.clientY, st);
          setGhost({
            date: st.date,
            masterId: st.masterId,
            startMin: st.startMin,
            durationMin,
            top: minutesToY(st.startMin, hourHeight, hourStart),
            height: (durationMin / 60) * hourHeight,
          });
        },
        up: (ev: PointerEvent) => {
          const st = stateRef.current;
          if (!st || ev.pointerId !== st.pointerId) { detach(); cleanup(); return; }
          const durationMin = durationFromPointer(ev.clientY, st);
          if (durationMin !== st.fromDurationMin) {
            onResize({
              itemId: st.itemId,
              kind: st.kind,
              date: st.date,
              masterId: st.masterId,
              time: st.time,
              fromDurationMin: st.fromDurationMin,
              durationMin,
            });
          }
          detach();
          cleanup();
        },
        keydown: (ev: KeyboardEvent) => {
          if (ev.key === "Escape") { detach(); cleanup(); }
        },
      };
      function detach() {
        document.removeEventListener("pointermove", handlers.move);
        document.removeEventListener("pointerup", handlers.up);
        document.removeEventListener("pointercancel", handlers.up);
        document.removeEventListener("keydown", handlers.keydown);
      }

      try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }
      document.addEventListener("pointermove", handlers.move);
      document.addEventListener("pointerup", handlers.up);
      document.addEventListener("pointercancel", handlers.up);
      document.addEventListener("keydown", handlers.keydown);
      e.preventDefault();
    };

    return { onPointerDown, style: { touchAction: "none" as const } };
  }, [cleanup, durationFromPointer, hourHeight, hourStart, onResize]);

  return useMemo(
    () => ({ ghost, resizingId, bindHandle }),
    [ghost, resizingId, bindHandle],
  );
}
