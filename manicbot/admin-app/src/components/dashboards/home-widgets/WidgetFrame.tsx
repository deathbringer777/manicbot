"use client";

/**
 * WidgetFrame — the chrome around a single board widget.
 *
 * The header (widget icon + title) doubles as the react-grid-layout DRAG HANDLE
 * via the shared `WIDGET_DRAG_HANDLE` class wired into the board's
 * `draggableHandle`, so a widget only moves when grabbed by its title bar (the
 * body stays interactive — clicking a quick-action button never starts a drag).
 * In edit mode the header also shows a remove (×) button; outside edit mode the
 * header is a plain, non-draggable label.
 *
 * The frame fills its grid cell (`h-full`) and the widget body scrolls inside,
 * so resizing a cell never spills content past its borders.
 */

import { X } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { WIDGET_REGISTRY, resolveWidgetOpts, type HomeWidgetItem } from "./registry";

/**
 * Grab-handle class. RGL's `draggableHandle` is matched with
 * `target.closest(selector)`, so anything inside the header is a valid grab
 * point while the body is not.
 */
export const WIDGET_DRAG_HANDLE = "home-widget-drag-handle";

export function WidgetFrame({
  item,
  tenantId,
  lang,
  editMode,
  onRemove,
}: {
  item: HomeWidgetItem;
  tenantId: string;
  lang: Lang;
  editMode: boolean;
  onRemove: (i: string) => void;
}) {
  const def = WIDGET_REGISTRY[item.type];
  if (!def) return null;

  const Icon = def.icon;
  const Body = def.Component;
  const opts = resolveWidgetOpts(item.type, item);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white dark:border-white/[0.06] dark:bg-slate-800">
      <div
        className={`${WIDGET_DRAG_HANDLE} flex shrink-0 items-center gap-2 border-b border-[#f3f4f6] px-3 py-2 dark:border-white/[0.04] ${
          editMode ? "cursor-move select-none" : ""
        }`}
      >
        <Icon className="h-4 w-4 shrink-0 text-[#9ca3af] dark:text-slate-500" />
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1a1a2e] dark:text-white">
          {t(def.titleKey, lang)}
        </h3>
        {editMode && (
          <button
            type="button"
            // Stop the pointer-down from reaching the drag handle so clicking ×
            // removes the widget instead of starting a drag.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.i);
            }}
            aria-label={t("home.remove", lang)}
            title={t("home.remove", lang)}
            className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#9ca3af] transition-colors hover:bg-red-500/10 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <Body item={item} opts={opts} tenantId={tenantId} lang={lang} editMode={editMode} />
      </div>
    </div>
  );
}
