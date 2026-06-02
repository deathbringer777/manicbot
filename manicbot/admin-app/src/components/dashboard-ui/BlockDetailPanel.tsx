"use client";

/**
 * BlockDetailPanel — the reservation/time-off-block counterpart to
 * AppointmentDetailPanel.
 *
 * Replaces the old "click a block → instant window.confirm('Удалить?')" with
 * a Google-Calendar-style flow:
 *   - read mode: an AnchoredPopover showing the block's details with a
 *     Pencil / Trash2 / X toolbar in the top-right corner;
 *   - edit mode: escalates to a centered modal («развернутое меню») editing
 *     date / time / master / duration / reason, saved via
 *     `appointmentBlocks.update`;
 *   - delete: a danger ConfirmDialog (no native dialog), soft-cancelling the
 *     row via `appointmentBlocks.delete`.
 *
 * Mirrors AppointmentDetailPanel's `nestedOpen` dismissal-freeze so a click
 * inside the higher-z ConfirmDialog can't tear this popover down mid-click.
 * Multi-day time-off blocks edit their date RANGE instead of time+duration;
 * the block's `type` is fixed in edit (switch modes by delete + recreate).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Trash2,
  Lock,
  Clock,
  Calendar as CalendarIcon,
  User,
  X,
} from "lucide-react";
import { api } from "~/trpc/react";
import { t, type Lang } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";
import { DatePicker } from "~/components/ui/DatePicker";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { AnchoredPopover } from "~/components/calendar/AnchoredPopover";
import type { AnchorRect } from "~/lib/calendar/useAnchoredPosition";
import type { DayViewBlock } from "~/components/dashboards/SalonDayView";
import { DURATION_PRESETS } from "~/components/dashboard/TimeReservationDialog";

interface MasterOption {
  chatId: number;
  name: string | null;
}

interface Props {
  tenantId: string;
  block: DayViewBlock;
  masters: MasterOption[];
  lang: Lang;
  /** Viewport rect of the clicked block — read mode anchors a popover to it;
   *  edit mode escalates to a centered modal. */
  anchorRect?: AnchorRect | null;
  onClose: () => void;
  /** Refresh callback after a successful save / delete. */
  onChanged: () => void;
}

const FIELD_BASE =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-brand-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";

const LABEL =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50";

