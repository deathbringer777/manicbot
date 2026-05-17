"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRole } from "~/components/RoleContext";
import { api } from "~/trpc/react";

export interface DashboardPrefs {
  hiddenTabs: string[];
  showTodayApts: boolean;
  defaultTab: string;
  /** Ordered list of tab ids that determines sidebar render order. Items not
   *  present fall to the end of the sidebar in their original (definition)
   *  order. Empty array = use default order. */
  tabOrder: string[];
  /** Tab ids pinned to the top of the sidebar (max 5). Pinned items always
   *  render before non-pinned items, in pin-order. */
  pinnedTabs: string[];
  /**
   * User-chosen order of bottom-nav items (mobile + iPad portrait).
   * Each entry is an `href` from the nav config. When `bottomNavLayout`
   * is `"default"`, this list is IGNORED and the shells fall back to the
   * legacy "first 5 + Settings" slice. Cap is enforced by `setBottomNav`,
   * not at the schema layer, so older payloads with a longer list don't
   * crash on load.
   */
  bottomNavOrder: string[];
  /**
   * `"default"` (no customisation — zero-regression path) vs `"custom"`
   * (use `bottomNavOrder`). Flipping back to `"default"` is the "reset"
   * action exposed in the settings UI.
   */
  bottomNavLayout: "default" | "custom";
}

export const MAX_PINNED_TABS = 5;

/** Maximum number of items the mobile bottom-nav can fit. */
export const BOTTOM_NAV_LIMIT = 5;

const KEY_PREFIX = "manicbot_dashboard_prefs";

/** Storage key is tenant-scoped to prevent cross-tenant bleed */
function storageKey(tenantId?: string | null): string {
  return tenantId ? `${KEY_PREFIX}_${tenantId}` : KEY_PREFIX;
}

const DEFAULTS: DashboardPrefs = {
  hiddenTabs: [],
  showTodayApts: true,
  defaultTab: "",
  tabOrder: [],
  pinnedTabs: [],
  bottomNavOrder: [],
  bottomNavLayout: "default",
};

function load(tenantId?: string | null): DashboardPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(storageKey(tenantId));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return {
      ...DEFAULTS,
      ...parsed,
      // Defensive: server-fetched arrays could be missing.
      tabOrder: Array.isArray(parsed.tabOrder) ? parsed.tabOrder : [],
      pinnedTabs: Array.isArray(parsed.pinnedTabs) ? parsed.pinnedTabs : [],
      bottomNavOrder: Array.isArray(parsed.bottomNavOrder) ? parsed.bottomNavOrder : [],
    };
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: DashboardPrefs, tenantId?: string | null) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(tenantId), JSON.stringify(prefs));
}

/**
 * Apply pinned/order prefs to a list of tabs and return them in display order.
 *
 *   1. Pinned tabs come first, in `pinnedTabs` order.
 *   2. Then non-pinned tabs from `tabOrder`, in that order.
 *   3. Then any tabs in `allTabs` that didn't appear above, in definition order.
 *   4. Tabs in `hiddenTabs` are filtered out unless they appear in
 *      `alwaysVisible` (e.g. the "overview" tab can't be hidden).
 *
 * Pure function so it's trivially testable.
 */
export function applyTabPrefs(
  allTabs: string[],
  prefs: Pick<DashboardPrefs, "tabOrder" | "pinnedTabs" | "hiddenTabs">,
  options: { applyHidden?: boolean; alwaysVisible?: string[] } = {},
): string[] {
  const { applyHidden = true, alwaysVisible = [] } = options;
  const allSet = new Set(allTabs);

  const pinned = prefs.pinnedTabs.filter((id) => allSet.has(id));
  const pinnedSet = new Set(pinned);

  const ordered = prefs.tabOrder.filter((id) => allSet.has(id) && !pinnedSet.has(id));
  const orderedSet = new Set(ordered);

  const remaining = allTabs.filter((id) => !pinnedSet.has(id) && !orderedSet.has(id));

  const result = [...pinned, ...ordered, ...remaining];
  if (!applyHidden) return result;

  const visibleSet = new Set(alwaysVisible);
  return result.filter((id) => visibleSet.has(id) || !prefs.hiddenTabs.includes(id));
}

