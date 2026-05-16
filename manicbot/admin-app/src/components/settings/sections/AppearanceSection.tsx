"use client";

import { useId, useState, type ReactNode } from "react";
import {
  LayoutGrid, CalendarDays, Scissors, UserRound, Users,
  Wallet, MessageSquare, BarChart3, Star, Globe,
  Eye, ChevronDown,
  AlertCircle, CreditCard,
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
 * (avoids "Тариф" vs "Биллинг" / "Обзор" vs "Дашборд" mismatches).
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

/** Overview stat cards that can be toggled. */
const STAT_CARDS: { key: string; labelKey: string; icon: LucideIcon }[] = [
  { key: "todayAppointments", labelKey: "settings.statTodayApts",     icon: CalendarDays },
  { key: "activeMasters",     labelKey: "settings.statActiveMasters", icon: UserRound },
  { key: "openTickets",       labelKey: "settings.statOpenTickets",   icon: AlertCircle },
  { key: "billingPlan",       labelKey: "settings.statBillingPlan",   icon: CreditCard },
];

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

interface CollapsibleSectionProps {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  desc: string;
  children: ReactNode;
}

function CollapsibleSection({ icon: Icon, iconClass, title, desc, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="glass-card rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full text-left p-4 flex items-start gap-2 rounded-2xl hover:bg-slate-50/60 dark:hover:bg-white/[0.02] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconClass}`} />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 shrink-0 mt-0.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={bodyId} className="px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}

export function AppearanceSection() {
  const { lang } = useLang();
  const { role, previewRole } = useRole();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const { prefs, toggleTab, toggleStatCard, setShowTodayApts, setDefaultTab } = useDashboardPrefs();

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
  // Use sidebar nav labels (tNav) so the options here match the sidebar exactly.
  const visibleTabs = [
    { tab: "overview", label: tNav("Dashboard", lang) },
    ...TOGGLEABLE_TABS
      .filter((tb) => !prefs.hiddenTabs.includes(tb.tab))
      .map((tb) => ({ tab: tb.tab, label: tabLabel(tb.navKey, lang) })),
  ];

  return (
    <div className="space-y-4">
      {/* ── Sidebar Tabs ── */}
      <CollapsibleSection
        icon={LayoutGrid}
        iconClass="text-brand-400"
        title={t("settings.sidebarTabs", lang)}
        desc={t("settings.sidebarTabsDesc", lang)}
      >
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
      </CollapsibleSection>

      {/* ── Overview Widgets ── */}
      <CollapsibleSection
        icon={Eye}
        iconClass="text-sky-400"
        title={t("settings.overviewWidgets", lang)}
        desc={t("settings.overviewWidgetsDesc", lang)}
      >
        <div className="space-y-1">
          {STAT_CARDS.map(({ key, labelKey, icon: Icon }) => {
            const visible = !prefs.hiddenStatCards.includes(key);
            return (
              <div
                key={key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
              >
                <Icon className={`h-4 w-4 shrink-0 transition-colors ${visible ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}`} />
                <span className={`text-sm flex-1 transition-colors ${visible ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
                  {t(labelKey as any, lang)}
                </span>
                <Toggle on={visible} onToggle={() => toggleStatCard(key)} />
              </div>
            );
          })}

          {/* Today's appointments list */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
            <CalendarDays className={`h-4 w-4 shrink-0 transition-colors ${prefs.showTodayApts ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}`} />
            <span className={`text-sm flex-1 transition-colors ${prefs.showTodayApts ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
              {t("settings.todayAptsList", lang)}
            </span>
            <Toggle on={prefs.showTodayApts} onToggle={() => setShowTodayApts(!prefs.showTodayApts)} />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Default Tab ── */}
      <CollapsibleSection
        icon={ChevronDown}
        iconClass="text-violet-400"
        title={t("settings.defaultTab", lang)}
        desc={t("settings.defaultTabDesc", lang)}
      >
        <select
          value={prefs.defaultTab}
          onChange={(e) => setDefaultTab(e.target.value)}
          className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">{t("settings.defaultTabNotSelected", lang)}</option>
          {visibleTabs.map(({ tab, label }) => (
            <option key={tab} value={tab}>{label}</option>
          ))}
        </select>
      </CollapsibleSection>
    </div>
  );
}
