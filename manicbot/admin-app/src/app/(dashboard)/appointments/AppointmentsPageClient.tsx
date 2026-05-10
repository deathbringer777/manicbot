"use client";

import { useMemo, useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { PageHeader } from "~/components/ui/PageHeader";
import { EmptyState } from "~/components/ui/EmptyState";
import { SkeletonCard } from "~/components/ui/Skeleton";
import {
  Calendar,
  CalendarDays,
  Clock,
  CheckCircle,
  XCircle,
  Download,
  Filter,
  ChevronLeft,
  ChevronRight,
  List,
  X,
} from "lucide-react";
import { STATUS_LABELS } from "~/lib/appointments";
import { useLang } from "~/components/LangContext";
import { t, localeFor, type Lang } from "~/lib/i18n";
import { MonthCalendar } from "~/components/calendar/MonthCalendar";

const STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  confirmed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  rejected: "text-red-400 bg-red-500/10 border-red-500/20",
  cancelled: "text-slate-400 bg-slate-700/30 border-slate-600/20",
  done: "text-brand-400 bg-brand-500/10 border-brand-500/20",
  counter_offer: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  no_show: "text-orange-400 bg-orange-500/10 border-orange-500/20",
};

function getNoShowLabels(lang: Lang): Record<string, string> {
  return {
    client: t("gmAppts.noShowClient", lang),
    master: t("gmAppts.noShowMaster", lang),
  };
}

function getCancelledByLabels(lang: Lang): Record<string, string> {
  return {
    client: t("gmAppts.byClient", lang),
    master: t("gmAppts.byMaster", lang),
    admin: t("gmAppts.byAdmin", lang),
    system: t("gmAppts.bySystem", lang),
  };
}

function getStatusFilters(lang: Lang) {
  return [
    { key: "", label: t("gmAppts.statusAll", lang) },
    { key: "pending", label: t("gmAppts.statusPending", lang) },
    { key: "confirmed", label: t("gmAppts.statusConfirmed", lang) },
    { key: "done", label: t("gmAppts.statusDone", lang) },
    { key: "cancelled", label: t("gmAppts.statusCancelled", lang) },
    { key: "no_show", label: t("gmAppts.statusNoShow", lang) },
    { key: "rejected", label: t("gmAppts.statusRejected", lang) },
  ];
}

function fmtISO(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function downloadCSV(data: string, filename: string) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Types ─────────────────────────────────────────────────────────────────

type Appointment = {
  id: string;
  tenantId: string;
  chatId: number;
  svcId: string;
  date: string;
  time: string;
  ts: number;
  status: string;
  masterId: number | null;
  confirmedBy: number | null;
  userName: string | null;
  userPhone: string | null;
  userTg: string | null;
  cancelled: number;
  cancelledBy: string | null;
  cancelledAt: number | null;
  noShow: number | null;
  noShowBy: string | null;
  rejectComment: string | null;
  cancelReason: string | null;
  createdAt: number;
  googleEventId: string | null;
  googleCalendarId: string | null;
  googleIntegrationId: string | null;
  remH24: number | null;
  remH2: number | null;
  counterTime: string | null;
  counterComment: string | null;
};

// ─── AptCard ───────────────────────────────────────────────────────────────

function AptCard({
  apt,
  onConfirm,
  onReject,
  isPending,
}: {
  apt: Appointment;
  onConfirm: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  const { lang } = useLang();
  const noShowLabels = getNoShowLabels(lang);
  const cancelledByLabels = getCancelledByLabels(lang);
  const statusKey = apt.noShow ? "no_show" : apt.cancelled ? "cancelled" : apt.status;
  const statusLabel = statusKey === "no_show"
    ? (noShowLabels[apt.noShowBy ?? ""] ?? t("gmAppts.noShowDefault", lang))
    : statusKey === "cancelled" && apt.cancelledBy
      ? `${STATUS_LABELS[statusKey]} (${cancelledByLabels[apt.cancelledBy] ?? apt.cancelledBy})`
      : (STATUS_LABELS[statusKey] ?? statusKey);
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {apt.userName ?? apt.userTg ?? `#${apt.chatId}`}
          </p>
          {apt.userPhone && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{apt.userPhone}</p>
          )}
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${STATUS_COLORS[statusKey] ?? ""}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-border/30">
        <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
          <Calendar className="w-3 h-3 text-slate-500" />
          {apt.date}
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
          <Clock className="w-3 h-3 text-slate-500" />
          {apt.time}
        </div>
        <span className="text-[10px] text-slate-500 font-mono truncate flex-1">
          {apt.svcId}
        </span>

        {apt.status === "pending" && !apt.cancelled && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/15 active:bg-emerald-500/30 rounded-lg text-emerald-400 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {t("gmAppts.confirmYes", lang)}
            </button>
            <button
              onClick={onReject}
              disabled={isPending}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/15 active:bg-red-500/30 rounded-lg text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              {t("gmAppts.confirmNo", lang)}
            </button>
          </div>
        )}
      </div>

      <p className="text-[9px] text-slate-700 font-mono mt-1.5 truncate">
        {apt.tenantId}
      </p>
    </div>
  );
}

