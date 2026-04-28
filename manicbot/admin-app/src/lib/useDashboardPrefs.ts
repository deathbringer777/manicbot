"use client";

import { useState, useCallback } from "react";
import { useRole } from "~/components/RoleContext";

export interface DashboardPrefs {
  hiddenTabs: string[];
  hiddenStatCards: string[];
  showTodayApts: boolean;
  defaultTab: string;
}

const KEY_PREFIX = "manicbot_dashboard_prefs";

const DEFAULTS: DashboardPrefs = {
  hiddenTabs: [],
  hiddenStatCards: [],
  showTodayApts: true,
  defaultTab: "overview",
};

function storageKey(tenantId?: string | null): string {
  return tenantId ? `${KEY_PREFIX}_${tenantId}` : KEY_PREFIX;
}

function load(key: string): DashboardPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: DashboardPrefs, key: string) {
  localStorage.setItem(key, JSON.stringify(prefs));
}

export function useDashboardPrefs() {
  const { tenantId } = useRole();
  const key = storageKey(tenantId);
  const [prefs, setPrefsState] = useState<DashboardPrefs>(() => load(key));

  const update = useCallback((patch: Partial<DashboardPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      save(next, key);
      return next;
    });
  }, [key]);

  const toggleTab = useCallback((tab: string) => {
    setPrefsState((prev) => {
      const hidden = prev.hiddenTabs.includes(tab)
        ? prev.hiddenTabs.filter((t) => t !== tab)
        : [...prev.hiddenTabs, tab];
      // If hiding the default tab, reset default to overview
      const defaultTab = hidden.includes(prev.defaultTab) ? "overview" : prev.defaultTab;
      const next = { ...prev, hiddenTabs: hidden, defaultTab };
      save(next, key);
      return next;
    });
  }, [key]);

  const toggleStatCard = useCallback((card: string) => {
    setPrefsState((prev) => {
      const hidden = prev.hiddenStatCards.includes(card)
        ? prev.hiddenStatCards.filter((c) => c !== card)
        : [...prev.hiddenStatCards, card];
      const next = { ...prev, hiddenStatCards: hidden };
      save(next, key);
      return next;
    });
  }, [key]);

  const setShowTodayApts = useCallback((show: boolean) => {
    update({ showTodayApts: show });
  }, [update]);

  const setDefaultTab = useCallback((tab: string) => {
    update({ defaultTab: tab });
  }, [update]);

  return { prefs, toggleTab, toggleStatCard, setShowTodayApts, setDefaultTab };
}
