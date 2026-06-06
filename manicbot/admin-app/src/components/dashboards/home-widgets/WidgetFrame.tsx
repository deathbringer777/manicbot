"use client";

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
}: {
  item: HomeWidgetItem;
  tenantId: string;
  lang: Lang;
  editMode: boolean;
}) {
  const def = WIDGET_REGISTRY[item.type];
  if (!def) return null;

  const Icon = def.icon;
  const Body = def.Component;
  const opts = resolveWidgetOpts(item.type, item);

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white dark:border-white/[0.06] dark:bg-slate-800 ${
        editMode ? "widget-wobble" : ""
      }`}
    >
      <div
        className={`${WIDGET_DRAG_HANDLE} flex shrink-0 items-center gap-2 border-b border-[#f3f4f6] px-3 py-2 dark:border-white/[0.04] ${
          editMode ? "cursor-move select-none" : ""
        }`}
      >
        <Icon className="h-4 w-4 shrink-0 text-[#9ca3af] dark:text-slate-500" />
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1a1a2e] dark:text-white">
          {t(def.titleKey, lang)}
        </h3>
      </div>
      <div className="min-h-0 flex-1">
        <Body item={item} opts={opts} tenantId={tenantId} lang={lang} editMode={editMode} />
      </div>
    </div>
  );
}
