"use client";

/**
 * useDragToMove — pointer-driven hook for Google-Calendar-style
 * drag-to-reschedule. Counterpart to `useDragToCreate`: instead of
 * dragging on EMPTY grid cells to create a new booking, this hook
 * fires when the user picks up an EXISTING appointment block and drops
 * it on a new time slot (and optionally a different day/master column).
 *
 * Geometry contract (grid-agnostic, mirrors useDragToCreate):
 *   * `hourHeight` px corresponds to 60 minutes.
 *   * `hourStart` is the first visible hour (e.g. 8).
 *   * Column resolution happens via DOM data attributes on the column
 *     element under the cursor. The caller annotates each column with
 *     `data-day` (ISO YYYY-MM-DD) and, for the Day view, `data-master-id`.
 *     The hook reads the same attributes via `elementsFromPoint` so the
 *     same hook works for both views without separate column logic.
 *
 * Behaviour:
 *   * `pointerdown` on the block records the initial pointer Y + the
 *     block's start minute + the source column.
 *   * `pointermove` updates `ghost` so the caller can paint a translucent
 *     block at the new position. Cross-column moves snap to the column
 *     under the cursor.
 *   * `pointerup` with Δ < `clickThresholdPx` is treated as a click and
 *     does NOT fire `onCommit` — the click bubbles up to whatever opens
 *     the appointment detail view.
 *   * `pointerup` with a real move fires `onCommit({ date, masterId,
 *     time, durationMin })` exactly once. The hook does not call any
 *     tRPC — wiring decides what mutation to fire.
 *   * `Escape` cancels the in-progress drag without committing.
 *
 * Touch + mouse + pen are all handled via Pointer Events with
 * `touchAction: 'none'` on the block, so long-press-and-drag on iOS
 * works the same as click-and-drag on desktop. Tap-to-open the
 * appointment detail still works because the click threshold guards
 * the "this was a tap, not a drag" path.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { yToMinutes, minutesToY, minutesToHHMM } from "./useDragToCreate";

export interface MoveGhost {
  /** ISO date the ghost is currently over (may differ from source date). */
  date: string;
  /** Master ID the ghost is currently over (Day view); null in Week view. */
  masterId: number | null;
  /** Minute since midnight where the ghost's TOP edge sits, snapped. */
  startMin: number;
  /** Duration in minutes — taken from the source block, not editable here. */
  durationMin: number;
  /** Pixel top inside the resolved column (for caller's overlay rendering). */
  top: number;
  /** Pixel height — durationMin → height at the caller's HOUR_HEIGHT. */
  height: number;
}

export interface MoveCommit {
  appointmentId: string | number;
  /** Which calendar entity moved — routes the commit to the right mutation
   *  (appointments.rescheduleAppointment vs appointmentBlocks.update). */
  kind: "apt" | "block";
  /** Source (pre-drag) coordinates — handy for caller's optimistic update
   *  rollback on conflict. */
  fromDate: string;
  fromMasterId: number | null;
  fromTime: string;
  /** Destination after the drop. Identical to source on a no-op drag. */
  toDate: string;
  toMasterId: number | null;
  toTime: string;
  durationMin: number;
}

interface UseDragToMoveArgs {
  hourHeight: number;
  hourStart: number;
  hourEnd: number;
  /** Snap increment in minutes. Default 15 matches useDragToCreate. */
  snapMin?: number;
  /** Pixel movement below which the gesture is treated as a click, not a
   *  drag. Default 6 mirrors useDragToCreate. */
  clickThresholdPx?: number;
  /** Fired once on pointerup when the user actually dragged. NOT called
   *  for plain taps below the click threshold. */
  onCommit: (c: MoveCommit) => void;
}

export interface UseDragToMoveBindArgs {
  appointmentId: string | number;
  /** Defaults to "apt". Set "block" for reservation / time-off blocks so the
   *  commit routes to appointmentBlocks.update instead of reschedule. */
  kind?: "apt" | "block";
  /** Block's current ISO date (YYYY-MM-DD). */
  date: string;
  /** Block's current master id, or null if the view doesn't pin masters
   *  to columns (Week view). */
  masterId: number | null;
  /** Block's current start time as HH:MM. */
  time: string;
  /** Block's duration in minutes — preserved across the drag. */
  durationMin: number;
}

