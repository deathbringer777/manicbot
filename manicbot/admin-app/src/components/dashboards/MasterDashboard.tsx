"use client";

import { useState } from "react";
import { CalendarDays, Users, TrendingUp, User, Loader2, Clock } from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

type Tab = "today" | "schedule" | "clients" | "earnings" | "profile";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  pending: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  cancelled: "bg-red-500/20 text-red-400 border border-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Подтверждено",
  pending: "Ожидает",
  cancelled: "Отменено",
};

type Period = "week" | "month" | "year";

const PERIOD_LABELS: Record<Period, string> = {
  week: "Неделя",
  month: "Месяц",
  year: "Год",
};

function getPeriodDates(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now);
  if (period === "week") from.setDate(from.getDate() - 7);
  if (period === "month") from.setMonth(from.getMonth() - 1);
  if (period === "year") from.setFullYear(from.getFullYear() - 1);
  return { from: from.toISOString().slice(0, 10), to };
}

function AptRow({ apt }: { apt: any }) {
  return (
    <div className="glass-card rounded-xl p-3 flex items-center gap-3">
      <div className="flex-col flex-1 min-w-0">
        <p className="font-medium text-white text-sm truncate">{apt.userName ?? `#${apt.chatId}`}</p>
        <p className="text-xs text-slate-400">{apt.svcId} · {apt.time}</p>
      </div>
      <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[apt.status] ?? "bg-slate-700 text-slate-300"}`}>
        {STATUS_LABELS[apt.status] ?? apt.status}
      </span>
    </div>
  );
}

export function MasterDashboard({ tenantId, masterId }: { tenantId: string; masterId: number }) {
  const { lang } = useLang();
  const [tab, setTab] = useState<Tab>("today");
  const [period, setPeriod] = useState<Period>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const masterNavItems: NavItem[] = [
    { href: "#today", icon: CalendarDays, label: t("master.today", lang) },
    { href: "#schedule", icon: Clock, label: t("master.schedule", lang) },
    { href: "#clients", icon: Users, label: t("master.clients", lang) },
    { href: "#earnings", icon: TrendingUp, label: t("master.earnings", lang) },
    { href: "#profile", icon: User, label: t("master.profile", lang) },
  ];

  const today = api.master.getMySchedule.useQuery(
    { tenantId, masterId },
    { enabled: tab === "today" }
  );
  const schedule = api.master.getMyAppointments.useQuery(
    { tenantId, masterId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { enabled: tab === "schedule" }
  );
  const clientsList = api.master.getMyClients.useQuery(
    { tenantId, masterId },
    { enabled: tab === "clients" }
  );
  const { from, to } = getPeriodDates(period);
  const earnings = api.master.getMyEarnings.useQuery(
    { tenantId, masterId, dateFrom: from, dateTo: to },
    { enabled: tab === "earnings" }
  );
  const profile = api.master.getMyProfile.useQuery(
    { tenantId, masterId },
    { enabled: tab === "profile" }
  );

  const tabLabels: Record<Tab, string> = {
    today: t("master.today", lang),
    schedule: t("master.schedule", lang),
    clients: t("master.clients", lang),
    earnings: t("master.earnings", lang),
    profile: t("master.profile", lang),
  };

  return (
    <Shell navItems={masterNavItems} title={t("master.title", lang)} subtitle="ManicBot Master">
      {/* Tab bar */}
      <div className="flex overflow-x-auto scrollbar-none gap-1 mb-6 pb-1">
        {(["today", "schedule", "clients", "earnings", "profile"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              tab === t
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {/* TODAY */}
      {tab === "today" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("common.today", lang)}</h2>
          {today.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {today.data?.length === 0 && (
            <div className="glass-card rounded-2xl p-8 text-center">
              <CalendarDays className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">{t("master.noSchedule", lang)}</p>
            </div>
          )}
          <div className="space-y-2">
            {today.data?.map((a: any) => (
              <div key={a.id} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="flex items-center justify-center h-10 w-14 rounded-lg bg-brand-500/10 text-brand-400 text-sm font-bold shrink-0">
                  {a.time}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm truncate">{a.userName ?? `#${a.chatId}`}</p>
                  <p className="text-xs text-slate-400">{a.svcId}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[a.status] ?? "bg-slate-700 text-slate-300"}`}>
                  {STATUS_LABELS[a.status] ?? a.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SCHEDULE */}
      {tab === "schedule" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-white flex-1">{t("master.allApts", lang)}</h2>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-1.5" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-1.5" />
          </div>
          {schedule.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {schedule.data?.map((a: any) => (
              <div key={a.id} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="text-xs text-slate-400 w-20 shrink-0">{a.date} {a.time}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm truncate">{a.userName ?? `#${a.chatId}`}</p>
                  <p className="text-[10px] text-slate-500">{a.svcId}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[a.status] ?? "bg-slate-700 text-slate-300"}`}>
                  {STATUS_LABELS[a.status] ?? a.status}
                </span>
              </div>
            ))}
            {schedule.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("master.noApts", lang)}</p>}
          </div>
        </div>
      )}

      {/* CLIENTS */}
      {tab === "clients" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("master.myClients", lang)}</h2>
          {clientsList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {clientsList.data?.map((c: any) => (
              <div key={c.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-300 shrink-0">
                  {(c.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm">{c.name ?? `#${c.chatId}`}</p>
                  {c.lastAppointment && (
                    <p className="text-[10px] text-slate-500">
                      {t("master.lastApt", lang)} {c.lastAppointment.date}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {clientsList.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("master.noClients", lang)}</p>}
          </div>
        </div>
      )}

      {/* EARNINGS */}
      {tab === "earnings" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white flex-1">{t("master.earningsTitle", lang)}</h2>
            <div className="flex gap-1">
              {(["week", "month", "year"] as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    period === p ? "bg-brand-500/20 text-brand-400 border border-brand-500/30" : "text-slate-500"
                  }`}>
                  {t(`master.${p}` as any, lang)}
                </button>
              ))}
            </div>
          </div>
          {earnings.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {earnings.data && (
            <div className="space-y-3">
              <div className="glass-card rounded-2xl p-6 text-center">
                <p className="text-xs text-slate-500 mb-1">{t(`master.${period}Earnings` as any, lang)}</p>
                <p className="text-4xl font-bold text-white mb-1">
                  {earnings.data.total.toLocaleString(lang === "en" ? "en" : "ru")} <span className="text-2xl text-slate-400">₴</span>
                </p>
                <p className="text-sm text-slate-400">{earnings.data.count} {t("master.confirmedApts", lang)}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PROFILE */}
      {tab === "profile" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("master.profile", lang)}</h2>
          {profile.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {profile.data && (
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white">
                  {(profile.data.name ?? "M").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xl font-bold text-white">{profile.data.name ?? "Мастер"}</p>
                  <p className="text-xs text-slate-500">ID: {profile.data.chatId}</p>
                </div>
              </div>
              <p className="text-xs text-slate-600">{t("master.profileHint", lang)}</p>
            </div>
          )}
          {!profile.isLoading && !profile.data && (
            <p className="text-slate-500 text-sm text-center py-8">{t("master.noProfile", lang)}</p>
          )}
        </div>
      )}
    </Shell>
  );
}
