"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  UserX,
  AlertTriangle,
  Clock,
  Calendar as CalendarIcon,
  User,
  Sparkles,
  MessageSquare,
  X,
} from "lucide-react";
import { api } from "~/trpc/react";
import { t, type Lang } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { STATUS_STYLES } from "~/components/dashboard-ui/AptCard";

/**
 * Explicit shape for an appointment row passed into the detail panel.
 * SalonDayView keeps appointments as `Record<string, any>` to dodge the
 * 40-column Drizzle row type — but we narrow at THIS boundary so the
 * panel never accidentally serializes a wrong column when saving.
 */
export interface SelectedAppointment {
  id: string | number;
  tenantId: string;
  date: string;              // YYYY-MM-DD
  time: string;              // HH:MM
  duration?: number | null;  // minutes (derived from svc)
  status: string;
  cancelled?: number | null;
  noShow?: number | null;
  noShowBy?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  masterId?: number | null;
  svcId?: string | null;
  userName?: string | null;
  userPhone?: string | null;
  userTg?: string | null;
  chatId?: number | null;
}

interface MasterOption {
  chatId: number;
  name: string | null;
}

interface ServiceOption {
  svcId: string;
  names?: string | null;
  duration: number;
  price: number;
}

interface Props {
  tenantId: string;
  selected: SelectedAppointment;
  masters: MasterOption[];
  services: ServiceOption[];
  lang: Lang;
  onClose: () => void;
  /** Refresh callback after a successful save / status change / delete. */
  onChanged: () => void;
}

function svcDisplayName(s: ServiceOption | undefined, lang: Lang): string {
  if (!s) return "";
  if (typeof s.names === "string" && s.names) {
    try {
      const j = JSON.parse(s.names) as Record<string, string>;
      return j[lang] || j.ru || j.en || s.svcId;
    } catch {
      return s.svcId;
    }
  }
  return s.svcId;
}

function channelLabel(tg: string | null | undefined): string {
  if (tg && tg.length > 0) return `TG${tg.startsWith("@") ? " · " + tg : ""}`;
  return "Web";
}

const FIELD_BASE =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";

const LABEL =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50";

const ICON_BTN =
  "h-8 w-8 rounded-lg inline-flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10 transition-colors";