export interface UseDragToMoveApi {
  ghost: MoveGhost | null;
  /** ID of the appointment currently being dragged, so the caller can dim
   *  its source block while the ghost is shown elsewhere. Null when idle. */
  draggingId: string | number | null;
  /** Returns the pointerdown handler to attach to an appointment block.
   *  Call once per block render. Returned handler is closure-stable across
   *  re-renders only for the same args, so call inside the render path. */
  bindBlock: (args: UseDragToMoveBindArgs) => {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    style: { touchAction: "none" };
  };
}

interface DragState {
  appointmentId: string | number;
  kind: "apt" | "block";
  fromDate: string;
  fromMasterId: number | null;
  fromTime: string;
  fromStartMin: number;
  durationMin: number;
  pointerId: number;
  /** Pointer Y at pointerdown (clientY). */
  pointerStartY: number;
  pointerStartX: number;
  /** Pointer Y relative to the source column body at pointerdown — used
   *  so the block doesn't jump under the cursor when the drag starts. */
  grabOffsetY: number;
}

function findColumnAt(clientX: number, clientY: number): {
  el: HTMLElement;
  date: string;
  masterId: number | null;
  rect: DOMRect;
} | null {
  if (typeof document === "undefined") return null;
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof HTMLElement)) continue;
    const col = node.closest<HTMLElement>("[data-day]");
    if (!col) continue;
    const date = col.dataset.day;
    if (!date) continue;
    // data-master-id is optional. Day view sets it; Week view doesn't.
    const rawMaster = col.dataset.masterId;
    const masterId =
      rawMaster != null && rawMaster !== "" && Number.isFinite(Number(rawMaster))
        ? Number(rawMaster)
        : null;
    return { el: col, date, masterId, rect: col.getBoundingClientRect() };
  }
  return null;
}

