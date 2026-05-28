"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import {
  LayoutGrid, CalendarDays, Scissors, UserRound, Users,
  Wallet, MessageSquare, BarChart3, Star, Globe,
  Eye, ChevronDown, ChevronUp, GripVertical, Smartphone, Pin, RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { useLang } from "~/components/LangContext";
import { useRole } from "~/components/RoleContext";
import { t, type Lang } from "~/lib/i18n";
import { tNav } from "~/lib/nav/navLabels";
import { useDashboardPrefs, BOTTOM_NAV_LIMIT } from "~/lib/useDashboardPrefs";
import { useNavItems, type NavItem } from "~/lib/nav/useNavItems";
import { Switch } from "~/components/ui/Switch";
import { CollapsibleSection } from "~/components/settings/CollapsibleSection";

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

export function AppearanceSection() {
  const { lang } = useLang();
  const { role, previewRole } = useRole();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const { prefs, toggleTab, setShowTodayApts, setDefaultTab, setBottomNav, resetBottomNav } = useDashboardPrefs();
  const { flat: flatNav, settings: settingsNavItem } = useNavItems();

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
                <Switch
                  checked={visible}
                  onChange={() => toggleTab(tab)}
                  aria-label={tabLabel(navKey, lang)}
                />
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
          {/* Today's appointments list */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
            <CalendarDays className={`h-4 w-4 shrink-0 transition-colors ${prefs.showTodayApts ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}`} />
            <span className={`text-sm flex-1 transition-colors ${prefs.showTodayApts ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
              {t("settings.todayAptsList", lang)}
            </span>
            <Switch
              checked={prefs.showTodayApts}
              onChange={setShowTodayApts}
              aria-label={t("settings.todayAptsList", lang)}
            />
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

      {/* ── Bottom Nav (Mobile / iPad) ── */}
      <BottomNavSection
        lang={lang}
        flatNav={flatNav}
        settingsNavItem={settingsNavItem}
        prefs={prefs}
        setBottomNav={setBottomNav}
        resetBottomNav={resetBottomNav}
      />
    </div>
  );
}

// ── Bottom Nav customisation section ─────────────────────────────────
// Per user spec: toggle visibility + drag-to-reorder, hard cap 5
// (Settings always pinned separately as a non-removable row).
//
// Implementation choice: pointer-event drag (no external dnd library).
// Up/down arrow buttons cover keyboard + touch users; long-press +
// pointer-move covers the drag affordance. Both routes lead to the
// same `applyOrder` setter so behavior is consistent.

interface BottomNavSectionProps {
  lang: Lang;
  flatNav: NavItem[];
  settingsNavItem: NavItem;
  prefs: { bottomNavOrder: string[]; bottomNavLayout: "default" | "custom" };
  setBottomNav: (order: string[]) => void;
  resetBottomNav: () => void;
}

function BottomNavSection({
  lang,
  flatNav,
  settingsNavItem,
  prefs,
  setBottomNav,
  resetBottomNav,
}: BottomNavSectionProps) {
  // Filter out the settings item — it's pinned separately and shown as a
  // locked row at the top of the list (the user cannot remove it without
  // losing access to this very settings panel on mobile).
  const candidateNav = useMemo(
    () => flatNav.filter((n) => n.href !== settingsNavItem.href),
    [flatNav, settingsNavItem.href],
  );

  // Build the local "ordered + which-are-included" view from prefs.
  // - `included`: ordered list of hrefs the user wants in the bar (max
  //   BOTTOM_NAV_LIMIT - 1, because Settings always claims slot #5).
  // - `excluded`: the rest, in their natural role order so the user can
  //   re-add them with a click.
  const { included, excluded } = useMemo(() => {
    if (prefs.bottomNavLayout === "custom" && prefs.bottomNavOrder.length > 0) {
      const byHref = new Map(candidateNav.map((n) => [n.href, n]));
      const inc: NavItem[] = [];
      const seen = new Set<string>();
      for (const href of prefs.bottomNavOrder) {
        if (href === settingsNavItem.href) continue;
        if (seen.has(href)) continue;
        const item = byHref.get(href);
        if (!item) continue;
        seen.add(href);
        inc.push(item);
      }
      const exc = candidateNav.filter((n) => !seen.has(n.href));
      return { included: inc, excluded: exc };
    }
    // Default fallback: first 4 nav items are "included" (matches the
    // legacy slice), the rest are "excluded".
    return {
      included: candidateNav.slice(0, BOTTOM_NAV_LIMIT - 1),
      excluded: candidateNav.slice(BOTTOM_NAV_LIMIT - 1),
    };
  }, [candidateNav, prefs.bottomNavLayout, prefs.bottomNavOrder, settingsNavItem.href]);

  // Hard cap for "included" excluding Settings.
  const PICK_CAP = BOTTOM_NAV_LIMIT - 1;
  const atCapacity = included.length >= PICK_CAP;

  function applyOrder(next: NavItem[]) {
    setBottomNav(next.map((n) => n.href));
  }

  function toggleInclude(href: string) {
    const isIncluded = included.some((n) => n.href === href);
    if (isIncluded) {
      applyOrder(included.filter((n) => n.href !== href));
      return;
    }
    const item = candidateNav.find((n) => n.href === href);
    if (!item) return;
    // FIFO behaviour at cap — drop the oldest entry to make room for
    // the new selection, matching the warning text in the i18n key.
    const next = atCapacity ? [...included.slice(1), item] : [...included, item];
    applyOrder(next);
  }

  function moveUp(index: number) {
    if (index <= 0) return;
    const next = [...included];
    const tmp = next[index - 1];
    next[index - 1] = next[index]!;
    next[index] = tmp!;
    applyOrder(next);
  }

  function moveDown(index: number) {
    if (index >= included.length - 1) return;
    const next = [...included];
    const tmp = next[index + 1];
    next[index + 1] = next[index]!;
    next[index] = tmp!;
    applyOrder(next);
  }

  // Pointer-drag reordering (no external dep). On pointer-down on the
  // grip handle, we track the source index + current Y. On pointer-move
  // we resolve the target index via `data-bottom-nav-index` on the
  // row under the pointer and reorder in place if it changed.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dragIndex == null) return;
    function endDrag() {
      setDragIndex(null);
    }
    function onMove(e: PointerEvent) {
      if (dragIndex == null) return;
      const root = containerRef.current;
      if (!root) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const row = el?.closest("[data-bottom-nav-index]") as HTMLElement | null;
      if (!row || !root.contains(row)) return;
      const target = Number(row.dataset.bottomNavIndex);
      if (!Number.isFinite(target) || target === dragIndex) return;
      const next = [...included];
      const [moved] = next.splice(dragIndex, 1);
      if (!moved) return;
      next.splice(target, 0, moved);
      setDragIndex(target);
      applyOrder(next);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
    };
  }, [dragIndex, included, applyOrder]);

  // Live preview row — what the bar will actually look like.
  const previewItems: NavItem[] = [...included, settingsNavItem];

  return (
    <section className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Smartphone className="w-4 h-4 text-fuchsia-400 shrink-0" />
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
          {t("settings.bottomNav", lang)}
        </h2>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        {t("settings.bottomNavDesc", lang)}
      </p>

      {/* Live preview of the bottom bar */}
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
          {t("settings.bottomNavPreview", lang)}
        </p>
        <div
          data-testid="bottom-nav-preview"
          className="flex items-center justify-around rounded-2xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-slate-950/70 px-1 py-1.5 shadow-inner"
        >
          {previewItems.map((item) => (
            <div
              key={item.href}
              className="flex flex-1 flex-col items-center gap-0.5 px-1 py-1 text-center text-[10px] font-medium text-slate-500 dark:text-slate-400"
            >
              <item.icon className="h-4 w-4" />
              <span className="truncate text-[9px]">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Counter + reset */}
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span data-testid="bottom-nav-counter">
          {t("settings.bottomNavCounter", lang)
            .replace("{n}", String(previewItems.length))
            .replace("{max}", String(BOTTOM_NAV_LIMIT))}
        </span>
        <button
          type="button"
          onClick={resetBottomNav}
          data-testid="bottom-nav-reset"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.04]"
        >
          <RotateCcw className="h-3 w-3" />
          {t("settings.bottomNavReset", lang)}
        </button>
      </div>

      {/* Settings (locked at the end of the bar) */}
      <div className="mb-2 flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] px-3 py-2.5">
        <Pin className="h-4 w-4 text-amber-400 shrink-0" />
        <settingsNavItem.icon className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {settingsNavItem.label}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">
          {t("settings.bottomNavSettingsLocked", lang)}
        </span>
      </div>

      {/* Included list — drag handle + up/down + remove toggle */}
      <div
        ref={containerRef}
        data-testid="bottom-nav-included"
        className="space-y-1"
      >
        {included.map((item, i) => (
          <div
            key={item.href}
            data-bottom-nav-index={i}
            data-bottom-nav-href={item.href}
            data-dragging={dragIndex === i ? "1" : "0"}
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors ${
              dragIndex === i
                ? "border-brand-500/60 bg-brand-500/10"
                : "border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
            }`}
          >
            <button
              type="button"
              data-testid="bottom-nav-grip"
              onPointerDown={(e) => {
                e.preventDefault();
                setDragIndex(i);
              }}
              className="flex h-8 w-8 cursor-grab items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-white/[0.04] touch-none"
              aria-label="Reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <item.icon className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
            <span className="flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
              {item.label}
            </span>
            <button
              type="button"
              onClick={() => moveUp(i)}
              disabled={i === 0}
              aria-label={t("settings.bottomNavMoveUp", lang)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 dark:hover:bg-white/[0.04]"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => moveDown(i)}
              disabled={i === included.length - 1}
              aria-label={t("settings.bottomNavMoveDown", lang)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 dark:hover:bg-white/[0.04]"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <Switch
              checked={true}
              onChange={() => toggleInclude(item.href)}
              aria-label={item.label}
            />
          </div>
        ))}
      </div>

      {/* Excluded list — single-click to add */}
      {excluded.length > 0 && (
        <div className="mt-3 space-y-1" data-testid="bottom-nav-excluded">
          {atCapacity && (
            <p className="text-[10px] font-medium text-amber-500 dark:text-amber-400 mb-1.5">
              {t("settings.bottomNavCapWarn", lang)}
            </p>
          )}
          {excluded.map((item) => (
            <div
              key={item.href}
              data-bottom-nav-href={item.href}
              className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-2.5 py-2 dark:border-white/10"
            >
              <div className="h-8 w-8 shrink-0" aria-hidden="true" />
              <item.icon className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
              <span className="flex-1 truncate text-sm text-slate-400 dark:text-slate-500">
                {item.label}
              </span>
              <Switch
                checked={false}
                onChange={() => toggleInclude(item.href)}
                aria-label={item.label}
              />
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
        {t("settings.bottomNavCap", lang)}
      </p>
    </section>
  );
}
