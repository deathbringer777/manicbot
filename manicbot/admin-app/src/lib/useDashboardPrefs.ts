"use client";

import { useState, useCallback } from "react";

export interface DashboardPrefs {
  hiddenTabs: string[];
  hiddenStatCards: string[];
  showTodayApts: boolean;
  defaultTab: string;
}

const STORAGE_KEY = "manicbot_dashboard_prefs";

const DEFAULTS: DashboardPrefs = {
  hiddenTabs: [],
  hiddenStatCards: [],
  showTodayApts: true,
  defaultTab: "overview",
};

function load(): DashboardPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: DashboardPrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function useDashboardPrefs() {
  const [prefs, setPrefsState] = useState<DashboardPrefs>(load);

  const update = useCallback((patch: Partial<DashboardPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const toggleTab = useCallback((tab: string) => {
    setPrefsState((prev) => {
      const hidden = prev.hiddenTabs.includes(tab)
        ? prev.hiddenTabs.filter((t) => t !== tab)
        : [...prev.hiddenTabs, tab];
      // If hiding the default tab, reset default to overview
      const defaultTab = hidden.includes(prev.defaultTab) ? "overview" : prev.defaultTab;
      const next = { ...prev, hiddenTabs: hidden, defaultTab };
      save(next);
      return next;
    });
  }, []);

  const toggleStatCard = useCallback((card: string) => {
    setPrefsState((prev) => {
      const hidden = prev.hiddenStatCards.includes(card)
        ? prev.hiddenStatCards.filter((c) => c !== card)
        : [...prev.hiddenStatCards, card];
      const next = { ...prev, hiddenStatCards: hidden };
      save(next);
      return next;
    });
  }, []);

  const setShowTodayApts = useCallback((show: boolean) => {
    update({ showTodayApts: show });
  }, [update]);

  const setDefaultTab = useCallback((tab: string) => {
    update({ defaultTab: tab });
  }, [update]);

  return { prefs, toggleTab, toggleStatCard, setShowTodayApts, setDefaultTab };
}
