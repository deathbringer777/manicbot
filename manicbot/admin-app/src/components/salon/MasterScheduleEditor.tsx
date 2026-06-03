"use client";

/**
 * MasterScheduleEditor — per-master weekly booking schedule.
 *
 * One row per weekday (Mon..Sun): a brand Switch ("working day" / "day off"),
 * open/close time Selects at 30-minute granularity, and ONE optional break
 * (перерыв) per day on a wrapping sub-line. Mirrors the salon WorkHoursEditor
 * so both surfaces feel identical, but stores the richer per-master shape the
 * Worker booking engine reads:
 *   masters.work_hours = {"days":{"mon":{"open","close","break":{"start","end"}}, …, "sun":null}}
 *   masters.work_days  = derived 0..6 array (kept in sync server-side)
 *
 * Owns its draft state (uncontrolled) and emits the serialized `{days}` string
 * via `onSave` on Save — the caller persists it through salon.updateMaster /
 * master.updateWorkHours (input field `workSchedule`). Legacy `{from,to}` rows
 * hydrate transparently (see ~/lib/workHours → hydrateMasterSchedule).
 *
 * `disabled` (with optional `notice`) renders read-only — used on the master
 * dashboard under the `salon_only` policy. `saveLabel` overrides the button
 * text (e.g. "Send for approval" under `master_approval`).
 */
import { useMemo, useState } from "react";
import { Loader2, Save, Plus, X } from "lucide-react";
import { t, type Lang, type TranslationKey } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";
import { Switch } from "~/components/ui/Switch";
import { optionsWith } from "~/lib/timeOptions";
import {
  WEEKDAY_KEYS,
  hydrateMasterSchedule,
  serializeMasterSchedule,
  validateMasterSchedule,
  type MasterScheduleState,
  type MasterDaySchedule,
  type WeekdayKey,
} from "~/lib/workHours";

const DAY_LABEL_KEY: Record<WeekdayKey, TranslationKey> = {
  mon: "salon.publicProfile.day.mon",
  tue: "salon.publicProfile.day.tue",
  wed: "salon.publicProfile.day.wed",
  thu: "salon.publicProfile.day.thu",
  fri: "salon.publicProfile.day.fri",
  sat: "salon.publicProfile.day.sat",
  sun: "salon.publicProfile.day.sun",
};

/** Restored when a day is switched from "off" back to "working". */
const DEFAULT_DAY = { open: "09:00", close: "18:00" } as const;
/** Seeded when a break is first added to a day. */
const DEFAULT_BREAK = { start: "13:00", end: "14:00" } as const;

export interface MasterScheduleEditorProps {
  /** Raw stored value — per-day JSON string/object, legacy `{from,to}`, or null. */
  workHours: unknown;
  /** Raw stored value — JSON string, number[], or null (legacy hydration only). */
  workDays: unknown;
  saving: boolean;
  saved?: boolean;
  /** Read-only mode (e.g. salon_only policy) — inputs + Save are disabled/hidden. */
  disabled?: boolean;
  /** Banner shown above the editor (e.g. "Working hours are set by the salon"). */
  notice?: string | null;
  /** Overrides the Save button label (e.g. "Send for approval"). */
  saveLabel?: string;
  lang: Lang;
  /** Receives the serialized per-day `{"days":{…}}` schedule string. */
  onSave: (workSchedule: string) => void;
  testIdPrefix?: string;
}

