"use client";

/**
 * TimeReservationDialog — FAB scenario 2.
 *
 * Lets a salon owner / master mark a slot as occupied without booking a
 * client. Renders as a hatched grey block in Day/Week views; behaves
 * like a busy slot for the conflict guard in `appointments.createManual`.
 *
 * Field set is intentionally smaller than ManualBookingModal — no client,
 * no service. Drag-to-create on the grid pre-fills `defaultMasterId`,
 * `defaultDate`, `defaultTime` and the duration derived from the drag.
 */

import { useState, type FormEvent } from "react";
import { PauseCircle, X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";
import { DatePicker } from "~/components/ui/DatePicker";

interface Props {
  tenantId: string;
  defaultMasterId?: number | null;
  defaultDate?: string;
  defaultTime?: string;
  defaultDurationMin?: number;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

export const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 180] as const;

const FIELD =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";
const LABEL = "mb-1 block text-xs font-medium text-slate-600 dark:text-white/70";

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function nowHHMM(): string {
  const d = new Date();
  // Snap to the next quarter — nicer default than the literal current minute.
  const m = Math.ceil(d.getMinutes() / 15) * 15;
  let hh = d.getHours();
  let mm = m;
  if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
  return `${pad2(hh)}:${pad2(mm)}`;
}

export function TimeReservationDialog({
  tenantId,
  defaultMasterId,
  defaultDate,
  defaultTime,
  defaultDurationMin,
  onClose,
  onCreated,
}: Props) {
  const { lang } = useLang();
  const masters = api.salon.getMasters.useQuery({ tenantId });
  const utils = api.useUtils();

  const [masterId, setMasterId] = useState<number | null>(defaultMasterId ?? null);
  const [date, setDate] = useState<string>(defaultDate ?? todayIso());
  const [time, setTime] = useState<string>(defaultTime ?? nowHHMM());
  const [durationMin, setDurationMin] = useState<number>(defaultDurationMin ?? 30);
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

  const formValid = masterId != null && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && durationMin > 0;
  const submitDisabled = !formValid || create.isPending;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (submitDisabled) return;
    create.mutate({
      tenantId,
      masterId: masterId!,
      type: "reservation",
      date,
      time,
      durationMin,
      reason: reason.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      onClick={onClose}
      data-testid="time-reservation-dialog"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh" }}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-white/10">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300 shrink-0">
              <PauseCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                {t("block.reservation.title", lang)}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                {t("block.reservation.subtitle", lang)}
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

        <form onSubmit={submit} className="px-5 py-4 space-y-4 text-sm">
          <div>
            <label className={LABEL}>{t("appointments.manual.master", lang)}</label>
            <Select
              testIdPrefix="block-master"
              value={masterId == null ? "" : String(masterId)}
              onChange={(v) => setMasterId(v ? Number(v) : null)}
              disabled={defaultMasterId != null}
              placeholder={t("appointments.manual.pickPlaceholder", lang)}
              options={(masters.data ?? []).map((m) => ({
                value: String(m.chatId),
                label: m.name || `#${m.chatId}`,
              }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("appointments.manual.date", lang)}</label>
              <DatePicker
                value={date}
                onChange={setDate}
                lang={lang}
                testIdPrefix="block-date"
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

          <div>
            <label className={LABEL}>{t("block.duration", lang)}</label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" data-testid="block-duration-presets">
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

          <div>
            <label className={LABEL}>{t("block.reason", lang)}</label>
            <input
              type="text"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("block.reservation.reasonPh", lang)}
              className={FIELD}
              data-testid="block-reason"
            />
          </div>

          {err && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">
              {err}
            </p>
          )}

          <div className="flex gap-3 pt-1 sticky bottom-0 bg-white dark:bg-slate-900 -mx-5 px-5 pb-1">
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

// Helper for callers in tests / storybook that want to format the duration
// pill the same way as the dialog. Exported so the time-off dialog can
// render identical-looking presets without duplicating logic.
export function formatDurationPreset(min: number, lang: Lang): string {
  void lang;
  if (min < 60) return `${min}m`;
  const h = min / 60;
  return `${h.toFixed(min % 60 === 0 ? 0 : 1)}h`;
}