const ICON_BTN =
  "h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10 transition-colors";

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + mins;
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(hh)}:${pad(mm)}`;
}

function durationLabel(min: number): string {
  if (min < 60) return `${min}m`;
  return `${(min / 60).toFixed(min % 60 === 0 ? 0 : 1)}h`;
}

export function BlockDetailPanel({
  tenantId,
  block,
  masters,
  lang,
  anchorRect,
  onClose,
  onChanged,
}: Props) {
  type Mode = "read" | "edit";
  const [mode, setMode] = useState<Mode>("read");
  const utils = api.useUtils();

  // A block created as a multi-day time-off (end_date set) edits its date
  // RANGE; everything else edits a single time slot.
  const isMultiDay = !!block.endDate && block.endDate !== block.date;

  const [date, setDate] = useState(block.date);
  const [time, setTime] = useState(block.time);
  const [endDate, setEndDate] = useState<string>(block.endDate ?? block.date);
  const [masterId, setMasterId] = useState<number | null>(block.masterId ?? null);
  const [durationMin, setDurationMin] = useState<number>(block.durationMin);
  const [reason, setReason] = useState<string>(block.reason ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-seed editable state whenever a different block is selected.
  useEffect(() => {
    setDate(block.date);
    setTime(block.time);
    setEndDate(block.endDate ?? block.date);
    setMasterId(block.masterId ?? null);
    setDurationMin(block.durationMin);
    setReason(block.reason ?? "");
    setMode("read");
    setErr(null);
    setConfirmDelete(false);
  }, [block.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = api.appointmentBlocks.update.useMutation({
    onSuccess: () => {
      void utils.appointmentBlocks.listByRange.invalidate();
      void utils.appointments.getAll.invalidate();
      setMode("read");
      setErr(null);
      onChanged();
    },
    onError: (e) => {
      setErr(e.message === "slot_conflict" ? t("block.slotConflict", lang) : e.message);
    },
  });

  const del = api.appointmentBlocks.delete.useMutation({
    onSuccess: () => {
      void utils.appointmentBlocks.listByRange.invalidate();
      void utils.appointments.getAll.invalidate();
      setConfirmDelete(false);
      onChanged();
      onClose();
    },
    onError: (e) => {
      setErr(e.message);
      setConfirmDelete(false);
    },
  });

  const locale =
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU";
  const fmtDate = (iso: string) => {
    try {
      return new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
    } catch {
      return iso;
    }
  };

  const minLabel = t("salon.day.panel.minShort", lang);
  const typeLabel =
    block.type === "reservation"
      ? t("block.typeReservation", lang)
      : t("block.typeTimeOff", lang);
  const currentMaster = useMemo(
    () => masters.find((m) => m.chatId === block.masterId) ?? null,
    [masters, block.masterId],
  );
  const endTimeRead = addMinutes(block.time, block.durationMin);

  // Single-slot duration presets — always include the block's own duration so
  // a drag-created 75-min block stays selectable + highlighted.
  const presetList = useMemo(() => {
    const set = new Set<number>(DURATION_PRESETS);
    if (durationMin > 0 && durationMin <= 60 * 12) set.add(durationMin);
    return Array.from(set).sort((a, b) => a - b);
  }, [durationMin]);

  const dirty =
    date !== block.date ||
    masterId !== (block.masterId ?? null) ||
    reason.trim() !== (block.reason ?? "") ||
    (isMultiDay
      ? endDate !== (block.endDate ?? block.date)
      : time !== block.time || durationMin !== block.durationMin);

  const formValid =
    masterId != null &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    (isMultiDay
      ? /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= date
      : /^\d{2}:\d{2}$/.test(time) && durationMin > 0);

  function startEdit() {
    setErr(null);
    setMode("edit");
  }

  function cancelEdit() {
    setDate(block.date);
    setTime(block.time);
    setEndDate(block.endDate ?? block.date);
    setMasterId(block.masterId ?? null);
    setDurationMin(block.durationMin);
    setReason(block.reason ?? "");
    setErr(null);
    setMode("read");
  }

  function save() {
    if (!dirty) {
      setMode("read");
      return;
    }
    if (!formValid || masterId == null) return;
    setErr(null);
    update.mutate({
      tenantId,
      id: block.id,
      masterId,
      type: block.type,
      date,
      time: isMultiDay ? block.time : time,
      durationMin: isMultiDay ? block.durationMin : durationMin,
      endDate: isMultiDay ? endDate : undefined,
      reason: reason.trim() || undefined,
    });
  }

  function doDelete() {
    del.mutate({ tenantId, id: block.id });
  }

  const cardBody = (
    <div className="space-y-3" data-testid="block-detail-body">
      {/* Header: type badge + time/duration + edit/delete/close toolbar */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
              <Lock className="h-3 w-3" />
              {typeLabel}
            </span>
            {!isMultiDay && (
              <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                {block.time}
              </span>
            )}
            <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {isMultiDay
                ? `${fmtDate(block.date)} – ${fmtDate(block.endDate ?? block.date)}`
                : `${durationLabel(block.durationMin)}`}
            </span>
            {mode === "edit" && (
              <span className="text-[11px] font-semibold text-brand-500 dark:text-brand-400">
                · {t("salon.day.panel.editing", lang)}
              </span>
            )}
          </div>
          {mode === "read" && block.reason && (
            <p className="mt-1 text-[15px] font-semibold text-slate-900 dark:text-white truncate">
              {block.reason}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {mode === "read" && (
            <>
              <button
                type="button"
                onClick={startEdit}
                className={ICON_BTN}
                title={t("common.edit", lang)}
                aria-label={t("common.edit", lang)}
                data-testid="block-panel-edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className={`${ICON_BTN} hover:!text-red-500`}
                title={t("common.delete", lang)}
                aria-label={t("common.delete", lang)}
                data-testid="block-panel-delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={mode === "edit" ? cancelEdit : onClose}
            className={ICON_BTN}
            title={t("common.close", lang)}
            aria-label={t("common.close", lang)}
            data-testid="block-panel-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Read mode: detail rows */}
      {mode === "read" && (
        <div className="grid gap-2 sm:grid-cols-2 text-[13px]">
          <DetailRow
            icon={<User className="h-3.5 w-3.5" />}
            label={t("salon.day.panel.master", lang)}
            value={currentMaster?.name ?? `#${block.masterId}`}
          />
          <DetailRow
            icon={<CalendarIcon className="h-3.5 w-3.5" />}
            label={t("salon.day.panel.date", lang)}
            value={isMultiDay ? fmtDate(block.date) : fmtDate(block.date)}
            sub={
              isMultiDay
                ? `→ ${fmtDate(block.endDate ?? block.date)}`
                : `${block.time}–${endTimeRead}`
            }
          />
          {!isMultiDay && (
            <DetailRow
              icon={<Clock className="h-3.5 w-3.5" />}
              label={t("block.duration", lang)}
              value={`${block.durationMin} ${minLabel}`}
            />
          )}
        </div>
      )}

      {/* Edit mode: inline form */}
      {mode === "edit" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL}>{t("salon.day.panel.master", lang)}</label>
            <Select
              testIdPrefix="block-panel-master"
              value={masterId == null ? "" : String(masterId)}
              onChange={(v) => setMasterId(v ? Number(v) : null)}
              placeholder={t("appointments.manual.pickPlaceholder", lang)}
              options={masters.map((m) => ({
                value: String(m.chatId),
                label: m.name || `#${m.chatId}`,
              }))}
            />
          </div>
          <div>
            <label className={LABEL}>
              {isMultiDay ? t("block.timeOff.dateFrom", lang) : t("salon.day.panel.date", lang)}
            </label>
            <DatePicker
              value={date}
              onChange={setDate}
              lang={lang}
              testIdPrefix="block-panel-date"
            />
          </div>
          {isMultiDay ? (
            <div>
              <label className={LABEL}>{t("block.timeOff.dateTo", lang)}</label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                lang={lang}
                min={date}
                testIdPrefix="block-panel-end-date"
              />
            </div>
          ) : (
            <div>
              <label className={LABEL}>{t("salon.day.panel.time", lang)}</label>
              <input
                type="time"
                step={300}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={FIELD_BASE}
                data-testid="block-panel-time"
              />
            </div>
          )}
          {!isMultiDay && (
            <div className="sm:col-span-2">
              <label className={LABEL}>{t("block.duration", lang)}</label>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" data-testid="block-panel-duration-presets">
                {presetList.map((d) => {
                  const sel = durationMin === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      onClick={() => setDurationMin(d)}
                      data-testid={`block-panel-duration-${d}`}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                        sel
                          ? "border-transparent text-white shadow-[0_4px_12px_-4px_rgba(209,70,56,0.55)]"
                          : "border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                      }`}
                      style={sel ? { background: "linear-gradient(135deg,var(--color-primary),var(--color-secondary))" } : undefined}
                    >
                      {durationLabel(d)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={LABEL}>{t("block.reason", lang)}</label>
            <input
              type="text"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                block.type === "reservation"
                  ? t("block.reservation.reasonPh", lang)
                  : t("block.timeOff.reasonPh", lang)
              }
              className={FIELD_BASE}
              data-testid="block-panel-reason"
            />
          </div>
        </div>
      )}

      {err && (
        <p
          className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300"
          data-testid="block-panel-error"
        >
          {err}
        </p>
      )}

      {mode === "edit" && (
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={cancelEdit}
            disabled={update.isPending}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-100 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:hover:bg-white/[0.08] disabled:opacity-50"
            data-testid="block-panel-edit-cancel"
          >
            {t("common.cancel", lang)}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || !formValid || update.isPending}
            className={
              !dirty || !formValid || update.isPending
                ? "flex-1 rounded-lg bg-slate-200 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500"
                : "flex-1 rounded-lg py-2 text-xs font-semibold text-white shadow-[0_8px_24px_-6px_rgba(209,70,56,0.45)] transition hover:opacity-90"
            }
            style={
              !dirty || !formValid || update.isPending
                ? undefined
                : { background: "linear-gradient(135deg,var(--color-primary),var(--color-secondary))" }
            }
            data-testid="block-panel-edit-save"
          >
            {update.isPending ? t("salon.day.panel.saving", lang) : t("salon.day.panel.saveChanges", lang)}
          </button>
        </div>
      )}
    </div>
  );

  // Freeze the popover's outside-click/Esc/scroll dismissal while the delete
  // confirm is up, so a click inside that higher-z dialog can't tear this
  // layer — and the dialog — down mid-click.
  const nestedOpen = confirmDelete;

  return (
    <>
      {mode === "edit" ? (
        // Expanded «развернутое меню» — a deliberate centered modal, mirroring
        // AppointmentDetailPanel's edit surface + ManualBookingModal styling.
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("block.detail.editTitle", lang)}
            data-testid="block-detail-edit-modal"
            className="w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-6"
            style={{ maxHeight: "92vh" }}
          >
            {cardBody}
          </div>
        </div>
      ) : confirmDelete ? null : (
        // While the delete confirm is open we render ONLY the ConfirmDialog
        // (full-screen dim) — the read popover must not stay layered behind it.
        <AnchoredPopover
          anchorRect={anchorRect ?? null}
          onClose={onClose}
          closeOnOutside={!nestedOpen}
          width={320}
          heightEstimate={260}
          testId="block-detail-popover"
          ariaLabel={typeLabel}
          className="max-h-[80vh] overflow-y-auto p-4"
        >
          {cardBody}
        </AnchoredPopover>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("salon.day.deleteBlockTitle", lang)}
        description={t("salon.day.deleteBlockDesc", lang)}
        confirmLabel={t("common.delete", lang)}
        cancelLabel={t("common.cancel", lang)}
        tone="danger"
        busy={del.isPending}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function DetailRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-slate-50/60 dark:bg-white/[0.02] px-3 py-2">
      <div className="mt-0.5 text-slate-400 dark:text-white/40 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">
          {label}
        </div>
        <div className="text-[13px] font-medium text-slate-900 dark:text-white truncate">{value}</div>
        {sub && <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{sub}</div>}
      </div>
    </div>
  );
}