export function MasterScheduleEditor({
  workHours,
  workDays,
  saving,
  saved = false,
  disabled = false,
  notice = null,
  saveLabel,
  lang,
  onSave,
  testIdPrefix = "master-schedule",
}: MasterScheduleEditorProps) {
  const initial = useMemo(
    () => hydrateMasterSchedule(workHours, workDays),
    [workHours, workDays],
  );
  const [state, setState] = useState<MasterScheduleState>(initial);
  const [error, setError] = useState<string | null>(null);

  const setDay = (day: WeekdayKey, next: MasterDaySchedule) => {
    if (disabled) return;
    setState((prev) => ({ ...prev, [day]: next }));
  };

  const validation = validateMasterSchedule(state);

  const handleSave = () => {
    if (disabled) return;
    const v = validateMasterSchedule(state);
    if (!v.ok) {
      const key: TranslationKey =
        v.reason === "range"
          ? "master.schedule.error.range"
          : v.reason === "break_range"
            ? "master.schedule.error.breakRange"
            : "master.schedule.error.breakOutside";
      setError(t(key, lang));
      return;
    }
    setError(null);
    onSave(serializeMasterSchedule(state));
  };

  return (
    <div className="space-y-3 text-sm" data-testid={`${testIdPrefix}-editor`}>
      {notice && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
          data-testid={`${testIdPrefix}-notice`}
        >
          {notice}
        </div>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {t("master.schedule.editHint", lang)}
      </p>

      <div className="space-y-2">
        {WEEKDAY_KEYS.map((day) => (
          <DayRow
            key={day}
            day={day}
            slot={state[day]}
            disabled={disabled}
            lang={lang}
            prefix={testIdPrefix}
            onChange={(next) => setDay(day, next)}
          />
        ))}
      </div>

      {error && (
        <div
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-300"
          data-testid={`${testIdPrefix}-error`}
        >
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300">
          {t("master.schedule.saved", lang)}
        </div>
      )}

      {!disabled && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !validation.ok}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            data-testid={`${testIdPrefix}-save`}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span>{saveLabel ?? t("common.save", lang)}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function DayRow({
  day,
  slot,
  disabled,
  lang,
  prefix,
  onChange,
}: {
  day: WeekdayKey;
  slot: MasterDaySchedule;
  disabled: boolean;
  lang: Lang;
  prefix: string;
  onChange: (next: MasterDaySchedule) => void;
}) {
  const rangeInvalid = slot !== null && slot.close <= slot.open;
  return (
    <div
      data-testid={`${prefix}-row-${day}`}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="w-20 shrink-0 text-xs font-medium text-slate-700 dark:text-slate-300">
        {t(DAY_LABEL_KEY[day], lang)}
      </span>
      <Switch
        size="sm"
        checked={slot !== null}
        disabled={disabled}
        onChange={(on) => onChange(on ? { ...DEFAULT_DAY } : null)}
        aria-label={t("salon.publicProfile.workingDay", lang)}
        data-testid={`${prefix}-toggle-${day}`}
      />
      {slot === null ? (
        <span className="flex-1 text-xs italic text-slate-500 dark:text-slate-400">
          {t("salon.publicProfile.dayOff", lang)}
        </span>
      ) : (
        <WorkingDayControls
          slot={slot}
          day={day}
          disabled={disabled}
          lang={lang}
          prefix={prefix}
          onChange={onChange}
        />
      )}
      {rangeInvalid && (
        <span
          className="w-full pl-20 text-[11px] text-amber-500"
          data-testid={`${prefix}-row-error-${day}`}
        >
          {t("master.schedule.error.range", lang)}
        </span>
      )}
    </div>
  );
}

function WorkingDayControls({
  slot,
  day,
  disabled,
  lang,
  prefix,
  onChange,
}: {
  slot: NonNullable<MasterDaySchedule>;
  day: WeekdayKey;
  disabled: boolean;
  lang: Lang;
  prefix: string;
  onChange: (next: MasterDaySchedule) => void;
}) {
  const br = slot.break;
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Select
          className="flex-1 min-w-0"
          value={slot.open}
          onChange={(v) => onChange({ ...slot, open: v })}
          options={optionsWith(slot.open)}
          disabled={disabled}
          testIdPrefix={`${prefix}-open-${day}`}
        />
        <span className="shrink-0 text-xs text-slate-500">—</span>
        <Select
          className="flex-1 min-w-0"
          value={slot.close}
          onChange={(v) => onChange({ ...slot, close: v })}
          options={optionsWith(slot.close)}
          disabled={disabled}
          testIdPrefix={`${prefix}-close-${day}`}
        />
      </div>

      {/* Break sub-line — wraps to its own full-width row on mobile. */}
      <div className="flex w-full basis-full items-center gap-1.5 pl-20">
        {br ? (
          <>
            <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
              {t("master.schedule.break", lang)}
            </span>
            <Select
              className="flex-1 min-w-0"
              value={br.start}
              onChange={(v) => onChange({ ...slot, break: { start: v, end: br.end } })}
              options={optionsWith(br.start)}
              disabled={disabled}
              testIdPrefix={`${prefix}-break-start-${day}`}
            />
            <span className="shrink-0 text-xs text-slate-500">—</span>
            <Select
              className="flex-1 min-w-0"
              value={br.end}
              onChange={(v) => onChange({ ...slot, break: { start: br.start, end: v } })}
              options={optionsWith(br.end)}
              disabled={disabled}
              testIdPrefix={`${prefix}-break-end-${day}`}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ open: slot.open, close: slot.close })}
              aria-label={t("master.schedule.removeBreak", lang)}
              data-testid={`${prefix}-rmbreak-${day}`}
              className="shrink-0 rounded-md p-1 text-slate-400 transition hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...slot, break: { ...DEFAULT_BREAK } })}
            data-testid={`${prefix}-addbreak-${day}`}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-brand-600 transition hover:bg-brand-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-brand-300"
          >
            <Plus className="h-3 w-3" />
            <span>{t("master.schedule.addBreak", lang)}</span>
          </button>
        )}
      </div>
    </>
  );
}