export function useDragToMove({
  hourHeight,
  hourStart,
  hourEnd,
  snapMin = 15,
  clickThresholdPx = 6,
  onCommit,
}: UseDragToMoveArgs): UseDragToMoveApi {
  const [ghost, setGhost] = useState<MoveGhost | null>(null);
  const [draggingId, setDraggingId] = useState<string | number | null>(null);
  const stateRef = useRef<DragState | null>(null);

  const cleanup = useCallback(() => {
    stateRef.current = null;
    setGhost(null);
    setDraggingId(null);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const st = stateRef.current;
    if (!st || e.pointerId !== st.pointerId) return;

    // While the pointer hasn't crossed the click threshold, don't paint
    // the ghost — keeps a quick tap from flashing a misleading preview.
    const dx = Math.abs(e.clientX - st.pointerStartX);
    const dy = Math.abs(e.clientY - st.pointerStartY);
    if (dx < clickThresholdPx && dy < clickThresholdPx) return;

    const col = findColumnAt(e.clientX, e.clientY);
    if (!col) {
      // Pointer left the grid — keep the last ghost on screen so the
      // user doesn't lose their place visually, but mark the state.
      return;
    }

    // The ghost's top edge sits where the user's grab-point lands inside
    // the new column, so dragging an 11:00 block by its body doesn't
    // snap its top to the cursor — the block "sticks" to the grab spot.
    const yInCol = e.clientY - col.rect.top - st.grabOffsetY;
    const startMin = yToMinutes(yInCol, hourHeight, hourStart, snapMin);
    const clampedStart = Math.min(
      Math.max(hourStart * 60, startMin),
      hourEnd * 60 - snapMin,
    );
    const top = minutesToY(clampedStart, hourHeight, hourStart);
    const height = (st.durationMin / 60) * hourHeight;
    setGhost({
      date: col.date,
      masterId: col.masterId,
      startMin: clampedStart,
      durationMin: st.durationMin,
      top,
      height,
    });
  }, [clickThresholdPx, hourEnd, hourHeight, hourStart, snapMin]);

  const detach = useCallback((handlers: {
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    keydown: (e: KeyboardEvent) => void;
  }) => {
    document.removeEventListener("pointermove", handlers.move);
    document.removeEventListener("pointerup", handlers.up);
    document.removeEventListener("pointercancel", handlers.up);
    document.removeEventListener("keydown", handlers.keydown);
  }, []);

  const bindBlock = useCallback((args: UseDragToMoveBindArgs) => {
    const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return; // primary only
      // Don't fight the parent DragCreateLayer — but we DO want this
      // pointerdown to claim the gesture before the layer sees it.
      e.stopPropagation();

      const block = e.currentTarget;
      const col = block.closest<HTMLElement>("[data-day]");
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      // Offset from block-top to grab-point — preserves the user's grab
      // location instead of snapping the block top to the cursor.
      const grabOffsetY = e.clientY - blockRect.top;

      const [hh, mm] = args.time.split(":").map(Number);
      const fromStartMin = (hh ?? 0) * 60 + (mm ?? 0);

      stateRef.current = {
        appointmentId: args.appointmentId,
        kind: args.kind ?? "apt",
        fromDate: args.date,
        fromMasterId: args.masterId,
        fromTime: args.time,
        fromStartMin,
        durationMin: args.durationMin,
        pointerId: e.pointerId,
        pointerStartY: e.clientY,
        pointerStartX: e.clientX,
        grabOffsetY,
      };

      // Pre-seed the ghost at the source position so the very first
      // pointermove past the threshold has a consistent frame.
      const top = minutesToY(fromStartMin, hourHeight, hourStart);
      setGhost({
        date: args.date,
        masterId: args.masterId,
        startMin: fromStartMin,
        durationMin: args.durationMin,
        top,
        height: (args.durationMin / 60) * hourHeight,
      });
      setDraggingId(args.appointmentId);

      const handlers = {
        move: (ev: PointerEvent) => onPointerMove(ev),
        up: (ev: PointerEvent) => {
          const st = stateRef.current;
          if (!st || ev.pointerId !== st.pointerId) { detach(handlers); cleanup(); return; }
          const dx = Math.abs(ev.clientX - st.pointerStartX);
          const dy = Math.abs(ev.clientY - st.pointerStartY);
          const isClick = dx < clickThresholdPx && dy < clickThresholdPx;
          if (isClick) {
            detach(handlers);
            cleanup();
            return; // let the underlying button click handle the tap
          }
          const col2 = findColumnAt(ev.clientX, ev.clientY) ?? undefined;
          // If the user dropped outside any column, fall back to source.
          const toDate = col2?.date ?? st.fromDate;
          const toMasterId = col2 ? col2.masterId : st.fromMasterId;
          const yInCol = col2 ? ev.clientY - col2.rect.top - st.grabOffsetY : minutesToY(st.fromStartMin, hourHeight, hourStart);
          const rawStart = col2
            ? yToMinutes(yInCol, hourHeight, hourStart, snapMin)
            : st.fromStartMin;
          const clampedStart = Math.min(
            Math.max(hourStart * 60, rawStart),
            hourEnd * 60 - snapMin,
          );
          const toTime = minutesToHHMM(clampedStart);

          // Only fire onCommit if something actually changed — avoids a
          // round-trip for "lifted the block, dropped it where it was".
          const isMove =
            toDate !== st.fromDate ||
            toMasterId !== st.fromMasterId ||
            toTime !== st.fromTime;
          if (isMove) {
            onCommit({
              appointmentId: st.appointmentId,
              kind: st.kind,
              fromDate: st.fromDate,
              fromMasterId: st.fromMasterId,
              fromTime: st.fromTime,
              toDate,
              toMasterId,
              toTime,
              durationMin: st.durationMin,
            });
          }
          detach(handlers);
          cleanup();
        },
        keydown: (ev: KeyboardEvent) => {
          if (ev.key === "Escape") {
            detach(handlers);
            cleanup();
          }
        },
      };

      try { block.setPointerCapture(e.pointerId); } catch { /* noop */ }
      document.addEventListener("pointermove", handlers.move);
      document.addEventListener("pointerup", handlers.up);
      document.addEventListener("pointercancel", handlers.up);
      document.addEventListener("keydown", handlers.keydown);
      // Suppress default so the surrounding DragCreateLayer / button
      // focus ring / drag-image don't fight the gesture.
      e.preventDefault();
    };

    return {
      onPointerDown,
      style: { touchAction: "none" as const },
    };
  }, [cleanup, clickThresholdPx, detach, hourEnd, hourHeight, hourStart, onPointerMove, onCommit, snapMin]);

  return useMemo(
    () => ({ ghost, draggingId, bindBlock }),
    [ghost, draggingId, bindBlock],
  );
}
