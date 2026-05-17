"use client";

import { useState, useCallback, useEffect } from "react";
import { useRole } from "~/components/RoleContext";
import { useEffectiveProfile } from "~/lib/effectiveProfile";

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

/**
 * localStorage key. When `profileKey` is supplied the key is the new
 * profile-scoped format; otherwise the legacy tenant-only form is
 * returned so the migration shim can read the prior value before
 * overwriting it.
 */
function storageKey(tenantId?: string | null, profileKey?: string): string {
  if (!tenantId) return KEY_PREFIX;
  if (profileKey) return `${KEY_PREFIX}_${tenantId}_${profileKey}`;
  return `${KEY_PREFIX}_${tenantId}`;
}

const DEFAULTS: DashboardPrefs = {
  hiddenTabs: [],
  showTodayApts: true,
  defaultTab: "overview",
  bottomNavOrder: [],
  bottomNavLayout: "default",
};

function load(tenantId?: string | null, profileKey?: string): DashboardPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(storageKey(tenantId, profileKey));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: DashboardPrefs, tenantId?: string | null, profileKey?: string) {
  localStorage.setItem(storageKey(tenantId, profileKey), JSON.stringify(prefs));
}

/**
 * One-time copy of the legacy tenant-only key into the new
 * profile-scoped key. UNLIKE pinned-plugins (where D1 is the source of
 * truth), `bottomNavOrder` / `hiddenTabs` live ONLY in localStorage — so
 * skipping the migration would silently reset the user's saved layout
 * on first load. Idempotent: re-running with the new key already
 * populated is a no-op.
 */
function migrateLegacyTenantKey(tenantId: string, profileKey: string) {
  if (typeof window === "undefined") return;
  try {
    const newKey = storageKey(tenantId, profileKey);
    const legacyKey = storageKey(tenantId);
    if (window.localStorage.getItem(newKey)) return;
    const legacyRaw = window.localStorage.getItem(legacyKey);
    if (!legacyRaw) return;
    window.localStorage.setItem(newKey, legacyRaw);
    window.localStorage.removeItem(legacyKey);
  } catch {
    // noop
  }
}

export function useDashboardPrefs() {
  const { tenantId } = useRole();
  const profile = useEffectiveProfile();
  const profileKey = profile.effectiveProfileKey;
  const [prefs, setPrefsState] = useState<DashboardPrefs>(() => load(tenantId, profileKey));

  // Re-load when tenant OR profile switches (same browser, multiple
  // accounts, OR owner toggling «view as master» preview).
  useEffect(() => {
    if (tenantId && !profile.isPreview && profile.effectiveWebUserId != null) {
      migrateLegacyTenantKey(tenantId, profileKey);
    }
    setPrefsState(load(tenantId, profileKey));
  }, [tenantId, profileKey, profile.isPreview, profile.effectiveWebUserId]);

  const update = useCallback((patch: Partial<DashboardPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      save(next, tenantId, profileKey);
      return next;
    });
  }, [tenantId, profileKey]);

  const toggleTab = useCallback((tab: string) => {
    setPrefsState((prev) => {
      const hidden = prev.hiddenTabs.includes(tab)
        ? prev.hiddenTabs.filter((t) => t !== tab)
        : [...prev.hiddenTabs, tab];
      // If hiding the default tab, reset default to overview
      const defaultTab = hidden.includes(prev.defaultTab) ? "overview" : prev.defaultTab;
      const next = { ...prev, hiddenTabs: hidden, defaultTab };
      save(next, tenantId, profileKey);
      return next;
    });
  }, [tenantId, profileKey]);

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
