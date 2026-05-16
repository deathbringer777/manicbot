"use client";

/**
 * TimeOffDialog — FAB scenario 3.
 *
 * Three sub-modes (sub-tab at top), all writing to the same
 * `appointment_blocks` table with `type='time_off'`:
 *
 *   * `break`    — short window inside a working day (lunch, doctor)
 *                  ↳ master + date + start time + duration
 *   * `dayoff`   — single full day (auto 00:00 / 24h)
 *                  ↳ master + date
 *   * `vacation` — multi-day range (one block row, `endDate` set)
 *                  ↳ master + start date + end date
 *
 * Multi-day vacation creates a single row with `endDate` so the
 * conflict guard treats every spanned date as fully blocked, but the
 * row count stays at 1 (cleaner audit, easier to undo than N rows).
 */

import { useState, type FormEvent } from "react";
import { Coffee, X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";

type Kind = "break" | "dayoff" | "vacation";

interface Props {
  tenantId: string;
  defaultMasterId?: number | null;
  defaultDate?: string;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

const FIELD =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";
const LABEL = "mb-1 block text-xs font-medium text-slate-600 dark:text-white/70";
const DURATION_PRESETS = [30, 45, 60, 90, 120] as const;

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function TimeOffDialog({ tenantId, defaultMasterId, defaultDate, onClose, onCreated }: Props) {
  const { lang } = useLang();
  const masters = api.salon.getMasters.useQuery({ tenantId });
  const utils = api.useUtils();

  const [kind, setKind] = useState<Kind>("break");
  const [masterId, setMasterId] = useState<number | null>(defaultMasterId ?? null);
  const [dateFrom, setDateFrom] = useState<string>(defaultDate ?? todayIso());
  const [dateTo, setDateTo] = useState<string>(defaultDate ?? todayIso());
  const [time, setTime] = useState<string>("13:00");
  const [durationMin, setDurationMin] = useState<number>(60);
  const [reason, setReason] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const create = api.appointmentBlocks.create.useMutation({
    onSuccess: ({ id }) => {
      void utils.appointmentBlocks.listByRange.invalidate();
      void utils.appointments.getAll.invalidate();
      onCreated?.(id);
      onClose();
    },
    onError: (e) => {
      setErr(e.message === "slot_conflict" ? t("block.slotConflict", lang) : e.message);
    },
  });

  const formValid = (() => {
    if (masterId == null) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return false;
    if (kind === "break") return /^\d{2}:\d{2}$/.test(time) && durationMin > 0;
    if (kind === "vacation") return /^\d{4}-\d{2}-\d{2}$/.test(dateTo) && dateTo >= dateFrom;
    return true;
  })();
  const submitDisabled = !formValid || create.isPending;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (submitDisabled) return;

    if (kind === "break") {
      create.mutate({
        tenantId,
        masterId: masterId!,
        type: "time_off",
        date: dateFrom,
        time,
        durationMin,
        reason: reason.trim() || undefined,
      });
    } else if (kind === "dayoff") {
      create.mutate({
        tenantId,
        masterId: masterId!,
        type: "time_off",
        date: dateFrom,
        time: "00:00",
        durationMin: 60 * 24,
        reason: reason.trim() || undefined,
      });
    } else {
      // vacation — single row with endDate spanning the range.
      create.mutate({
        tenantId,
        masterId: masterId!,
        type: "time_off",
        date: dateFrom,
        time: "00:00",
        durationMin: 60 * 24,
        endDate: dateTo,
        reason: reason.trim() || undefined,
      });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      data-testid="time-off-dialog"
    >
      <div
        className="glass-card w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900/95"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh" }}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-white/10">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300 shrink-0">
              <Coffee className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                {t("block.timeOff.title", lang)}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                {t("block.timeOff.subtitle", lang)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Sub-tabs — break / day off / vacation. Visually pill bar; the
            previously selected option stays highlighted via aria-pressed. */}
        <div
          className="px-5 pt-4 grid grid-cols-3 gap-1 bg-white dark:bg-slate-900/95"
          role="tablist"
          data-testid="time-off-kind-tabs"
        >
          {(["break", "dayoff", "vacation"] as const).map((k) => {
            const labelKey =
              k === "break" ? "block.timeOff.kindBreak" :
              k === "dayoff" ? "block.timeOff.kindDayOff" :
              "block.timeOff.kindVacation";
            const sel = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={sel}
                data-testid={`time-off-kind-${k}`}
                onClick={() => setKind(k)}
                className={`px-2 py-2 rounded-lg text-[11px] font-semibold transition ${
                  sel
                    ? "text-white shadow-[0_4px_12px_-4px_rgba(124,58,237,0.55)]"
                    : "bg-slate-100 dark:bg-white/[0.04] text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/[0.08]"
                }`}
                style={sel ? { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" } : undefined}
              >
                {t(labelKey as any, lang)}
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-4 text-sm">
          <div>
            <label className={LABEL}>{t("appointments.manual.master", lang)}</label>
            <select
              data-testid="block-master"
              className={FIELD}
              value={masterId ?? ""}
              onChange={(e) => setMasterId(Number(e.target.value) || null)}
              disabled={defaultMasterId != null}
            >
              <option value="">{t("appointments.manual.pickPlaceholder", lang)}</option>
              {(masters.data ?? []).map((m) => (
                <option key={m.chatId} value={m.chatId}>{m.name || `#${m.chatId}`}</option>
              ))}
            </select>
          </div>

          {/* break-mode fields */}
          {kind === "break" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL}>{t("appointments.manual.date", lang)}</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={FIELD}
                  data-testid="block-date"
                />
              </div>
              <div>
                <label className={LABEL}>{t("appointments.manual.time", lang)}</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  step={300}
                  className={FIELD}
                  data-testid="block-time"
                />
              </div>
            </div>
          )}

          {kind === "break" && (
            <div>
              <label className={LABEL}>{t("block.duration", lang)}</label>
              <div className="flex flex-wrap gap-1.5" role="radiogroup">
                {DURATION_PRESETS.map((d) => {
                  const sel = durationMin === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      onClick={() => setDurationMin(d)}
                      data-testid={`block-duration-${d}`}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                        sel
                          ? "border-transparent text-white shadow-[0_4px_12px_-4px_rgba(124,58,237,0.55)]"
                          : "border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                      }`}
                      style={sel ? { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" } : undefined}
                    >
                      {d < 60 ? `${d}m` : `${(d / 60).toFixed(d % 60 === 0 ? 0 : 1)}h`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* dayoff-mode field */}
          {kind === "dayoff" && (
            <div>
              <label className={LABEL}>{t("appointments.manual.date", lang)}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={FIELD}
                data-testid="block-date"
              />
            </div>
          )}

          {/* vacation-mode fields */}
          {kind === "vacation" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL}>{t("block.timeOff.dateFrom", lang)}</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={FIELD}
                  data-testid="block-date-from"
                />
              </div>
              <div>
                <label className={LABEL}>{t("block.timeOff.dateTo", lang)}</label>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={FIELD}
                  data-testid="block-date-to"
                />
              </div>
            </div>
          )}

          <div>
            <label className={LABEL}>{t("block.reason", lang)}</label>
            <input
              type="text"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("block.timeOff.reasonPh", lang)}
              className={FIELD}
              data-testid="block-reason"
            />
          </div>

          {err && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">
              {err}
            </p>
          )}

          <div className="flex gap-3 pt-1 sticky bottom-0 bg-white dark:bg-slate-900/95 -mx-5 px-5 pb-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-100 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:hover:bg-white/[0.08]"
            >
              {t("common.cancel", lang)}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              data-testid="block-submit"
              className={
                submitDisabled
                  ? "flex-1 rounded-lg bg-slate-200 py-2.5 text-sm font-semibold text-slate-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500"
                  : "flex-1 rounded-lg py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] transition hover:opacity-90"
              }
              style={submitDisabled ? undefined : { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
            >
              {create.isPending ? t("block.creating", lang) : t("block.create", lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

void formatDurationPresetUnused;
function formatDurationPresetUnused(_lang: Lang) { /* no-op */ }
