"use client";

/**
 * HomeWidgetBoard — the configurable widget grid on the salon "Домой"
 * (overview) tab.
 *
 * Built on react-grid-layout's `WidthProvider(Responsive)`. It is mounted from
 * `SalonDashboard` via `next/dynamic({ ssr: false })` so `WidthProvider` never
 * measures during edge SSR (which would cause a hydration mismatch).
 *
 * State model (single source of truth = `prefs.homeWidgets`):
 *   - render layout  = `hydrateHomeLayout(prefs.homeWidgets, role)` (empty ⇒
 *     `DEFAULT_HOME_LAYOUT`; drops unknown / role-forbidden widgets),
 *   - drag/resize    → `onLayoutChange` merges the new x/y/w/h back into the
 *     items and calls `setHomeWidgets` (the hook debounces persistence),
 *   - add / remove   → `addHomeWidget` / `removeHomeWidget`,
 *   - reset          → `resetHomeWidgets` (back to the default board).
 *
 * Touch: drag/resize is enabled ONLY in edit mode AND only on non-coarse
 * pointers (`useCoarsePointer`), matching how the calendar gates its gestures.
 * On `xs/xxs` the grid collapses to a single column.
 */

import { useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout, type Layouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { LayoutGrid, Check, RotateCcw, X } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useDashboardPrefs, hydrateHomeLayout } from "~/lib/useDashboardPrefs";
import { useCoarsePointer } from "~/lib/useCoarsePointer";
import { Select } from "~/components/ui/Select";
import { t, type Lang } from "~/lib/i18n";
import {
  WIDGET_REGISTRY,
  HOME_WIDGET_TYPES,
  widgetAllowedForRole,
  type HomeWidgetItem,
  type HomeWidgetType,
} from "./registry";
import { WidgetFrame } from "./WidgetFrame";

const ResponsiveGridLayout = WidthProvider(Responsive);

/**
 * Two breakpoints only: a rich 12-column board on any tablet/desktop width
 * (≥768px) and a single-column stack on phones. The earlier 8-/6-column middle
 * bands REUSED the 12-col coordinates, so a widget authored at x≥6 overflowed
 * the narrower grid and RGL reflowed it into a staggered mess. RGL picks the
 * largest breakpoint whose px value is ≤ the measured container width.
 */
const BREAKPOINTS = { lg: 768, xxs: 0 } as const;
const COLS = { lg: 12, xxs: 1 } as const;
const ROW_HEIGHT = 56;
const MARGIN: [number, number] = [16, 16];

/** Map our persisted items to an RGL layout, carrying each widget's min size. */
function toRglLayout(items: HomeWidgetItem[]): Layout[] {
  return items.map((w) => {
    const def = WIDGET_REGISTRY[w.type];
    return {
      i: w.i,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      minW: def?.minSize.w,
      minH: def?.minSize.h,
    };
  });
}

/**
 * Merge an RGL layout (post drag/resize) back into our items by `i`. Items not
 * present in the layout (shouldn't happen) keep their previous geometry.
 */
function mergeLayout(items: HomeWidgetItem[], layout: Layout[]): HomeWidgetItem[] {
  const byId = new Map(layout.map((l) => [l.i, l]));
  return items.map((w) => {
    const l = byId.get(w.i);
    return l ? { ...w, x: l.x, y: l.y, w: l.w, h: l.h } : w;
  });
}

/** Single-column stack (phones): every widget full width, in board order. */
function stackLayout(items: HomeWidgetItem[]): Layout[] {
  let y = 0;
  return items.map((w) => {
    const def = WIDGET_REGISTRY[w.type];
    const placed: Layout = { i: w.i, x: 0, y, w: 1, h: w.h, minW: 1, minH: def?.minSize.h };
    y += w.h;
    return placed;
  });
}

