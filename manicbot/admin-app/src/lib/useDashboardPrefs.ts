"use client";

import { useState, useCallback, useEffect } from "react";
import { useRole } from "~/components/RoleContext";

export interface DashboardPrefs {
  hiddenTabs: string[];
  hiddenStatCards: string[];
  showTodayApts: boolean;
  defaultTab: string;
}

const KEY_PREFIX = "manicbot_dashboard_prefs";

/** Storage key is tenant-scoped to prevent cross-tenant bleed */
function storageKey(tenantId?: string | null): string {
  return tenantId ? `${KEY_PREFIX}_${tenantId}` : KEY_PREFIX;
}

const DEFAULTS: DashboardPrefs = {
  hiddenTabs: [],
  hiddenStatCards: [],
  showTodayApts: true,
  defaultTab: "overview",
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

  const toggleStatCard = useCallback((card: string) => {
    setPrefsState((prev) => {
      const hidden = prev.hiddenStatCards.includes(card)
        ? prev.hiddenStatCards.filter((c) => c !== card)
        : [...prev.hiddenStatCards, card];
      const next = { ...prev, hiddenStatCards: hidden };
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

  return { prefs, toggleTab, toggleStatCard, setShowTodayApts, setDefaultTab };
}

// Pure helpers for testing / server-side seeding
export { load as loadDashboardPrefs, save as saveDashboardPrefs, storageKey as dashboardPrefsKey };
