"use client";

import { useEffect, useState } from "react";

/**
 * Shared "current time" ticker. Returns `Date.now()` and re-renders the
 * consumer every `intervalMs` (default 60s). One source for both the
 * red "now" line marker in `SalonDayView` and the past-event dimming —
 * keeps them in lockstep and avoids two separate `setInterval` loops.
 *
 * Default interval is 60s because the day grid's minute precision is
 * already coarse-grained; a faster tick would re-render the whole
 * calendar without any visible benefit.
 */
export function useNowTicker(intervalMs = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