export function HomeWidgetBoard({ tenantId, lang }: { tenantId: string; lang: Lang }) {
  const { role } = useRole();
  const { prefs, setHomeWidgets, addHomeWidget, removeHomeWidget, resetHomeWidgets } =
    useDashboardPrefs();
  const isTouch = useCoarsePointer();
  const [editMode, setEditMode] = useState(false);

  // Effective items to render (empty prefs ⇒ default board; unknown/forbidden
  // widgets dropped). Recomputed when prefs or role change.
  const items = useMemo(
    () => hydrateHomeLayout(prefs.homeWidgets, role),
    [prefs.homeWidgets, role],
  );

  // Drag/resize is live only while editing AND on a precise pointer.
  const interactive = editMode && !isTouch;

  // lg (≥768px) renders the authored 12-col layout (respecting saved drag
  // positions); xxs (phones) gets a clean single-column stack. No in-between
  // band reuses the 12-col coordinates, so widgets never overflow + reflow.
  const layouts: Layouts = useMemo(
    () => ({ lg: toRglLayout(items), xxs: stackLayout(items) }),
    [items],
  );

  // Widget types not yet on the board, grouped for the add-widget dropdown.
  const available = useMemo(() => {
    const present = new Set(items.map((w) => w.type));
    return HOME_WIDGET_TYPES.filter(
      (type) =>
        !present.has(type) &&
        (role == null || widgetAllowedForRole(WIDGET_REGISTRY[type], role)),
    );
  }, [items, role]);

  const addOptions = useMemo(
    () =>
      available.map((type) => ({
        value: type,
        label: t(WIDGET_REGISTRY[type].titleKey, lang),
        sublabel: t(`widget.category.${WIDGET_REGISTRY[type].category}`, lang),
      })),
    [available, lang],
  );

  function handleLayoutChange(current: Layout[], all: Layouts) {
    if (!interactive) return; // ignore RGL's initial settle + non-edit relayouts
    // Persist the authored breakpoint when present; fall back to the current
    // layout RGL reports (e.g. while viewing a collapsed breakpoint).
    const next = all.lg && all.lg.length > 0 ? all.lg : current;
    setHomeWidgets(mergeLayout(items, next));
  }

  function handleAdd(type: string) {
    if (HOME_WIDGET_TYPES.includes(type as HomeWidgetType)) {
      addHomeWidget(type as HomeWidgetType);
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar: edit toggle + (in edit mode) add-widget + reset. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editMode && (
          <>
            <div className="w-52 max-w-full">
              <Select
                value=""
                onChange={handleAdd}
                options={addOptions}
                placeholder={addOptions.length === 0 ? t("home.allAdded", lang) : t("home.addWidget", lang)}
                disabled={addOptions.length === 0}
                testIdPrefix="home-add-widget"
              />
            </div>
            <button
              type="button"
              onClick={() => resetHomeWidgets()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e7eb] px-3 py-2 text-[13px] font-medium text-[#6b7280] transition-colors hover:bg-[#f3f4f6] dark:border-white/[0.08] dark:text-slate-400 dark:hover:bg-white/[0.04]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("home.reset", lang)}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          data-testid="home-edit-toggle"
          data-edit={editMode ? "1" : "0"}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
            editMode
              ? "bg-accent-500 text-white hover:bg-accent-600"
              : "border border-[#e5e7eb] text-[#374151] hover:bg-[#f3f4f6] dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.04]"
          }`}
        >
          {editMode ? <Check className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
          {editMode ? t("home.done", lang) : t("home.customize", lang)}
        </button>
      </div>

      {/* Edit-mode hint: touch users can't drag; desktop users can. */}
      {editMode && (
        <p className="text-right text-[12px] text-[#9ca3af] dark:text-slate-500">
          {isTouch ? t("home.touchHint", lang) : t("home.editHint", lang)}
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e5e7eb] py-12 text-center text-[13px] text-[#6b7280] dark:border-white/[0.08] dark:text-slate-500">
          {t("home.empty", lang)}
        </div>
      ) : (
        <ResponsiveGridLayout
          className="home-widget-board -mx-2"
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          isDraggable={interactive}
          isResizable={interactive}
          compactType="vertical"
          onLayoutChange={handleLayoutChange}
        >
          {items.map((item) => (
            <div
              key={item.i}
              data-widget-type={item.type}
              className={`relative${interactive ? " cursor-grab active:cursor-grabbing" : ""}`}
            >
              <WidgetFrame
                item={item}
                tenantId={tenantId}
                lang={lang}
                editMode={interactive}
              />
              {/* iOS-style delete badge — shown for all edit-mode users (incl. touch) */}
              {editMode && (
                <button
                  type="button"
                  // Stop BOTH pointerdown and mousedown so react-draggable doesn't
                  // interpret a delete-click as the start of a drag gesture.
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeHomeWidget(item.i);
                  }}
                  aria-label={t("home.remove", lang)}
                  title={t("home.remove", lang)}
                  className="absolute -right-2 -top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg ring-2 ring-white transition-transform hover:scale-110 active:scale-95 dark:ring-slate-900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