export function useDashboardPrefs() {
  const { tenantId } = useRole();
  const [prefs, setPrefsState] = useState<DashboardPrefs>(() => load(tenantId));

  // Server-side pull on mount / tenant change. Server wins on conflict so that
  // a fresh device immediately sees the user's saved layout.
  const serverQuery = api.webUsers.getMyUiPrefs.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: !!tenantId, staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
  );

  useEffect(() => {
    if (!serverQuery.data) return;
    const merged: DashboardPrefs = { ...DEFAULTS, ...(serverQuery.data as Partial<DashboardPrefs>) };
    setPrefsState(merged);
    save(merged, tenantId);
  }, [serverQuery.data, tenantId]);

  // Re-load when tenant switches
  useEffect(() => {
    setPrefsState(load(tenantId));
  }, [tenantId]);

  const setMut = api.webUsers.setMyUiPrefs.useMutation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: DashboardPrefs) => {
    save(next, tenantId);
    if (!tenantId) return;
    // Debounced server write: drag-and-drop fires many tiny updates; we batch.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setMut.mutate({ tenantId, prefs: next as unknown as Record<string, unknown> });
    }, 400);
  }, [tenantId, setMut]);

  const update = useCallback((patch: Partial<DashboardPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, [persist]);

  const toggleTab = useCallback((tab: string) => {
    setPrefsState((prev) => {
      const hidden = prev.hiddenTabs.includes(tab)
        ? prev.hiddenTabs.filter((t) => t !== tab)
        : [...prev.hiddenTabs, tab];
      // If hiding the default tab, reset default to "not selected"
      const defaultTab = hidden.includes(prev.defaultTab) ? "" : prev.defaultTab;
      // Hidden tabs cannot be pinned — drop them from the pin list as a side
      // effect so the UI never shows "pinned but hidden".
      const pinnedTabs = prev.pinnedTabs.filter((t) => !hidden.includes(t));
      const next = { ...prev, hiddenTabs: hidden, defaultTab, pinnedTabs };
      persist(next);
      return next;
    });
  }, [persist]);

  const togglePin = useCallback((tab: string) => {
    let didCapPin = false;
    setPrefsState((prev) => {
      if (prev.pinnedTabs.includes(tab)) {
        const next = { ...prev, pinnedTabs: prev.pinnedTabs.filter((t) => t !== tab) };
        persist(next);
        return next;
      }
      if (prev.pinnedTabs.length >= MAX_PINNED_TABS) {
        didCapPin = true;
        return prev;
      }
      const next = { ...prev, pinnedTabs: [...prev.pinnedTabs, tab] };
      persist(next);
      return next;
    });
    return { capped: didCapPin };
  }, [persist]);

  const setTabOrder = useCallback((order: string[]) => {
    setPrefsState((prev) => {
      const next = { ...prev, tabOrder: order };
      persist(next);
      return next;
    });
  }, [persist]);

  const setShowTodayApts = useCallback((show: boolean) => {
    update({ showTodayApts: show });
  }, [update]);

  const setDefaultTab = useCallback((tab: string) => {
    update({ defaultTab: tab });
  }, [update]);

  /**
   * Replace the mobile bottom-nav order with the supplied list and switch
   * to `bottomNavLayout='custom'`. The list is de-duped and clamped to
   * `BOTTOM_NAV_LIMIT` items — entries past the cap are dropped silently
   * so a 6-item drop from the settings UI feels predictable (FIFO).
   */
  const setBottomNav = useCallback((order: string[]) => {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const href of order) {
      if (typeof href !== "string" || !href) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      deduped.push(href);
      if (deduped.length >= BOTTOM_NAV_LIMIT) break;
    }
    update({ bottomNavOrder: deduped, bottomNavLayout: "custom" });
  }, [update]);

  /** Reset bottom-nav customisation back to the role-default ordering. */
  const resetBottomNav = useCallback(() => {
    update({ bottomNavOrder: [], bottomNavLayout: "default" });
  }, [update]);

  return {
    prefs,
    toggleTab,
    togglePin,
    setTabOrder,
    setShowTodayApts,
    setDefaultTab,
    setBottomNav,
    resetBottomNav,
  };
}

// Pure helpers for testing / server-side seeding
export { load as loadDashboardPrefs, save as saveDashboardPrefs, storageKey as dashboardPrefsKey };
