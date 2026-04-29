"use client";

import { CalendarDays, Loader2, UserX, AlertTriangle, Clock, CheckCircle2, XCircle } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { STATUS_LABELS, APT_BORDER } from "~/lib/appointments";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  pending: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  cancelled: "bg-red-500/20 text-red-400 border border-red-500/30",
  no_show: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  done: "bg-brand-500/20 text-brand-400 border border-brand-500/30",
};

const NO_SHOW_LABELS: Record<string, string> = {
  client: "Клиент не пришёл",
  master: "Мастер не пришёл",
};

const CANCELLED_BY_LABELS: Record<string, string> = {
  client: "Отменено клиентом",
  master: "Отменено мастером",
  admin: "Отменено админом",
};

function AptRow({ apt, onNoShow }: { apt: any; onNoShow?: (id: any, noShowBy: "client") => void }) {
  const [hh, mm] = (apt.time ?? "00:00").split(":");
  const nameWords = (apt.userName ?? "?").trim().split(/\s+/);
  const initials = nameWords.length >= 2
    ? (nameWords[0]![0]! + nameWords[1]![0]!).toUpperCase()
    : (apt.userName ?? "?").slice(0, 2).toUpperCase();
  const statusKey = apt.noShow ? "no_show" : apt.cancelled ? "cancelled" : apt.status;
  const border = APT_BORDER[statusKey] ?? "border-l-slate-700";
  const statusLabel = statusKey === "no_show"
    ? (NO_SHOW_LABELS[apt.noShowBy] ?? "Не пришёл")
    : statusKey === "cancelled" && apt.cancelledBy
      ? (CANCELLED_BY_LABELS[apt.cancelledBy] ?? STATUS_LABELS[apt.status] ?? apt.status)
      : (STATUS_LABELS[apt.status] ?? apt.status);

  return (
    <div className={`glass-card rounded-xl border-l-2 ${border} overflow-hidden`}>
      <div className="p-3 flex items-start gap-3">
        <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-500/20 flex items-center justify-center text-[11px] font-bold text-brand-400 mt-0.5">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white text-sm leading-tight truncate">{apt.userName ?? `#${apt.chatId}`}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{apt.svcId}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-bold text-slate-900 dark:text-white tabular-nums leading-none">
                {hh}<span className="text-slate-500 font-normal text-sm">:{mm ?? "00"}</span>
              </p>
              <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-1 ${STATUS_STYLES[statusKey] ?? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                {statusLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
      {onNoShow && apt.status === "confirmed" && !apt.cancelled && !apt.noShow && (
        <div className="flex border-t border-slate-200 dark:border-white/5">
          <button onClick={() => onNoShow(apt.id, "client")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-orange-400/70 text-xs font-medium hover:bg-orange-500/10 transition-colors">
            <UserX className="h-3.5 w-3.5" /> Клиент не пришёл
          </button>
        </div>
      )}
    </div>
  );
}

export function TodayTab({ tenantId, masterId, canMutate = true }: {
  tenantId: string; masterId: number; canMutate?: boolean;
}) {
  const { lang } = useLang();
  const today = api.master.getMySchedule.useQuery({ tenantId, masterId });
  const markNoShowMut = api.master.markNoShow.useMutation({
    onSuccess: () => { today.refetch(); },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t("common.today", lang)}</h2>
      {today.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {today.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}

      {!today.isLoading && today.data && (() => {
        const apts = today.data as any[];
        const total = apts.length;
        const confirmed = apts.filter((a: any) => a.status === "confirmed").length;
        const pending = apts.filter((a: any) => a.status === "pending").length;
        return (
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("master.totalToday", lang)}</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{total}</p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[11px] text-emerald-400">{t("master.confirmed", lang)}</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{confirmed}</p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[11px] text-amber-400">{t("master.pending", lang)}</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{pending}</p>
            </div>
          </div>
        );
      })()}

      {today.data?.length === 0 && (
        <div className="glass-card rounded-2xl p-8 text-center">
          <CalendarDays className="h-12 w-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">{t("master.noSchedule", lang)}</p>
        </div>
      )}
      <div className="space-y-2">
        {today.data?.map((a: any) => (
          <AptRow key={a.id} apt={a}
            onNoShow={canMutate
              ? (id, noShowBy) => markNoShowMut.mutate({ tenantId, id: String(id), noShowBy })
              : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
