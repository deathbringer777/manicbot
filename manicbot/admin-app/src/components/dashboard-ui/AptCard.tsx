"use client";

import { t, type Lang } from "~/lib/i18n";
import { APT_BORDER } from "~/lib/appointments";
import { STATUS_STYLES } from "~/lib/appointments";
import { StatusActionMenu } from "~/components/dashboard-ui/StatusActionMenu";

export { APT_BORDER, STATUS_STYLES };

const NO_SHOW_LABELS: Record<string, string> = {
  client: "Клиент не пришёл",
  master: "Мастер не пришёл",
};

const CANCELLED_BY_LABELS: Record<string, string> = {
  client: "Отменено клиентом",
  master: "Отменено мастером",
  admin: "Отменено администратором",
  system: "Отменено системой",
};

export function AptCard({ a, lang, onAction, onNoShow }: {
  a: any; lang: Lang;
  onAction?: (id: any, status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow?: (id: any, noShowBy: "client" | "master") => void;
}) {
  const [hh, mm] = (a.time ?? "00:00").split(":");
  const statusKey = a.noShow ? "no_show" : a.cancelled ? "cancelled" : a.status;
  const border = APT_BORDER[statusKey] ?? "border-l-slate-700";
  const isTerminal = a.cancelled || a.noShow || a.status === "rejected" || a.status === "done";
  const nameWords = (a.userName ?? "?").trim().split(/\s+/);
  const initials = nameWords.length >= 2
    ? (nameWords[0]![0]! + nameWords[1]![0]!).toUpperCase()
    : (a.userName ?? "?").slice(0, 2).toUpperCase();

  const statusLabel =
    statusKey === "no_show"
      ? (NO_SHOW_LABELS[a.noShowBy] ?? "Не пришёл")
      : statusKey === "cancelled" && a.cancelledBy
        ? (CANCELLED_BY_LABELS[a.cancelledBy] ?? t(`status.${a.status}` as any, lang))
        : t(`status.${a.status}` as any, lang);

  return (
    <div
      className={`glass-card rounded-xl border-l-2 ${border} transition ${
        isTerminal ? "opacity-50" : ""
      }`}
      data-testid="apt-card"
      data-status={statusKey}
      data-terminal={isTerminal ? "1" : "0"}
    >
      <div className="p-3 flex items-start gap-3">
        <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-500/20 flex items-center justify-center text-[11px] font-bold text-brand-400 mt-0.5">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white text-sm leading-tight truncate">{a.userName ?? `#${a.chatId}`}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{a.serviceName ?? a.svcId}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-bold text-slate-900 dark:text-white tabular-nums leading-none">
                {hh}<span className="text-slate-500 font-normal text-sm">:{mm ?? "00"}</span>
              </p>
              <StatusActionMenu
                statusKey={statusKey}
                label={statusLabel}
                lang={lang}
                onAction={onAction ? (status) => onAction(a.id, status) : undefined}
                onNoShow={onNoShow ? (by) => onNoShow(a.id, by) : undefined}
              />
            </div>
          </div>
          {a.cancelReason && (statusKey === "cancelled" || statusKey === "no_show") && (
            <p className="text-[10px] text-slate-400 mt-1 truncate">
              {a.cancelReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
