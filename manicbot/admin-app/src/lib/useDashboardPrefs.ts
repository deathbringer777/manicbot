"use client";

import { useState, useCallback, useEffect } from "react";
import { useRole } from "~/components/RoleContext";

export interface DashboardPrefs {
  hiddenTabs: string[];
  showTodayApts: boolean;
  defaultTab: string;
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

const KEY_PREFIX = "manicbot_dashboard_prefs";

/** Maximum number of items the mobile bottom-nav can fit. */
export const BOTTOM_NAV_LIMIT = 5;

/** Storage key is tenant-scoped to prevent cross-tenant bleed */
function storageKey(tenantId?: string | null): string {
  return tenantId ? `${KEY_PREFIX}_${tenantId}` : KEY_PREFIX;
}

const DEFAULTS: DashboardPrefs = {
  hiddenTabs: [],
  showTodayApts: true,
  defaultTab: "overview",
  bottomNavOrder: [],
  bottomNavLayout: "default",
};

function load(tenantId?: string | null): DashboardPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(storageKey(tenantId));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: DashboardPrefs, tenantId?: string | null) {
  localStorage.setItem(storageKey(tenantId), JSON.stringify(prefs));
}

export function useDashboardPrefs() {
  const { tenantId } = useRole();
  const [prefs, setPrefsState] = useState<DashboardPrefs>(() => load(tenantId));

  // Re-load when tenant switches (same browser, multiple tenant accounts)
  useEffect(() => {
    setPrefsState(load(tenantId));
  }, [tenantId]);

  const update = useCallback((patch: Partial<DashboardPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      save(next, tenantId);
      return next;
    });
  }, [tenantId]);

  const toggleTab = useCallback((tab: string) => {
    setPrefsState((prev) => {
      const hidden = prev.hiddenTabs.includes(tab)
        ? prev.hiddenTabs.filter((t) => t !== tab)
        : [...prev.hiddenTabs, tab];
      // If hiding the default tab, reset default to overview
      const defaultTab = hidden.includes(prev.defaultTab) ? "overview" : prev.defaultTab;
      const next = { ...prev, hiddenTabs: hidden, defaultTab };
      save(next, tenantId);
      return next;
    });
  }, [tenantId]);

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
    setShowTodayApts,
    setDefaultTab,
    setBottomNav,
    resetBottomNav,
  };
}

// Pure helpers for testing / server-side seeding
export { load as loadDashboardPrefs, save as saveDashboardPrefs, storageKey as dashboardPrefsKey };
