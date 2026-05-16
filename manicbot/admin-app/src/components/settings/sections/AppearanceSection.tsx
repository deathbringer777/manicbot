"use client";

import {
  LayoutGrid, CalendarDays, Scissors, UserRound, Users,
  Wallet, MessageSquare, BarChart3, Star, Globe,
  Eye, EyeOff, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useLang } from "~/components/LangContext";
import { useRole } from "~/components/RoleContext";
import { t, type Lang } from "~/lib/i18n";
import { tNav } from "~/lib/nav/navLabels";
import { useDashboardPrefs } from "~/lib/useDashboardPrefs";

/**
 * Sidebar tabs that can be toggled. `navKey` matches the sidebar's tNav key
 * so labels here render identically to what the user sees in the sidebar
 * (avoids "Тариф" vs "Биллинг" / "Обзор" vs "Домой" mismatches).
 */
const TOGGLEABLE_TABS: { tab: string; icon: LucideIcon; navKey: string }[] = [
  { tab: "appointments",   icon: CalendarDays,  navKey: "Appointments" },
  { tab: "services",       icon: Scissors,      navKey: "Services" },
  { tab: "masters",        icon: UserRound,     navKey: "Masters" },
  { tab: "clients",        icon: Users,         navKey: "Clients" },
  { tab: "billing",        icon: Wallet,        navKey: "Billing" },
  { tab: "channels",       icon: MessageSquare, navKey: "Channels" },
  { tab: "analytics",      icon: BarChart3,     navKey: "Analytics" },
  { tab: "reviews",        icon: Star,          navKey: "Reviews" },
  { tab: "public_profile", icon: Globe,         navKey: "PublicProfile" },
];

function tabLabel(navKey: string, lang: Lang): string {
  return tNav(navKey, lang);
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
        on ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function AppearanceSection() {
  const { lang } = useLang();
  const { role, previewRole } = useRole();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const { prefs, toggleTab, setShowTodayApts, setDefaultTab } = useDashboardPrefs();

  const isSalonOwner = effectiveRole === "tenant_owner" || effectiveRole === "system_admin";

  if (!isSalonOwner) {
    return (
      <div className="glass-card rounded-2xl p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("common.noData", lang)}
        </p>
      </div>
    );
  }

  // Visible tabs for default-tab selector (overview + non-hidden).
  // Use sidebar nav labels (tNav) so the chips here match the sidebar exactly.
  const visibleTabs = [
    { tab: "overview", label: tNav("Dashboard", lang) },
    ...TOGGLEABLE_TABS
      .filter((tb) => !prefs.hiddenTabs.includes(tb.tab))
      .map((tb) => ({ tab: tb.tab, label: tabLabel(tb.navKey, lang) })),
  ];

  return (
    <div className="space-y-4">
      {/* ── Sidebar Tabs ── */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <LayoutGrid className="w-4 h-4 text-brand-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t("settings.sidebarTabs", lang)}
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {t("settings.sidebarTabsDesc", lang)}
        </p>

        <div className="space-y-1">
          {/* Dashboard (overview) — always visible */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.02]">
            <LayoutGrid className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">
              {tNav("Dashboard", lang)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              {t("settings.alwaysVisible", lang)}
            </span>
          </div>

          {TOGGLEABLE_TABS.map(({ tab, icon: Icon, navKey }) => {
            const visible = !prefs.hiddenTabs.includes(tab);
            return (
              <div
                key={tab}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
              >
                <Icon className={`h-4 w-4 shrink-0 transition-colors ${visible ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}`} />
                <span className={`text-sm flex-1 transition-colors ${visible ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
                  {tabLabel(navKey, lang)}
                </span>
                <Toggle on={visible} onToggle={() => toggleTab(tab)} />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Overview Widgets ── */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Eye className="w-4 h-4 text-sky-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t("settings.overviewWidgets", lang)}
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {t("settings.overviewWidgetsDesc", lang)}
        </p>

        <div className="space-y-1">
          {/* Today's appointments list */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
            <CalendarDays className={`h-4 w-4 shrink-0 transition-colors ${prefs.showTodayApts ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}`} />
            <span className={`text-sm flex-1 transition-colors ${prefs.showTodayApts ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
              {t("settings.todayAptsList", lang)}
            </span>
            <Toggle on={prefs.showTodayApts} onToggle={() => setShowTodayApts(!prefs.showTodayApts)} />
          </div>
        </div>
      </section>

      {/* ── Default Tab ── */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <ChevronDown className="w-4 h-4 text-violet-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t("settings.defaultTab", lang)}
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {t("settings.defaultTabDesc", lang)}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {visibleTabs.map(({ tab, label }) => (
            <button
              key={tab}
              type="button"
              onClick={() => setDefaultTab(tab)}
              className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-all border ${
                prefs.defaultTab === tab
                  ? "bg-brand-500/10 border-brand-500/40 text-brand-600 dark:text-brand-300"
                  : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
