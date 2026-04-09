"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Users, TrendingUp, User, Loader2, Clock, Pencil, X, Save, Star, UserX, Eye, Lock, Unlock, Scissors, Plus, Trash2, Settings } from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useInWebShell } from "~/components/layout/WebShell";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

type Tab = "today" | "schedule" | "clients" | "earnings" | "reviews" | "services" | "profile";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  pending: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  cancelled: "bg-red-500/20 text-red-400 border border-red-500/30",
  no_show: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  done: "bg-brand-500/20 text-brand-400 border border-brand-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Подтверждено",
  pending: "Ожидает",
  cancelled: "Отменено",
  no_show: "Не пришёл",
  done: "Выполнено",
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

const APT_BORDER: Record<string, string> = {
  confirmed: "border-l-emerald-500",
  pending:   "border-l-amber-400",
  cancelled: "border-l-red-500/40",
  no_show:   "border-l-orange-500/40",
  done:      "border-l-brand-500",
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
      <div className="p-3 flex items-center gap-3">
        <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-500/20 flex items-center justify-center text-[11px] font-bold text-brand-400">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white text-sm leading-tight truncate">{apt.userName ?? `#${apt.chatId}`}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{apt.svcId}</p>
          {apt.cancelReason && (statusKey === "cancelled" || statusKey === "no_show") && (
            <p className="text-[10px] text-slate-400 mt-0.5 truncate">{apt.cancelReason}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold text-slate-900 dark:text-white tabular-nums leading-none">
            {hh}<span className="text-slate-500 font-normal text-sm">:{mm ?? "00"}</span>
          </p>
          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-1 ${STATUS_STYLES[statusKey] ?? "bg-slate-700 text-slate-300"}`}>
            {statusLabel}
          </span>
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

export function MasterDashboard({
  tenantId,
  masterId,
  isDelegating = false,
  isPersonal = false,
}: {
  tenantId: string;
  masterId: number;
  isDelegating?: boolean;
  isPersonal?: boolean;
}) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const searchParams = useSearchParams();
  const inWeb = useInWebShell();

  const VALID_TABS: Tab[] = ["today", "schedule", "clients", "earnings", "reviews", "services", "profile"];
  const urlTab = searchParams.get("tab");
  const resolvedTab: Tab = urlTab && VALID_TABS.includes(urlTab as Tab) ? (urlTab as Tab) : "today";

  const [tab, setTab] = useState<Tab>(resolvedTab);

  // Sync tab when URL changes (sidebar click in WebShell)
  useEffect(() => {
    if (inWeb) setTab(resolvedTab);
  }, [resolvedTab, inWeb]);
  const [period, setPeriod] = useState<Period>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const masterNavItems: NavItem[] = [
    { href: "#today", icon: CalendarDays, label: t("master.today", lang) },
    { href: "#schedule", icon: Clock, label: t("master.schedule", lang) },
    { href: "#clients", icon: Users, label: t("master.clients", lang) },
    { href: "#earnings", icon: TrendingUp, label: t("master.earnings", lang) },
    ...(isPersonal ? [{ href: "#services", icon: Scissors, label: t("master.services", lang) }] : []),
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
    { enabled: tab === "profile" || isDelegating }
  );
  const masterReviews = api.reviews.getForSalon.useQuery(
    { tenantId, masterId: String(masterId) },
    { enabled: tab === "reviews" }
  );
  const masterRevStats = api.reviews.getStats.useQuery(
    { tenantId, masterId: String(masterId) },
    { enabled: tab === "reviews" }
  );
  // Services queries (independent masters only)
  const svcList = api.master.getMyServices.useQuery(
    { tenantId },
    { enabled: isPersonal && tab === "services" }
  );
  const [svcForm, setSvcForm] = useState<{ names: string; price: string; duration: string; emoji: string; description: string } | null>(null);
  const [editingSvcId, setEditingSvcId] = useState<string | null>(null);
  const createSvc = api.master.createService.useMutation({
    onSuccess: () => { utils.master.getMyServices.invalidate(); setSvcForm(null); },
  });
  const updateSvc = api.master.updateService.useMutation({
    onSuccess: () => { utils.master.getMyServices.invalidate(); setEditingSvcId(null); setSvcForm(null); },
  });
  const deleteSvc = api.master.deleteService.useMutation({
    onSuccess: () => { utils.master.getMyServices.invalidate(); },
  });
  const updateWorkHoursMut = api.master.updateWorkHours.useMutation({
    onSuccess: () => { utils.master.getMyProfile.invalidate(); },
  });

  const [bioEdit, setBioEdit] = useState(false);
  const [bio, setBio] = useState("");
  const [photo, setPhoto] = useState("");
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [newPortfolioUrl, setNewPortfolioUrl] = useState("");
  const updateProfile = api.master.updateProfile.useMutation({
    onSuccess: () => { utils.master.getMyProfile.invalidate(); setBioEdit(false); },
  });
  const updateDelegation = api.master.updateDelegation.useMutation({
    onSuccess: () => { utils.master.getMyProfile.invalidate(); },
  });
  const markNoShowMut = api.master.markNoShow.useMutation({
    onSuccess: () => { today.refetch(); schedule.refetch(); },
  });

  // Derived from profile (fetched eagerly when isDelegating)
  const allowDelegation = Boolean((profile.data as any)?.allowDelegation);
  // When delegating: only pass onNoShow if master granted management permission
  const canMutate = !isDelegating || allowDelegation;

  const tabLabels: Record<Tab, string> = {
    today: t("master.today", lang),
    schedule: t("master.schedule", lang),
    clients: t("master.clients", lang),
    earnings: t("master.earnings", lang),
    reviews: "Reviews",
    services: t("master.services", lang),
    profile: t("master.profile", lang),
  };

  const visibleTabs: Tab[] = [
    "today", "schedule", "clients", "earnings", "reviews",
    ...(isPersonal ? ["services" as Tab] : []),
    "profile",
  ];

  return (
    <Shell navItems={masterNavItems} title={t("master.title", lang)} subtitle="ManicBot Master">
      {/* Delegation banner — shown when owner or admin is viewing as this master */}
      {isDelegating && (
        <div className={`mb-4 flex items-center gap-3 rounded-2xl px-4 py-3 ${
          allowDelegation
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
            : "bg-amber-500/10 border border-amber-500/20 text-amber-300"
        }`}>
          <Eye className="h-4 w-4 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm leading-tight">
              {(profile.data as any)?.name ?? "Master"}
            </p>
            <p className="text-[11px] opacity-70 mt-0.5">
              {allowDelegation
                ? t("delegation.managementEnabled", lang)
                : t("delegation.viewOnly", lang)}
            </p>
          </div>
        </div>
      )}

      {/* Tab bar — hidden in WebShell (sidebar handles navigation) */}
      {!inWeb && <div data-tour="master-tabs" className="flex overflow-x-auto scrollbar-none gap-1 mb-6 pb-1">
        {visibleTabs.map(tb => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              tab === tb
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tabLabels[tb]}
          </button>
        ))}
      </div>}

      {/* TODAY */}
      {tab === "today" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t("common.today", lang)}</h2>
          {today.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {today.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}

          {/* Summary stats */}
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
      )}

      {/* SCHEDULE */}
      {tab === "schedule" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex-1">{t("master.allApts", lang)}</h2>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl px-3 py-1.5" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl px-3 py-1.5" />
          </div>
          {schedule.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {schedule.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          <div className="space-y-2">
            {schedule.data?.map((a: any) => (
              <AptRow key={a.id} apt={a}
                onNoShow={canMutate
                  ? (id, noShowBy) => markNoShowMut.mutate({ tenantId, id: String(id), noShowBy })
                  : undefined
                }
              />
            ))}
            {schedule.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("master.noApts", lang)}</p>}
          </div>
        </div>
      )}

      {/* CLIENTS */}
      {tab === "clients" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t("master.myClients", lang)}</h2>
          {clientsList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {clientsList.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          <div className="space-y-2">
            {clientsList.data?.map((c: any) => (
              <div key={c.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-600 dark:text-slate-300 shrink-0">
                  {(c.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white text-sm">{c.name ?? `#${c.chatId}`}</p>
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
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex-1">{t("master.earningsTitle", lang)}</h2>
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
          {earnings.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          {earnings.data && (
            <div className="space-y-3">
              <div className="glass-card rounded-2xl p-6 text-center">
                <p className="text-xs text-slate-500 mb-1">{t(`master.${period}Earnings` as any, lang)}</p>
                <p className="text-4xl font-bold text-slate-900 dark:text-white mb-1">
                  {earnings.data.total.toLocaleString(lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU")}{" "}
                  <span className="text-2xl text-slate-400">zł</span>
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{earnings.data.count} {t("master.confirmedApts", lang)}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* REVIEWS */}
      {tab === "reviews" && (
        <div className="space-y-4">
          {masterRevStats.data && (
            <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
              <div className="text-center">
                <p className="text-3xl font-extrabold text-slate-900 dark:text-white">{masterRevStats.data.avg || "—"}</p>
                <div className="flex gap-0.5 mt-1 justify-center">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} className={`w-3.5 h-3.5 ${s <= Math.round(masterRevStats.data!.avg) ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">{masterRevStats.data.count} reviews</p>
              </div>
              <div className="flex-1 space-y-1">
                {[5,4,3,2,1].map(n => {
                  const count = masterRevStats.data!.distribution[n] ?? 0;
                  const pct = masterRevStats.data!.count > 0 ? (count / masterRevStats.data!.count) * 100 : 0;
                  return (
                    <div key={n} className="flex items-center gap-2 text-[10px]">
                      <span className="w-3 text-slate-500">{n}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700/60 overflow-hidden">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-4 text-right text-slate-400">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {masterReviews.isLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="glass-card rounded-2xl h-20 animate-pulse" />)}</div>
          ) : (masterReviews.data?.reviews ?? []).length === 0 ? (
            <div className="glass-card rounded-2xl py-10 text-center">
              <Star className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No reviews yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(masterReviews.data?.reviews ?? []).map((rev: any) => (
                <div key={rev.id} className="glass-card rounded-2xl p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} className={`w-3 h-3 ${s <= rev.rating ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
                      ))}
                    </div>
                    <span className="text-[10px] text-slate-500">{new Date(rev.createdAt * 1000).toLocaleDateString()}</span>
                  </div>
                  {rev.text && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5">{rev.text}</p>}
                  {rev.replyText && (
                    <div className="mt-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 border-l-2 border-brand-400">
                      <p className="text-[10px] text-brand-400 font-medium mb-0.5">Salon reply</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{rev.replyText}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SERVICES (independent masters only) */}
      {tab === "services" && isPersonal && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t("master.services", lang)}</h2>
            {!svcForm && (
              <button
                onClick={() => setSvcForm({ names: "", price: "", duration: "60", emoji: "", description: "" })}
                className="flex items-center gap-1.5 rounded-xl bg-brand-500/20 border border-brand-500/30 px-3 py-1.5 text-xs font-medium text-brand-400 hover:bg-brand-500/30 transition"
              >
                <Plus className="h-3.5 w-3.5" />{t("master.addService", lang)}
              </button>
            )}
          </div>

          {/* Add/Edit form */}
          {svcForm && (
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-slate-500 mb-1 block">{t("master.svcName", lang)}</label>
                  <input value={svcForm.names} onChange={e => setSvcForm({ ...svcForm, names: e.target.value })}
                    placeholder="Маникюр классический"
                    className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t("master.svcPrice", lang)}</label>
                  <input type="number" value={svcForm.price} onChange={e => setSvcForm({ ...svcForm, price: e.target.value })}
                    placeholder="150"
                    className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t("master.svcDuration", lang)}</label>
                  <input type="number" value={svcForm.duration} onChange={e => setSvcForm({ ...svcForm, duration: e.target.value })}
                    placeholder="60"
                    className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t("master.svcEmoji", lang)}</label>
                  <input value={svcForm.emoji} onChange={e => setSvcForm({ ...svcForm, emoji: e.target.value })}
                    placeholder="💅"
                    maxLength={4}
                    className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t("master.svcDescription", lang)}</label>
                  <input value={svcForm.description} onChange={e => setSvcForm({ ...svcForm, description: e.target.value })}
                    placeholder=""
                    className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const price = parseFloat(svcForm.price);
                    const duration = parseInt(svcForm.duration);
                    if (!svcForm.names.trim() || isNaN(price) || isNaN(duration)) return;
                    if (editingSvcId) {
                      updateSvc.mutate({ tenantId, svcId: editingSvcId, names: svcForm.names, price, duration, emoji: svcForm.emoji || undefined, description: svcForm.description || undefined });
                    } else {
                      createSvc.mutate({ tenantId, names: svcForm.names, price, duration, emoji: svcForm.emoji || undefined, description: svcForm.description || undefined });
                    }
                  }}
                  disabled={createSvc.isPending || updateSvc.isPending || !svcForm.names.trim()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand-500/20 border border-brand-500/30 px-4 py-2 text-sm font-medium text-brand-400 hover:bg-brand-500/30 transition disabled:opacity-50"
                >
                  {(createSvc.isPending || updateSvc.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editingSvcId ? t("common.save", lang) : t("master.addService", lang)}
                </button>
                <button
                  onClick={() => { setSvcForm(null); setEditingSvcId(null); }}
                  className="rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {svcList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {svcList.data?.length === 0 && !svcForm && (
            <div className="glass-card rounded-2xl p-8 text-center">
              <Scissors className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">{t("master.noServices", lang)}</p>
            </div>
          )}
          <div className="space-y-2">
            {svcList.data?.filter((s: any) => s.active).map((svc: any) => (
              <div key={svc.svcId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-500/10 flex items-center justify-center text-lg shrink-0">
                  {svc.emoji || "✂️"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white text-sm truncate">{svc.names || svc.svcId}</p>
                  <p className="text-[11px] text-slate-500">{svc.duration} min · {svc.price} zł</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setSvcForm({ names: svc.names ?? "", price: String(svc.price), duration: String(svc.duration), emoji: svc.emoji ?? "", description: svc.description ?? "" });
                      setEditingSvcId(svc.svcId);
                    }}
                    className="h-7 w-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => deleteSvc.mutate({ tenantId, svcId: svc.svcId })}
                    disabled={deleteSvc.isPending}
                    className="h-7 w-7 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PROFILE */}
      {tab === "profile" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t("master.profile", lang)}</h2>
            {profile.data && !bioEdit && canMutate && (
              <button onClick={() => { setBio((profile.data as any).bio ?? ""); setPhoto((profile.data as any).photo ?? ""); setPortfolio(Array.isArray((profile.data as any).portfolio) ? (profile.data as any).portfolio : []); setBioEdit(true); }}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
                <Pencil className="h-3.5 w-3.5" />Редактировать
              </button>
            )}
            {bioEdit && (
              <button onClick={() => setBioEdit(false)}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                <X className="h-3.5 w-3.5" />Отмена
              </button>
            )}
          </div>
          {profile.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {profile.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
          {profile.data && (
            <div className="glass-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl overflow-hidden bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shrink-0">
                  {(profile.data as any).photo
                    ? <img src={(profile.data as any).photo} alt="" className="h-full w-full object-cover" />
                    : (profile.data.name ?? "M").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">{profile.data.name ?? "Мастер"}</p>
                  <p className="text-xs text-slate-500">ID: {(profile.data as any).chatId}</p>
                  {(profile.data as any).bio && !bioEdit && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{(profile.data as any).bio}</p>
                  )}
                </div>
              </div>

              {bioEdit && (
                <div className="space-y-3 border-t border-slate-200 dark:border-white/5 pt-3">
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Описание (bio)</label>
                    <textarea value={bio} onChange={(e) => setBio(e.target.value)}
                      rows={3} maxLength={500} placeholder="Мастер маникюра с 5-летним опытом..."
                      className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500 resize-none" />
                    <p className="text-right text-[10px] text-slate-600">{bio.length}/500</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-2 block">Портфолио ({portfolio.length})</label>
                    {portfolio.length > 0 && (
                      <div className="space-y-2 mb-2">
                        {portfolio.map((url, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <img src={url} alt="" className="h-10 w-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0" />
                            <span className="flex-1 text-xs text-slate-500 truncate">{url}</span>
                            <div className="flex gap-1 shrink-0">
                              <button type="button" disabled={i === 0}
                                onClick={() => setPortfolio((prev) => { const a = [...prev]; const tmp = a[i-1]!; a[i-1] = a[i]!; a[i] = tmp; return a; })}
                                className="h-6 w-6 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30">↑</button>
                              <button type="button" disabled={i === portfolio.length - 1}
                                onClick={() => setPortfolio((prev) => { const a = [...prev]; const tmp = a[i+1]!; a[i+1] = a[i]!; a[i] = tmp; return a; })}
                                className="h-6 w-6 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30">↓</button>
                              <button type="button"
                                onClick={() => setPortfolio((prev) => prev.filter((_, j) => j !== i))}
                                className="h-6 w-6 flex items-center justify-center rounded bg-red-500/10 text-red-400">✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input value={newPortfolioUrl} onChange={(e) => setNewPortfolioUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const u = newPortfolioUrl.trim(); if (u) { setPortfolio((p) => [...p, u]); setNewPortfolioUrl(""); } } }}
                        placeholder="https://example.com/work.jpg"
                        className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                      <button type="button"
                        onClick={() => { const u = newPortfolioUrl.trim(); if (u) { setPortfolio((p) => [...p, u]); setNewPortfolioUrl(""); } }}
                        className="shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600">
                        + Добавить
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => updateProfile.mutate({ tenantId, masterId, bio: bio || undefined, portfolio })}
                    disabled={updateProfile.isPending}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500/20 border border-brand-500/30 px-4 py-2.5 text-sm font-medium text-brand-400 hover:bg-brand-500/30 transition disabled:opacity-50">
                    {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Сохранить профиль
                  </button>
                </div>
              )}
              {!bioEdit && (profile.data as any).portfolio?.length > 0 && (
                <div className="border-t border-slate-200 dark:border-white/5 pt-3">
                  <p className="text-xs text-slate-500 mb-2">Портфолио ({(profile.data as any).portfolio.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {(profile.data as any).portfolio.map((url: string, i: number) => (
                      <img key={i} src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Vacation toggle — independent masters only */}
          {isPersonal && !isDelegating && profile.data && (
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {t("master.vacation", lang)}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {(profile.data as any).onVacation ? t("master.vacationOn", lang) : t("master.vacationOff", lang)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateWorkHoursMut.mutate({
                    tenantId,
                    masterId,
                    onVacation: (profile.data as any).onVacation ? 0 : 1,
                  })}
                  disabled={updateWorkHoursMut.isPending}
                  className={`relative flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                    (profile.data as any).onVacation ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"
                  }`}
                >
                  <span className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    (profile.data as any).onVacation ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>
            </div>
          )}

          {/* Delegation toggle — only for salon-employed masters (not personal, not when owner is viewing) */}
          {!isPersonal && !isDelegating && profile.data && (
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {t("delegation.toggleLabel", lang)}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t("delegation.toggleDesc", lang)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateDelegation.mutate({
                    tenantId,
                    masterId,
                    allowDelegation: allowDelegation ? 0 : 1,
                  })}
                  disabled={updateDelegation.isPending}
                  className={`relative flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                    allowDelegation ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                  }`}
                >
                  <span className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    allowDelegation ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>
              <p className={`text-xs flex items-center gap-1.5 ${allowDelegation ? "text-emerald-500" : "text-slate-500"}`}>
                {allowDelegation
                  ? <><Unlock className="h-3.5 w-3.5" /> {t("delegation.enabled", lang)}</>
                  : <><Lock className="h-3.5 w-3.5" /> {t("delegation.disabled", lang)}</>
                }
              </p>
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
