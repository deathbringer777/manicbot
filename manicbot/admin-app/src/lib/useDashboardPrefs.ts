"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRole } from "~/components/RoleContext";
import { useEffectiveProfile } from "~/lib/effectiveProfile";
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
  defaultTab: "",
  tabOrder: [],
  pinnedTabs: [],
  bottomNavOrder: [],
  bottomNavLayout: "default",
};

function load(tenantId?: string | null, profileKey?: string): DashboardPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(storageKey(tenantId, profileKey));
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

function save(prefs: DashboardPrefs, tenantId?: string | null, profileKey?: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(tenantId, profileKey), JSON.stringify(prefs));
}

/**
 * One-time copy of the legacy tenant-only key into the new
 * profile-scoped key. Without this the user would silently lose their
 * saved tab order / pinned tabs / bottom-nav on first load — server
 * sync covers most fields now, but legacy installs still hold local-only
 * customisations during the rollout window. Idempotent: re-running with
 * the new key already populated is a no-op.
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
  const profile = useEffectiveProfile();
  const profileKey = profile.effectiveProfileKey;
  const [prefs, setPrefsState] = useState<DashboardPrefs>(() => load(tenantId, profileKey));

  // Server-side pull on mount / tenant change. Server wins on conflict
  // so a fresh device immediately sees the user's saved layout. Gated on
  // canWrite so the anonymous/loading state doesn't fetch.
  const serverQuery = api.webUsers.getMyUiPrefs.useQuery(
    { tenantId: tenantId ?? "" },
    {
      enabled: !!tenantId && profile.canWrite,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  useEffect(() => {
    if (!serverQuery.data) return;
    if (!profile.canWrite) return;
    const merged: DashboardPrefs = { ...DEFAULTS, ...(serverQuery.data as Partial<DashboardPrefs>) };
    setPrefsState(merged);
    save(merged, tenantId, profileKey);
  }, [serverQuery.data, tenantId, profileKey, profile.canWrite]);

  // Re-load when tenant OR profile switches (same browser, multiple accounts).
  useEffect(() => {
    if (tenantId && profile.effectiveWebUserId != null) {
      migrateLegacyTenantKey(tenantId, profileKey);
    }
    setPrefsState(load(tenantId, profileKey));
  }, [tenantId, profileKey, profile.effectiveWebUserId]);

  const setMut = api.webUsers.setMyUiPrefs.useMutation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: DashboardPrefs) => {
    save(next, tenantId, profileKey);
    if (!tenantId) return;
    // Skip the server write for the anonymous/loading state.
    if (!profile.canWrite) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setMut.mutate({ tenantId, prefs: next as unknown as Record<string, unknown> });
    }, 400);
  }, [tenantId, profileKey, profile.canWrite, setMut]);

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
