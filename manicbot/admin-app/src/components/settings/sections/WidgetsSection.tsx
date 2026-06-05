"use client";

/**
 * Settings → Виджеты.
 *
 * Configures the salon "Домой" (overview) widget board WITHOUT drag/resize:
 * one row per catalog widget with an enable toggle and a `Select` per
 * dropdown-configurable option (period / view / limit). It edits the SAME
 * `prefs.homeWidgets` state the board's edit-mode mutates — single source of
 * truth (see `useDashboardPrefs`). An empty `homeWidgets` means the board shows
 * `DEFAULT_HOME_LAYOUT`, so we hydrate it here to reflect first-run defaults as
 * "on".
 */
import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "~/components/LangContext";
import { useRole } from "~/components/RoleContext";
import { t } from "~/lib/i18n";
import { useDashboardPrefs, hydrateHomeLayout } from "~/lib/useDashboardPrefs";
import { Switch } from "~/components/ui/Switch";
import { Select } from "~/components/ui/Select";
import {
  HOME_WIDGET_TYPES,
  WIDGET_REGISTRY,
  resolveWidgetOpts,
  widgetAllowedForRole,
  type HomeWidgetItem,
  type HomeWidgetType,
} from "~/components/dashboards/home-widgets/registry";

export function WidgetsSection() {
  const { lang } = useLang();
  const { role } = useRole();
  const {
    prefs,
    addHomeWidget,
    removeHomeWidget,
    setHomeWidgetOpts,
    resetHomeWidgets,
  } = useDashboardPrefs();

  // Effective layout: empty prefs ⇒ DEFAULT_HOME_LAYOUT, role-forbidden widgets
  // dropped. This is what the board actually renders, so the toggles below
  // mirror the board exactly (including first-run defaults shown as "on").
  const enabledItems = useMemo(
    () => hydrateHomeLayout(prefs.homeWidgets, role),
    [prefs.homeWidgets, role],
  );
  const itemByType = useMemo(() => {
    const map = new Map<HomeWidgetType, HomeWidgetItem>();
    for (const it of enabledItems) map.set(it.type, it);
    return map;
  }, [enabledItems]);

  // Catalog rows the current role may use, in registry (menu) order.
  const rows = HOME_WIDGET_TYPES.filter((type) =>
    widgetAllowedForRole(WIDGET_REGISTRY[type], role),
  );

  function handleToggle(type: HomeWidgetType, next: boolean) {
    // v1 widgets are singletons, so the grid key `i` equals the type.
    if (next) addHomeWidget(type);
    else removeHomeWidget(type);
  }

  function handleReset() {
    resetHomeWidgets();
    toast.success(t("settings.widgets.resetDone", lang));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t("settings.widgets.title", lang)}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t("settings.widgets.desc", lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            data-testid="widgets-reset"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.04]"
          >
            <RotateCcw className="h-3 w-3" />
            {t("settings.widgets.reset", lang)}
          </button>
        </div>
      </div>

      {/* One configurable row per widget */}
      <div className="glass-card rounded-2xl p-2">
        <div className="space-y-1">
          {rows.map((type) => {
            const def = WIDGET_REGISTRY[type];
            const Icon = def.icon;
            const item = itemByType.get(type);
            const enabled = item != null;
            const opts = resolveWidgetOpts(type, item);

            return (
              <div
                key={type}
                data-testid={`widget-row-${type}`}
                className="rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      enabled
                        ? "text-slate-500 dark:text-slate-400"
                        : "text-slate-300 dark:text-slate-600"
                    }`}
                  />
                  <span
                    className={`flex-1 text-sm transition-colors ${
                      enabled
                        ? "text-slate-700 dark:text-slate-300"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {t(def.titleKey, lang)}
                  </span>
                  <Switch
                    checked={enabled}
                    onChange={(next) => handleToggle(type, next)}
                    aria-label={`${t("settings.widgets.show", lang)}: ${t(def.titleKey, lang)}`}
                    data-testid={`widget-toggle-${type}`}
                  />
                </div>

                {/* Per-option dropdowns — disabled when the widget is off. */}
                {def.options && def.options.length > 0 && (
                  <div className="mt-2 grid grid-cols-1 gap-2 pl-7 sm:grid-cols-2">
                    {def.options.map((opt) => (
                      <label key={opt.key} className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {t(opt.labelKey, lang)}
                        </span>
                        <Select
                          value={opts[opt.key] ?? opt.default}
                          onChange={(value) =>
                            setHomeWidgetOpts(type, { [opt.key]: value })
                          }
                          disabled={!enabled}
                          testIdPrefix={`widget-opt-${type}-${opt.key}`}
                          options={opt.choices.map((choice) => ({
                            value: choice.value,
                            label: t(choice.labelKey, lang),
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
