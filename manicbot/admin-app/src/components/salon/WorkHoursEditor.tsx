"use client";

/**
 * WorkHoursEditor — per-weekday salon schedule editor.
 *
 * Renders one row per weekday (Mon..Sun): a brand Switch ("working day" /
 * "day off") plus two brand Select dropdowns for open / close time at 30-minute
 * granularity. Toggling a day off stores `null`; toggling it back on restores a
 * sensible default (09:00–18:00).
 *
 * State is the shared `WorkHoursState` from `~/lib/workHours`, so the parent can
 * `hydrateWorkHours(profile.salon.workHours)` to load and `serializeWorkHours()`
 * to persist via `salon.updateSalonProfile({ workHours })`. The public salon
 * page and the dashboard summary already decode this same shape.
 *
 * Controlled: owns no internal copy of the value — `onChange` returns the full
 * next state so the parent stays the single source of truth.
 */

import { Select } from "~/components/ui/Select";
import { Switch } from "~/components/ui/Switch";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { WEEKDAY_KEYS, type WorkHoursState, type DayHours, type WeekdayKey } from "~/lib/workHours";
import { optionsWith } from "~/lib/timeOptions";

/** Restored when a day is switched from "off" back to "working". */
const DEFAULT_DAY = { open: "09:00", close: "18:00" } as const;

export interface WorkHoursEditorProps {
  value: WorkHoursState;
  onChange: (next: WorkHoursState) => void;
  disabled?: boolean;
}

export function WorkHoursEditor({ value, onChange, disabled = false }: WorkHoursEditorProps) {
  const { lang } = useLang();

  function setDay(day: WeekdayKey, next: DayHours) {
    onChange({ ...value, [day]: next });
  }

  return (
    <div className="space-y-2" data-testid="work-hours-editor">
      {WEEKDAY_KEYS.map((day) => {
        const slot = value[day];
        const invalid = slot !== null && slot.close <= slot.open;
        return (
          <div
            key={day}
            data-testid={`workhours-row-${day}`}
            className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
          >
            <span className="w-24 shrink-0 text-xs font-medium text-slate-700 dark:text-slate-300">
              {t(`salon.publicProfile.day.${day}`, lang)}
            </span>
            <Switch
              size="sm"
              checked={slot !== null}
              disabled={disabled}
              onChange={(next) => setDay(day, next ? { ...DEFAULT_DAY } : null)}
              aria-label={t("salon.publicProfile.workingDay", lang)}
              data-testid={`workhours-toggle-${day}`}
            />
            {slot === null ? (
              <span className="flex-1 text-xs italic text-slate-500 dark:text-slate-400">
                {t("salon.publicProfile.dayOff", lang)}
              </span>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Select
                  className="flex-1 min-w-0"
                  value={slot.open}
                  onChange={(v) => setDay(day, { open: v, close: slot.close })}
                  options={optionsWith(slot.open)}
                  disabled={disabled}
                  testIdPrefix={`workhours-open-${day}`}
                />
                <span className="shrink-0 text-xs text-slate-500">—</span>
                <Select
                  className="flex-1 min-w-0"
                  value={slot.close}
                  onChange={(v) => setDay(day, { open: slot.open, close: v })}
                  options={optionsWith(slot.close)}
                  disabled={disabled}
                  testIdPrefix={`workhours-close-${day}`}
                />
              </div>
            )}
            {invalid && (
              <span className="w-full pl-24 text-[11px] text-amber-500">
                {t("salon.chip.hoursInvalid", lang)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
