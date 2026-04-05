"use client";

import { CheckCircle2, XCircle, UserX, AlertTriangle } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";

// ─── Status style maps ───────────────────────────────────────────
export const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  pending: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  cancelled: "bg-red-500/15 text-red-400 border border-red-500/20",
  rejected: "bg-red-500/15 text-red-400 border border-red-500/20",
  no_show: "bg-orange-500/15 text-orange-400 border border-orange-500/20",
  done: "bg-brand-500/15 text-brand-400 border border-brand-500/20",
};

export const APT_BORDER: Record<string, string> = {
  confirmed: "border-l-emerald-500",
  pending:   "border-l-amber-400",
  cancelled: "border-l-red-500/40",
  rejected:  "border-l-red-500/40",
  no_show:   "border-l-orange-500/40",
  done:      "border-l-brand-500",
};

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

// ─── StatCard ────────────────────────────────────────────────────
export function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-4 relative overflow-hidden">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
          {sub && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── AptCard ─────────────────────────────────────────────────────
export function AptCard({ a, lang, onAction, onNoShow }: {
  a: any; lang: Lang;
  onAction?: (id: any, status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow?: (id: any, noShowBy: "client" | "master") => void;
}) {
  const [hh, mm] = (a.time ?? "00:00").split(":");
  const statusKey = a.noShow ? "no_show" : a.cancelled ? "cancelled" : a.status;
  const border = APT_BORDER[statusKey] ?? "border-l-slate-700";
  const nameWords = (a.userName ?? "?").trim().split(/\s+/);
  const initials = nameWords.length >= 2
    ? (nameWords[0]![0]! + nameWords[1]![0]!).toUpperCase()
    : (a.userName ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className={`glass-card rounded-xl border-l-2 ${border} overflow-hidden`}>
      <div className="p-3 flex items-start gap-3">
        <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-500/20 flex items-center justify-center text-[11px] font-bold text-brand-400 mt-0.5">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white text-sm leading-tight truncate">{a.userName ?? `#${a.chatId}`}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{a.svcId}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-bold text-slate-900 dark:text-white tabular-nums leading-none">
                {hh}<span className="text-slate-500 font-normal text-sm">:{mm ?? "00"}</span>
              </p>
              <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-1 ${STATUS_STYLES[statusKey] ?? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                {statusKey === "no_show"
                  ? (NO_SHOW_LABELS[a.noShowBy] ?? "Не пришёл")
                  : statusKey === "cancelled" && a.cancelledBy
                    ? (CANCELLED_BY_LABELS[a.cancelledBy] ?? t(`status.${a.status}` as any, lang))
                    : t(`status.${a.status}` as any, lang)}
              </span>
            </div>
          </div>
          {/* Cancellation / no-show details */}
          {a.cancelReason && (statusKey === "cancelled" || statusKey === "no_show") && (
            <p className="text-[10px] text-slate-400 mt-1 truncate">
              {a.cancelReason}
            </p>
          )}
        </div>
      </div>
      {onAction && a.status === "pending" && !a.cancelled && !a.noShow && (
        <div className="flex border-t border-slate-200 dark:border-white/5">
          <button onClick={() => onAction(a.id, "confirmed")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/10 transition-colors">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t("action.confirm", lang)}
          </button>
          <div className="w-px bg-slate-200 dark:bg-white/5" />
          <button onClick={() => onAction(a.id, "rejected")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors">
            <XCircle className="h-3.5 w-3.5" /> {t("action.reject", lang)}
          </button>
        </div>
      )}
      {a.status === "confirmed" && !a.cancelled && !a.noShow && (
        <div className="flex border-t border-slate-200 dark:border-white/5">
          {onAction && (
            <>
              <button onClick={() => onAction(a.id, "cancelled")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-red-400/60 text-xs font-medium hover:bg-red-500/10 transition-colors">
                <XCircle className="h-3.5 w-3.5" /> {t("action.cancel", lang)}
              </button>
              <div className="w-px bg-slate-200 dark:bg-white/5" />
            </>
          )}
          {onNoShow && (
            <>
              <button onClick={() => onNoShow(a.id, "client")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-orange-400/70 text-xs font-medium hover:bg-orange-500/10 transition-colors">
                <UserX className="h-3.5 w-3.5" /> Клиент не пришёл
              </button>
              <div className="w-px bg-slate-200 dark:bg-white/5" />
              <button onClick={() => onNoShow(a.id, "master")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-orange-400/70 text-xs font-medium hover:bg-orange-500/10 transition-colors">
                <AlertTriangle className="h-3.5 w-3.5" /> Мастер не пришёл
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SectionHeader ───────────────────────────────────────────────
export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
      {action}
    </div>
  );
}

// ─── Btn ─────────────────────────────────────────────────────────
export function Btn({ children, onClick, variant = "primary", disabled, className = "" }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger";
  disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-brand-500/20 text-brand-400 border border-brand-500/30 hover:bg-brand-500/30",
    ghost: "bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10",
    danger: "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-40 flex items-center gap-1.5 ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}

// ─── Input ───────────────────────────────────────────────────────
export function Input({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-400 dark:placeholder:text-slate-600" />
    </div>
  );
}
