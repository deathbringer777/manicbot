"use client";

/**
 * useFloatingDialog — free-form drag + corner-resize for a fixed-position
 * floating panel, clamped to a bounds element (the calendar work area).
 *
 * Coordinate model: the persisted rect (`value`) is stored in the bounds
 * element's OWN coordinates (x/y relative to its top-left), so it survives
 * scroll and viewport changes. Rendering converts back to viewport `fixed`
 * coords using the bounds element's live getBoundingClientRect().
 *
 * Two modes:
 *   - `value == null` → the caller positions the panel anchored to the block
 *     (we just expose drag/resize handles; the first gesture seeds a value).
 *   - `value != null` → we own positioning at the saved rect (clamped).
 *
 * Built on Pointer Events + setPointerCapture, mirroring useDragToMove. The
 * caller gates `enabled` to desktop (touch keeps the bottom-sheet).
 */
import { useCallback, useRef, useState } from "react";
import type { AppointmentDialogRect } from "~/lib/useDashboardPrefs";

interface Args {
  enabled: boolean;
  boundsRef: React.RefObject<HTMLElement | null>;
  /** The panel element — measured to seed the first drag from its anchored rect. */
  panelRef: React.RefObject<HTMLElement | null>;
  value: AppointmentDialogRect | null;
  onCommit: (rect: AppointmentDialogRect) => void;
  /** Anchored fallback position (viewport coords) used when value is null. */
  anchoredLeft: number;
  anchoredTop: number;
  width: number;
  minW?: number;
  minH?: number;
}

interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

export function useFloatingDialog({
  enabled,
  boundsRef,
  panelRef,
  value,
  onCommit,
  anchoredLeft,
  anchoredTop,
  width,
  minW = 300,
  minH = 220,
}: Args) {
  // Live rect during an active gesture (viewport coords). Null ⇒ render from
  // `value`/anchored base.
  const [live, setLive] = useState<ViewportRect | null>(null);
  const gesture = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    start: ViewportRect;
  } | null>(null);

  /** Current base rect in viewport coords (no active gesture). */
  const baseRect = useCallback((): ViewportRect => {
    const b = boundsRef.current?.getBoundingClientRect();
    if (value && b) {
      const w = clamp(value.w, minW, b.width);
      const h = clamp(value.h, minH, b.height);
      const x = clamp(value.x, 0, b.width - w);
      const y = clamp(value.y, 0, b.height - h);
      return { left: b.left + x, top: b.top + y, width: w, height: h };
    }
    // Anchored fallback — measure the panel's rendered height so the first
    // drag starts from a correct box.
    const measured = panelRef.current?.getBoundingClientRect();
    return {
      left: anchoredLeft,
      top: anchoredTop,
      width,
      height: measured?.height ?? minH,
    };
  }, [boundsRef, panelRef, value, anchoredLeft, anchoredTop, width, minW, minH]);

  const endGesture = useCallback(() => {
    const b = boundsRef.current?.getBoundingClientRect();
    const r = live;
    gesture.current = null;
    setLive(null);
    if (!b || !r) return;
    onCommit({
      x: Math.round(r.left - b.left),
      y: Math.round(r.top - b.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }, [boundsRef, live, onCommit]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const g = gesture.current;
    const b = boundsRef.current?.getBoundingClientRect();
    if (!g || !b) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.mode === "move") {
      const left = clamp(g.start.left + dx, b.left, b.left + b.width - g.start.width);
      const top = clamp(g.start.top + dy, b.top, b.top + b.height - g.start.height);
      setLive({ ...g.start, left, top });
    } else {
      const maxW = b.left + b.width - g.start.left;
      const maxH = b.top + b.height - g.start.top;
      const width2 = clamp(g.start.width + dx, minW, maxW);
      const height2 = clamp(g.start.height + dy, minH, maxH);
      setLive({ left: g.start.left, top: g.start.top, width: width2, height: height2 });
    }
  }, [boundsRef, minW, minH]);

  const beginGesture = useCallback((mode: "move" | "resize", e: React.PointerEvent) => {
    if (!enabled) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    const start = baseRect();
    gesture.current = { mode, startX: e.clientX, startY: e.clientY, start };
    setLive(start);
    const up = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", up);
      endGesture();
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", up);
  }, [enabled, baseRect, onPointerMove, endGesture]);

  const dragHandleProps = {
    onPointerDown: (e: React.PointerEvent) => beginGesture("move", e),
    style: { cursor: "move", touchAction: "none" as const },
  };
  const resizeHandleProps = {
    onPointerDown: (e: React.PointerEvent) => beginGesture("resize", e),
    style: { cursor: "nwse-resize", touchAction: "none" as const },
  };

  // Style to apply to the floating panel. Null when not enabled OR when there's
  // no value and no active gesture (caller falls back to anchored positioning).
  let style: React.CSSProperties | null = null;
  if (enabled) {
    const r = live ?? (value ? baseRect() : null);
    if (r) {
      style = {
        position: "fixed",
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      };
    }
  }

  return { style, dragHandleProps, resizeHandleProps, dragging: live != null };
}
