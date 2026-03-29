"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Download,
  Filter,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  confirmed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  rejected: "text-red-400 bg-red-500/10 border-red-500/20",
  cancelled: "text-slate-400 bg-slate-700/30 border-slate-600/20",
  done: "text-brand-400 bg-brand-500/10 border-brand-500/20",
  counter_offer: "text-purple-400 bg-purple-500/10 border-purple-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидание",
  confirmed: "Подтверждено",
  rejected: "Отклонено",
  cancelled: "Отменено",
  done: "Выполнено",
  counter_offer: "Встречное",
};

const STATUS_FILTERS = [
  { key: "", label: "Все" },
  { key: "pending", label: "Ожидание" },
  { key: "confirmed", label: "✓ Подтв." },
  { key: "done", label: "Готово" },
  { key: "cancelled", label: "Отмена" },
  { key: "rejected", label: "Отклон." },
];

function downloadCSV(data: string, filename: string) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AppointmentsPageClient() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const LIMIT = 30;

  const utils = api.useUtils();

  const { data: stats } = api.appointments.getStats.useQuery({});
  const { data, isLoading } = api.appointments.getAll.useQuery({
    offset,
    limit: LIMIT,
    status: statusFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const updateStatus = api.appointments.updateStatus.useMutation({
    onSuccess: () => utils.appointments.getAll.invalidate(),
  });

  const exportQuery = api.export.appointments.useQuery(
    {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      format: "csv",
    },
    { enabled: false }
  );

  const handleExport = async () => {
    const res = await exportQuery.refetch();
    if (res.data) downloadCSV(res.data.data, res.data.filename);
  };

  const apts = data?.appointments ?? [];
  const total = data?.total ?? 0;
  const s = stats;

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Appointments</h1>
            <p className="text-xs text-slate-400 mt-1">{total} записей</p>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white px-3 py-2 text-xs font-medium rounded-xl transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>

        {/* Stats pills */}
        <div className="grid grid-cols-5 gap-1.5">
          {[
            { label: "Всего", value: s?.total ?? 0, color: "text-white" },
            { label: "Сегодня", value: s?.today ?? 0, color: "text-brand-400" },
            { label: "Ожидание", value: s?.pending ?? 0, color: "text-amber-400" },
            { label: "Подтверждено", value: s?.confirmed ?? 0, color: "text-emerald-400" },
            { label: "Отменено", value: s?.cancelled ?? 0, color: "text-slate-400" },
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
              onClick={() => {
                setStatusFilter(key);
                setOffset(0);
              }}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                statusFilter === key
                  ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                  : "bg-slate-800/60 text-slate-400 border border-transparent active:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date filter toggle */}
        <button
          onClick={() => setShowDateFilter(!showDateFilter)}
          className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-xl border transition-colors ${
            dateFrom || dateTo
              ? "bg-brand-500/10 text-brand-400 border-brand-500/30"
              : "bg-slate-800/40 text-slate-400 border-slate-700/40"
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          {dateFrom || dateTo ? `${dateFrom || "..."} — ${dateTo || "..."}` : "Фильтр по дате"}
        </button>

        {showDateFilter && (
          <div className="glass-card rounded-2xl p-4 space-y-3">
            <p className="text-xs text-slate-400 font-medium">Диапазон дат</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">От</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-brand-500/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">До</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-brand-500/50"
                />
              </div>
            </div>
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); setOffset(0); setShowDateFilter(false); }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Сбросить даты
            </button>
          </div>
        )}

        {/* Appointments list */}
        {isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : apts.length === 0 ? (
          <div className="glass-card rounded-2xl py-16 text-center">
            <p className="text-slate-500 text-sm">Нет записей</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {apts.map((apt) => {
              const statusKey = apt.cancelled ? "cancelled" : apt.status;
              return (
                <div key={apt.id} className="glass-card rounded-2xl p-4">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {apt.userName ?? apt.userTg ?? `#${apt.chatId}`}
                      </p>
                      {apt.userPhone && (
                        <p className="text-[11px] text-slate-400">{apt.userPhone}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${
                        STATUS_COLORS[statusKey] ?? ""
                      }`}
                    >
                      {STATUS_LABELS[statusKey] ?? statusKey}
                    </span>
                  </div>

                  {/* Info row */}
                  <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-border/30">
                    <div className="flex items-center gap-1 text-xs text-slate-300">
                      <Calendar className="w-3 h-3 text-slate-500" />
                      {apt.date}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-300">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {apt.time}
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono truncate flex-1">
                      {apt.svcId}
                    </span>

                    {/* Action buttons — always visible */}
                    {apt.status === "pending" && !apt.cancelled && (
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() =>
                            updateStatus.mutate({ id: apt.id, status: "confirmed" })
                          }
                          disabled={updateStatus.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/15 active:bg-emerald-500/30 rounded-lg text-emerald-400 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Ок
                        </button>
                        <button
                          onClick={() =>
                            updateStatus.mutate({ id: apt.id, status: "rejected" })
                          }
                          disabled={updateStatus.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/15 active:bg-red-500/30 rounded-lg text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Нет
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Tenant id */}
                  <p className="text-[9px] text-slate-700 font-mono mt-1.5 truncate">
                    {apt.tenantId}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-400">
              {offset + 1}–{Math.min(offset + LIMIT, total)} из {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 text-xs disabled:opacity-30 active:bg-slate-700"
              >
                <ChevronLeft className="w-4 h-4" />
                Назад
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 text-xs disabled:opacity-30 active:bg-slate-700"
              >
                Вперёд
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
