"use client";

/**
 * useAnchoredPosition — compute a fixed-position placement for a floating
 * card anchored next to a calendar block (Google-Calendar-style event
 * popover). Generalized from ManualBookingModal's `useAnchorMetrics`:
 *
 *   - Prefers placing the panel BELOW the anchor; auto-flips ABOVE when
 *     there isn't enough room below and there is room above.
 *   - Clamps the panel horizontally into the viewport so a block near the
 *     right edge doesn't push the card off-screen.
 *   - Recomputes on resize (callers close on scroll, so no scroll-reposition
 *     here — the stored anchor rect would be stale after an inner-scroll).
 *
 * The caller passes a captured anchor rect (the clicked block's
 * `getBoundingClientRect()` snapshot, or a synthetic rect at a drag-release
 * point) rather than a live element ref, so this hook stays presentation-only.
 */

import { useCallback, useLayoutEffect, useState } from "react";

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AnchoredPos {
  left: number;
  top: number;
  /** true when the panel was placed above the anchor instead of below. */
  flipped: boolean;
}

export function useAnchoredPosition(
  anchorRect: AnchorRect | null,
  open: boolean,
  panelWidth: number,
  panelHeightEstimate: number,
): AnchoredPos | null {
  const [pos, setPos] = useState<AnchoredPos | null>(null);

  const compute = useCallback((): AnchoredPos | null => {
    if (!anchorRect || typeof window === "undefined") return null;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = anchorRect;

    const spaceBelow = vh - (r.top + r.height);
    const wantsAbove =
      spaceBelow < panelHeightEstimate + gap && r.top - gap - panelHeightEstimate > 0;

    const top = wantsAbove
      ? Math.max(gap, r.top - gap - panelHeightEstimate)
      : r.top + r.height + gap;

    // Anchor to the block's left edge, then clamp into the viewport.
    let left = r.left;
    left = Math.min(left, vw - panelWidth - gap);
    left = Math.max(gap, left);

    return { left, top, flipped: wantsAbove };
  }, [anchorRect, panelWidth, panelHeightEstimate]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    setPos(compute());
    const onResize = () => setPos(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, compute]);

  return pos;
}
