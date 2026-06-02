"use client";

/**
 * MasterScheduleEditor — per-master weekly booking schedule.
 *
 * Edits the single `{from,to}` daily window + the set of working weekdays the
 * Worker booking engine honours (see ~/lib/workHours and src/services/
 * appointments.js → getSlots). Shared by the owner-side master card
 * (MasterDetailModal) and the master's own dashboard, so both surfaces write
 * the identical on-disk shape.
 *
 * Granularity is intentionally a single daily window (not per-day open/close) —
 * that is exactly what getSlots() supports today. Working days are a 0..6
 * weekday set (0=Sun … 6=Sat, matching Date.getUTCDay); booking treats an empty
 * set as "every day", so we seed Mon–Sat defaults (Sunday off).
 *
 * `disabled` (with an optional `notice`) renders the editor read-only — used on
 * the master dashboard when the salon-level policy is `salon_only`. `saveLabel`
 * overrides the button text (e.g. "Send for approval" under `master_approval`).
 */
import { useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { t, type Lang, type TranslationKey } from "~/lib/i18n";
import {
  parseMasterHours,
  parseMasterWorkDays,
  serializeMasterHours,
  serializeMasterWorkDays,
  isValidMasterHours,
} from "~/lib/workHours";

// Display order Mon..Sun, each mapped to its getUTCDay() index (Sunday = 0).
const DAY_ORDER = [
  { dow: 1, labelKey: "weekday.short.mon" },
  { dow: 2, labelKey: "weekday.short.tue" },
  { dow: 3, labelKey: "weekday.short.wed" },
  { dow: 4, labelKey: "weekday.short.thu" },
  { dow: 5, labelKey: "weekday.short.fri" },
  { dow: 6, labelKey: "weekday.short.sat" },
  { dow: 0, labelKey: "weekday.short.sun" },
] as const satisfies ReadonlyArray<{ dow: number; labelKey: TranslationKey }>;

const DEFAULT_FROM = 9;
const DEFAULT_TO = 18;
const DEFAULT_DOWS = [1, 2, 3, 4, 5, 6]; // Mon..Sat, Sun off — mirrors DEFAULT_WORK_HOURS

function clampHour(raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(24, n));
}

export interface MasterScheduleEditorProps {
  /** Raw stored value — JSON string, legacy `{from,to}`, or null. */
  workHours: unknown;
  /** Raw stored value — JSON string, number[], or null. */
  workDays: unknown;
  saving: boolean;
  saved?: boolean;
  /** Read-only mode (e.g. salon_only policy) — inputs + Save are disabled. */
  disabled?: boolean;
  /** Banner shown above the editor (e.g. "Working hours are set by the salon"). */
  notice?: string | null;
  /** Overrides the Save button label (e.g. "Send for approval"). */
  saveLabel?: string;
  lang: Lang;
  /** Receives the serialized `{from,to}` string + the serialized 0..6 day array. */
  onSave: (workHours: string, workDays: string) => void;
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
  const initialHours = useMemo(() => parseMasterHours(workHours), [workHours]);
  const initialDays = useMemo(() => parseMasterWorkDays(workDays), [workDays]);

  const [from, setFrom] = useState<number>(initialHours?.from ?? DEFAULT_FROM);
  const [to, setTo] = useState<number>(initialHours?.to ?? DEFAULT_TO);
  const [dows, setDows] = useState<Set<number>>(
    () => new Set(initialDays && initialDays.length > 0 ? initialDays : DEFAULT_DOWS),
  );
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (dow: number) => {
    if (disabled) return;
    setDows((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow);
      else next.add(dow);
      return next;
    });
  };

  const handleSave = () => {
    if (disabled) return;
    if (!isValidMasterHours(from, to)) {
      setError(t("master.schedule.error.range", lang));
      return;
    }
    setError(null);
    onSave(serializeMasterHours(from, to), serializeMasterWorkDays([...dows]));
  };

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 disabled:opacity-60 disabled:cursor-not-allowed dark:border-white/10 dark:bg-slate-800 dark:text-slate-100";

  return (
    <div className="space-y-4 text-sm" data-testid={`${testIdPrefix}-editor`}>
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

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">
            {t("salon.workHoursFrom", lang)}
          </span>
          <input
            type="number"
            min={0}
            max={24}
            value={String(from)}
            disabled={disabled}
            onChange={(e) => setFrom(clampHour(e.target.value))}
            className={inputCls}
            data-testid={`${testIdPrefix}-from`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">
            {t("salon.workHoursTo", lang)}
          </span>
          <input
            type="number"
            min={0}
            max={24}
            value={String(to)}
            disabled={disabled}
            onChange={(e) => setTo(clampHour(e.target.value))}
            className={inputCls}
            data-testid={`${testIdPrefix}-to`}
          />
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-[11px] font-medium text-slate-500">
          {t("master.schedule.days", lang)}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {DAY_ORDER.map((d) => {
            const on = dows.has(d.dow);
            return (
              <button
                key={d.dow}
                type="button"
                onClick={() => toggleDay(d.dow)}
                disabled={disabled}
                aria-pressed={on}
                data-testid={`${testIdPrefix}-day-${d.dow}`}
                className={`h-9 w-9 rounded-full text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  on
                    ? "bg-brand-500 text-white shadow-sm"
                    : "border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/5"
                }`}
              >
                {t(d.labelKey, lang)}
              </button>
            );
          })}
        </div>
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
            disabled={saving}
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
