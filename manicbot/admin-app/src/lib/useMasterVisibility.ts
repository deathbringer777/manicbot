"use client";

/**
 * useMasterVisibility — shared state for the per-master calendar
 * visibility toggle. Owned by the salon dashboard so the
 * `CalendarLeftRail` and `SalonDayView` see the same Set instance and
 * stay in sync without prop drilling between siblings.
 *
 * Stores the HIDDEN ids (not visible) so a master added later renders
 * by default. Persists to localStorage under
 * `manicbot_day_view_visible_masters` (key kept stable for compatibility
 * with the previous in-DayView implementation).
 */

import { useCallback, useState } from "react";

const STORAGE_KEY = "manicbot_day_view_visible_masters";

export function useMasterVisibility(): {
  hiddenMasterIds: Set<number>;
  toggleMasterVisible: (chatId: number) => void;
  showAllMasters: () => void;
} {
  const [hiddenMasterIds, setHiddenMasterIds] = useState<Set<number>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set<number>(Array.isArray(arr) ? arr.filter((x) => typeof x === "number") : []);
    } catch {
      return new Set();
    }
  });

  const toggleMasterVisible = useCallback((chatId: number) => {
    setHiddenMasterIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  const showAllMasters = useCallback(() => {
    setHiddenMasterIds(new Set());
    try {
      localStorage.setItem(STORAGE_KEY, "[]");
    } catch {
      /* noop */
    }
  }, []);

  return { hiddenMasterIds, toggleMasterVisible, showAllMasters };
}