// ─── SelectedDayPanel ──────────────────────────────────────────────────────

function SelectedDayPanel({
  iso,
  apts,
  onClose,
  onConfirm,
  onReject,
  mutPending,
}: {
  iso: string;
  apts: Appointment[];
  onClose: () => void;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  mutPending: boolean;
}) {
  const { lang } = useLang();
  const label = new Date(iso + "T12:00:00").toLocaleDateString(localeFor(lang), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white capitalize">{label}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {apts.length} {apts.length === 1 ? t("gmAppts.aptOne", lang) : apts.length < 5 ? t("gmAppts.aptFew", lang) : t("gmAppts.aptMany", lang)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {apts.length === 0 ? (
        <p className="text-sm text-slate-500 py-4 text-center">{t("gmAppts.noApts", lang)}</p>
      ) : (
        <div className="space-y-2.5">
          {apts
            .slice()
            .sort((a, b) => (a.time > b.time ? 1 : -1))
            .map((apt) => (
              <AptCard
                key={apt.id}
                apt={apt}
                onConfirm={() => onConfirm(apt.id)}
                onReject={() => onReject(apt.id)}
                isPending={mutPending}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export default function AppointmentsPageClient() {
  const { lang } = useLang();
  const STATUS_FILTERS = getStatusFilters(lang);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");

  // Calendar state
  const [calViewDate, setCalViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // List state
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const LIMIT = 30;

  const utils = api.useUtils();

  // ── Calendar data ──
  const calYear = calViewDate.getFullYear();
  const calMonth = calViewDate.getMonth();
  const calDateFrom = fmtISO(calYear, calMonth, 1);
  const calDateTo = fmtISO(calYear, calMonth, new Date(calYear, calMonth + 1, 0).getDate());

  const { data: calData, isFetching: calLoading } = api.appointments.getAll.useQuery(
    { dateFrom: calDateFrom, dateTo: calDateTo, limit: 300 },
    { enabled: viewMode === "calendar" }
  );

  // ── List data ──
  const { data: stats } = api.appointments.getStats.useQuery({});
  const { data: listData, isLoading: listLoading } = api.appointments.getAll.useQuery(
    {
      offset,
      limit: LIMIT,
      status: statusFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { enabled: viewMode === "list" }
  );

  const updateStatus = api.appointments.updateStatus.useMutation({
    onSuccess: () => {
      void utils.appointments.getAll.invalidate();
    },
  });

  const exportQuery = api.export.appointments.useQuery(
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, format: "csv" },
    { enabled: false }
  );

  const handleExport = async () => {
    const res = await exportQuery.refetch();
    if (res.data) downloadCSV(res.data.data, res.data.filename);
  };

  const calApts = calData?.appointments ?? [];
  const listApts = listData?.appointments ?? [];
  const total = listData?.total ?? 0;
  const s = stats;

  // Appointments for selected day
  const dayApts = useMemo(
    () => (selectedDay ? calApts.filter((a) => a.date === selectedDay) : []),
    [selectedDay, calApts]
  );

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <PageHeader
            title="Appointments"
            subtitle={viewMode === "list" ? `${total} total` : undefined}
          />
          <div className="flex items-center gap-2 pt-1">
            {viewMode === "list" && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:bg-slate-600 text-slate-900 dark:text-white px-3 py-2 text-xs font-medium rounded-xl transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            )}
            {/* View toggle */}
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 gap-0.5">
              <button
                onClick={() => setViewMode("calendar")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  viewMode === "calendar"
                    ? "bg-brand-500/20 text-brand-400"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-200"
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                {t("gmAppts.calendarBtn", lang)}
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  viewMode === "list"
                    ? "bg-brand-500/20 text-brand-400"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-200"
                }`}
              >
                <List className="w-3.5 h-3.5" />
                {t("gmAppts.listBtn", lang)}
              </button>
            </div>
          </div>
        </div>

        {/* ── Calendar view ── */}
        {viewMode === "calendar" && (
          <>
            <MonthCalendar
              apts={calApts}
              viewDate={calViewDate}
              setViewDate={(d) => { setCalViewDate(d); setSelectedDay(null); }}
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
              isLoading={calLoading}
              lang={lang}
            />

            {selectedDay && (
              <SelectedDayPanel
                iso={selectedDay}
                apts={dayApts}
                onClose={() => setSelectedDay(null)}
                onConfirm={(id) => updateStatus.mutate({ id, status: "confirmed" })}
                onReject={(id) => updateStatus.mutate({ id, status: "rejected" })}
                mutPending={updateStatus.isPending}
              />
            )}
          </>
        )}

        {/* ── List view ── */}
        {viewMode === "list" && (
          <>
            {/* Stats pills */}
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { label: t("gmAppts.statTotal", lang), value: s?.total ?? 0, color: "text-slate-900 dark:text-white" },
                { label: t("gmAppts.statToday", lang), value: s?.today ?? 0, color: "text-brand-400" },
                { label: t("gmAppts.statPending", lang), value: s?.pending ?? 0, color: "text-amber-400" },
                { label: t("gmAppts.statConfirmed", lang), value: s?.confirmed ?? 0, color: "text-emerald-400" },
                { label: t("gmAppts.statCancelled", lang), value: s?.cancelled ?? 0, color: "text-slate-500 dark:text-slate-400" },
              ].map((stat) => (
                <div key={stat.label} className="glass-card rounded-xl p-2.5 text-center">
                  <div className={`text-lg font-extrabold ${stat.color}`}>{stat.value}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5 leading-tight">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Status filter chips */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {STATUS_FILTERS.map(({ key, label }) => (
                <button
                  key={key || "all"}
                  onClick={() => { setStatusFilter(key); setOffset(0); }}
                  className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                    statusFilter === key
                      ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                      : "bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border border-transparent active:bg-slate-200 dark:active:bg-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Date filter */}
            <button
              onClick={() => setShowDateFilter(!showDateFilter)}
              className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-xl border transition-colors ${
                dateFrom || dateTo
                  ? "bg-brand-500/10 text-brand-400 border-brand-500/30"
                  : "bg-slate-50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/40"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              {dateFrom || dateTo ? `${dateFrom || "..."} — ${dateTo || "..."}` : t("gmAppts.dateFilter", lang)}
            </button>

            {showDateFilter && (
              <div className="glass-card rounded-2xl p-4 space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t("gmAppts.dateRange", lang)}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">{t("gmAppts.from", lang)}</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-brand-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">{t("gmAppts.to", lang)}</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-brand-500/50"
                    />
                  </div>
                </div>
                <button
                  onClick={() => { setDateFrom(""); setDateTo(""); setOffset(0); setShowDateFilter(false); }}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {t("gmAppts.resetDates", lang)}
                </button>
              </div>
            )}

            {/* List */}
            {listLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={3} />)}
              </div>
            ) : listApts.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title="No appointments found"
                description={statusFilter ? "No appointments match this status filter. Try clearing the filter." : "Appointments will appear here once clients start booking."}
              />
            ) : (
              <div className="space-y-2.5">
                {listApts.map((apt) => (
                  <AptCard
                    key={apt.id}
                    apt={apt}
                    onConfirm={() => updateStatus.mutate({ id: apt.id, status: "confirmed" })}
                    onReject={() => updateStatus.mutate({ id: apt.id, status: "rejected" })}
                    isPending={updateStatus.isPending}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {total > LIMIT && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {offset + 1}–{Math.min(offset + LIMIT, total)} {t("gmAppts.ofPagination", lang)} {total}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                    disabled={offset === 0}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs disabled:opacity-30 active:bg-slate-200 dark:active:bg-slate-700"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t("gmAppts.prev", lang)}
                  </button>
                  <button
                    onClick={() => setOffset(offset + LIMIT)}
                    disabled={offset + LIMIT >= total}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs disabled:opacity-30 active:bg-slate-200 dark:active:bg-slate-700"
                  >
                    {t("gmAppts.next", lang)}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