export function AppointmentDetailPanel({
  tenantId,
  selected,
  masters,
  services,
  lang,
  onClose,
  onChanged,
}: Props) {
  type Mode = "read" | "edit";
  const [mode, setMode] = useState<Mode>("read");

  // Snapshot of editable fields, seeded from `selected` whenever the
  // panel switches appointment.
  const [date, setDate] = useState(selected.date);
  const [time, setTime] = useState(selected.time);
  const [masterId, setMasterId] = useState<number | null>(selected.masterId ?? null);
  const [svcId, setSvcId] = useState<string>(selected.svcId ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset edit state when a different appointment is selected.
  useEffect(() => {
    setDate(selected.date);
    setTime(selected.time);
    setMasterId(selected.masterId ?? null);
    setSvcId(selected.svcId ?? "");
    setMode("read");
    setErr(null);
  }, [selected.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = api.appointments.update.useMutation({
    onSuccess: () => {
      setMode("read");
      setErr(null);
      onChanged();
    },
    onError: (e) => {
      if (e.message === "slot_conflict") {
        setErr(t("salon.day.panel.slotConflict", lang));
      } else {
        setErr(e.message);
      }
    },
  });

  // Tenant-scoped status mutations. Previously the panel called
  // `api.appointments.updateStatus` + `markNoShow` which are God Mode
  // (`adminProcedure`) only — every click from a salon owner silently
  // 403'd. The `salon.*` procedures are guarded by `assertTenantOwner`
  // and additionally fire the Worker `/admin/appointment-action` so the
  // client gets the right Telegram message + Google Calendar update.
  const mapStatusError = (e: { message: string }) => {
    if (e.message === "cannot_mark_done_before_start") {
      setErr(t("salon.day.panel.doneNotYet", lang));
    } else if (e.message === "invalid_status_transition") {
      setErr(t("salon.day.panel.invalidStatusTransition", lang));
    } else {
      setErr(e.message);
    }
  };
  const confirmApt = api.salon.confirmAppointment.useMutation({
    onSuccess: () => { setErr(null); onChanged(); },
    onError: mapStatusError,
  });
  const markDoneMut = api.salon.markDone.useMutation({
    onSuccess: () => { setErr(null); onChanged(); },
    onError: mapStatusError,
  });
  const markNoShow = api.salon.markNoShow.useMutation({
    onSuccess: () => { setErr(null); onChanged(); },
    onError: mapStatusError,
  });
  const cancelApt = api.salon.cancelAppointment.useMutation({
    onSuccess: () => { setErr(null); setConfirmDelete(false); onChanged(); },
    onError: mapStatusError,
  });

  const isPending = selected.status === "pending" && !selected.cancelled;
  const isConfirmed = selected.status === "confirmed" && !selected.cancelled && !selected.noShow;
  const isCancelled = !!selected.cancelled || selected.status === "cancelled" || selected.status === "rejected";
  const isNoShow = !!selected.noShow;
  const isDone = selected.status === "done";

  // "Mark Done" disabled until the appointment time has passed. Mirror
  // of the server-side check in `salon.markDone` so the user gets
  // immediate feedback instead of waiting for a round-trip rejection.
  const nowSec = Math.floor(Date.now() / 1000);
  const aptStartSec = (() => {
    const [hh, mm] = (selected.time ?? "00:00").split(":");
    const iso = `${selected.date}T${(hh ?? "00").padStart(2, "0")}:${(mm ?? "00").padStart(2, "0")}:00`;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : nowSec;
  })();
  const canMarkDone = aptStartSec <= nowSec;
  const statusBusy =
    confirmApt.isPending
    || markDoneMut.isPending
    || markNoShow.isPending
    || cancelApt.isPending;

  const currentMaster = useMemo(
    () => masters.find((m) => m.chatId === selected.masterId) ?? null,
    [masters, selected.masterId],
  );
  const currentService = useMemo(
    () => services.find((s) => s.svcId === selected.svcId) ?? null,
    [services, selected.svcId],
  );

  // Status badge resolution mirrors AptCard so the panel + grid agree.
  const statusKey = isNoShow ? "no_show" : isCancelled ? "cancelled" : selected.status;
  const statusClass = STATUS_STYLES[statusKey] ?? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300";

  const duration =
    selected.duration ?? currentService?.duration ?? 60;
  const minLabel = t("salon.day.panel.minShort", lang);

  const dirty =
    date !== selected.date
    || time !== selected.time
    || masterId !== (selected.masterId ?? null)
    || svcId !== (selected.svcId ?? "");

  function startEdit() {
    setErr(null);
    setMode("edit");
  }

  function cancelEdit() {
    setDate(selected.date);
    setTime(selected.time);
    setMasterId(selected.masterId ?? null);
    setSvcId(selected.svcId ?? "");
    setErr(null);
    setMode("read");
  }

  function save() {
    if (!dirty) {
      setMode("read");
      return;
    }
    setErr(null);
    update.mutate({
      id: String(selected.id),
      date: date !== selected.date ? date : undefined,
      time: time !== selected.time ? time : undefined,
      masterId: masterId !== selected.masterId ? (masterId ?? undefined) : undefined,
      serviceId: svcId !== selected.svcId ? svcId : undefined,
    });
  }

  function doDelete() {
    cancelApt.mutate({
      tenantId: tenantId,
      id: String(selected.id),
      cancelledBy: "admin",
      comment: "Removed via day-view panel",
    });
  }

  return (
    <div
      className="glass-card rounded-2xl p-4 space-y-3"
      data-testid="day-view-selected"
    >
      {/* Header: status + time/duration + edit/delete/close actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusClass}`}
              data-testid="panel-status-badge"
            >
              {t(`status.${selected.status}` as Parameters<typeof t>[0], lang)}
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
              {selected.time}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {duration} {minLabel}
            </span>
            {mode === "edit" && (
              <span className="text-[11px] font-semibold text-brand-500 dark:text-brand-400">
                · {t("salon.day.panel.editing", lang)}
              </span>
            )}
          </div>
          {mode === "read" && selected.userName && (
            <p className="mt-1 text-[15px] font-semibold text-slate-900 dark:text-white truncate">
              {selected.userName}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {mode === "read" && !isCancelled && (
            <>
              <button
                type="button"
                onClick={startEdit}
                className={ICON_BTN}
                title={t("salon.day.panel.editApt", lang)}
                data-testid="panel-edit"
                aria-label={t("salon.day.panel.editApt", lang)}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className={`${ICON_BTN} hover:!text-red-500`}
                title={t("salon.day.panel.deleteApt", lang)}
                data-testid="panel-delete"
                aria-label={t("salon.day.panel.deleteApt", lang)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className={ICON_BTN}
            title={t("common.close", lang)}
            aria-label={t("common.close", lang)}
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
            label={t("salon.day.panel.client", lang)}
            value={selected.userName ?? "—"}
            sub={selected.userPhone ?? channelLabel(selected.userTg)}
          />
          <DetailRow
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label={t("salon.day.panel.master", lang)}
            value={currentMaster?.name ?? `#${selected.masterId ?? "—"}`}
          />
          <DetailRow
            icon={<CalendarIcon className="h-3.5 w-3.5" />}
            label={t("salon.day.panel.date", lang)}
            value={selected.date}
            sub={selected.time}
          />
          <DetailRow
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label={t("salon.day.panel.service", lang)}
            value={svcDisplayName(currentService ?? undefined, lang)}
            sub={
              currentService
                ? `${currentService.duration} ${minLabel} · ${currentService.price}`
                : undefined
            }
          />
          {(isCancelled || isNoShow) && selected.cancelReason && (
            <div className="sm:col-span-2 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
              <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{selected.cancelReason}</span>
            </div>
          )}
        </div>
      )}

      {/* Edit mode: inline form */}
      {mode === "edit" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>{t("salon.day.panel.date", lang)}</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={FIELD_BASE}
              data-testid="panel-edit-date"
            />
          </div>
          <div>
            <label className={LABEL}>{t("salon.day.panel.time", lang)}</label>
            <input
              type="time"
              step={300}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={FIELD_BASE}
              data-testid="panel-edit-time"
            />
          </div>
          <div>
            <label className={LABEL}>{t("salon.day.panel.master", lang)}</label>
            <Select
              testIdPrefix="panel-edit-master"
              value={masterId == null ? "" : String(masterId)}
              onChange={(v) => setMasterId(v ? Number(v) : null)}
              options={masters.map((m) => ({
                value: String(m.chatId),
                label: m.name || `#${m.chatId}`,
              }))}
            />
          </div>
          <div>
            <label className={LABEL}>{t("salon.day.panel.service", lang)}</label>
            <Select
              testIdPrefix="panel-edit-service"
              value={svcId}
              onChange={setSvcId}
              options={services.map((s) => ({
                value: s.svcId,
                label: svcDisplayName(s, lang),
                sublabel: `${s.duration} ${minLabel} · ${s.price}`,
              }))}
            />
          </div>
        </div>
      )}

      {err && (
        <p
          className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300"
          data-testid="panel-error"
        >
          {err}
        </p>
      )}

      {/* Action row — varies by mode. Buttons stack into a 2-col grid on
          phones so each row remains a 44px+ tap target (sm:auto-flow lets
          them wrap normally above sm). */}
      {mode === "read" && !isCancelled && !isNoShow && !isDone && (
        <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-wrap">
          {isPending && (
            <button
              type="button"
              disabled={statusBusy}
              onClick={() =>
                confirmApt.mutate({ tenantId, id: String(selected.id) })
              }
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="panel-confirm"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {confirmApt.isPending
                ? t("salon.day.panel.confirmingApt", lang)
                : t("salon.day.panel.confirmApt", lang)}
            </button>
          )}
          {isConfirmed && (
            <button
              type="button"
              disabled={statusBusy || !canMarkDone}
              title={!canMarkDone ? t("salon.day.panel.doneNotYet", lang) : undefined}
              onClick={() =>
                markDoneMut.mutate({ tenantId, id: String(selected.id) })
              }
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-brand-500/15 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="panel-done"
              data-can-mark-done={canMarkDone ? "1" : "0"}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {markDoneMut.isPending
                ? t("salon.day.panel.markingDone", lang)
                : t("salon.day.panel.markDone", lang)}
            </button>
          )}
          <button
            type="button"
            disabled={statusBusy}
            onClick={() => markNoShow.mutate({ tenantId, id: String(selected.id), noShowBy: "client" })}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-orange-500/15 px-3 py-1.5 text-xs font-medium text-orange-700 dark:text-orange-300 hover:bg-orange-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="panel-client-no-show"
          >
            <UserX className="h-3.5 w-3.5" />
            {markNoShow.isPending && markNoShow.variables?.noShowBy === "client"
              ? t("salon.day.panel.markingNoShow", lang)
              : t("salon.day.panel.clientNoShow", lang)}
          </button>
          <button
            type="button"
            disabled={statusBusy}
            onClick={() => markNoShow.mutate({ tenantId, id: String(selected.id), noShowBy: "master" })}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-orange-500/15 px-3 py-1.5 text-xs font-medium text-orange-700 dark:text-orange-300 hover:bg-orange-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="panel-master-no-show"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {markNoShow.isPending && markNoShow.variables?.noShowBy === "master"
              ? t("salon.day.panel.markingNoShow", lang)
              : t("salon.day.panel.masterNoShow", lang)}
          </button>
        </div>
      )}

      {mode === "edit" && (
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={cancelEdit}
            disabled={update.isPending}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-100 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:hover:bg-white/[0.08] disabled:opacity-50"
            data-testid="panel-edit-cancel"
          >
            {t("common.cancel", lang)}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || update.isPending}
            className={
              !dirty || update.isPending
                ? "flex-1 rounded-lg bg-slate-200 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500"
                : "flex-1 rounded-lg py-2 text-xs font-semibold text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] transition hover:opacity-90"
            }
            style={
              !dirty || update.isPending
                ? undefined
                : { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }
            }
            data-testid="panel-edit-save"
          >
            {update.isPending
              ? t("salon.day.panel.saving", lang)
              : t("salon.day.panel.saveChanges", lang)}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("salon.day.panel.deleteAptTitle", lang)}
        description={t("salon.day.panel.deleteAptDesc", lang)}
        confirmLabel={t("common.delete", lang)}
        cancelLabel={t("common.cancel", lang)}
        tone="danger"
        busy={cancelApt.isPending}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
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
        <div className="text-[13px] font-medium text-slate-900 dark:text-white truncate">
          {value}
        </div>
        {sub && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{sub}</div>
        )}
      </div>
    </div>
  );
}
