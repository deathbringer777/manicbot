"use client";

import { useState } from "react";
import {
  LayoutGrid, CalendarDays, Scissors, UserRound, Users,
  Wallet, MessageSquare, BarChart3, Star, Globe, Megaphone,
  Eye, ChevronDown, GripVertical, Pin, PinOff,
  AlertCircle, CreditCard, Puzzle,
  type LucideIcon,
} from "lucide-react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLang } from "~/components/LangContext";
import { useRole } from "~/components/RoleContext";
import { t, type Lang } from "~/lib/i18n";
import { tNav } from "~/lib/nav/navLabels";
import { applyTabPrefs, useDashboardPrefs, MAX_PINNED_TABS } from "~/lib/useDashboardPrefs";

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
  { tab: "marketing",      icon: Megaphone,     navKey: "Marketing" },
];

const TAB_BY_ID = new Map(TOGGLEABLE_TABS.map((t) => [t.tab, t]));

function tabLabel(navKey: string, lang: Lang): string {
  return tNav(navKey, lang);
}

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

interface RowProps {
  id: string;
  visible: boolean;
  pinned: boolean;
  canPin: boolean;
  label: string;
  Icon: LucideIcon;
  onToggle: () => void;
  onPin: () => void;
  pinLabel: string;
  unpinLabel: string;
}

function SortableRow({ id, visible, pinned, canPin, label, Icon, onToggle, onPin, pinLabel, unpinLabel }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-2 py-2.5 rounded-xl border transition-colors ${
        pinned
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-transparent hover:bg-slate-50 dark:hover:bg-white/[0.02]"
      }`}
    >
      <button
        type="button"
        aria-label="Drag handle"
        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 touch-none px-1"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className={`h-4 w-4 shrink-0 transition-colors ${visible ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}`} />
      <span className={`text-sm flex-1 transition-colors ${visible ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
        {label}
      </span>
      <button
        type="button"
        onClick={onPin}
        disabled={!pinned && !canPin}
        title={pinned ? unpinLabel : pinLabel}
        className={`p-1.5 rounded-lg transition-colors ${
          pinned
            ? "text-amber-500 hover:bg-amber-500/10"
            : canPin
              ? "text-slate-400 hover:text-amber-500 hover:bg-amber-500/10"
              : "text-slate-300 dark:text-slate-700 cursor-not-allowed"
        }`}
      >
        {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
      <Toggle on={visible} onToggle={onToggle} />
    </div>
  );
}

export function AppearanceSection() {
  const { lang } = useLang();
  const { role, previewRole } = useRole();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const { prefs, toggleTab, toggleStatCard, togglePin, setTabOrder, setShowTodayApts, setDefaultTab } = useDashboardPrefs();
  const [pinToastVisible, setPinToastVisible] = useState(false);

  const isSalonOwner = effectiveRole === "tenant_owner" || effectiveRole === "system_admin" || effectiveRole === "tenant_manager";

  if (!isSalonOwner) {
    return (
      <div className="glass-card rounded-2xl p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("common.noData", lang)}
        </p>
      </div>
    );
  }

  // Build the row list in the user's current order. We keep hidden rows in the
  // editor so the user can re-enable them; applyTabPrefs(applyHidden=false)
  // gives us the right order without filtering.
  const orderedIds = applyTabPrefs(
    TOGGLEABLE_TABS.map((t) => t.tab),
    prefs,
    { applyHidden: false },
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = orderedIds;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    setTabOrder(next);
  }

  const visibleTabs = [
    { tab: "overview", label: tNav("Dashboard", lang) },
    ...orderedIds
      .filter((id) => !prefs.hiddenTabs.includes(id))
      .map((id) => {
        const def = TAB_BY_ID.get(id);
        return def ? { tab: def.tab, label: tabLabel(def.navKey, lang) } : null;
      })
      .filter((x): x is { tab: string; label: string } => x !== null),
  ];

  return (
    <div className="space-y-4">
      {/* Pin toast */}
      {pinToastVisible && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-slate-900 dark:bg-slate-100 px-4 py-2.5 text-sm text-white dark:text-slate-900 shadow-xl">
          {t("settings.pinMaxToast", lang)}
        </div>
      )}

      {/* ── Sidebar Tabs (DnD + pin) ── */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <LayoutGrid className="w-4 h-4 text-brand-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t("settings.sidebarTabs", lang)}
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
          {t("settings.sidebarTabsDesc", lang)}
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
          <GripVertical className="h-3 w-3" />
          {t("settings.dragHint", lang)} · {t("settings.pinUpToFive", lang)}
        </p>

        {/* Dashboard — always visible, not in DnD context */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.02] mb-1">
          <LayoutGrid className="h-4 w-4 text-slate-400 shrink-0" />
          <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">
            {tNav("Dashboard", lang)}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
            {t("settings.alwaysVisible", lang)}
          </span>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {orderedIds.map((id) => {
                const def = TAB_BY_ID.get(id);
                if (!def) return null;
                const visible = !prefs.hiddenTabs.includes(def.tab);
                const pinned = prefs.pinnedTabs.includes(def.tab);
                const canPin = !pinned && prefs.pinnedTabs.length < MAX_PINNED_TABS;
                return (
                  <SortableRow
                    key={def.tab}
                    id={def.tab}
                    visible={visible}
                    pinned={pinned}
                    canPin={canPin}
                    Icon={def.icon}
                    label={tabLabel(def.navKey, lang)}
                    pinLabel={t("settings.pin", lang)}
                    unpinLabel={t("settings.unpin", lang)}
                    onToggle={() => toggleTab(def.tab)}
                    onPin={() => {
                      const result = togglePin(def.tab);
                      if (result.capped) {
                        setPinToastVisible(true);
                        setTimeout(() => setPinToastVisible(false), 2400);
                      }
                    }}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {/* Plugins — always at the bottom, not in DnD context */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.02] mt-1">
          <Puzzle className="h-4 w-4 text-slate-400 shrink-0" />
          <span className="text-sm text-slate-700 dark:text-slate-300 flex-1">
            {tNav("Plugins", lang)}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
            {t("settings.pluginsAlwaysBottom", lang)}
          </span>
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
