"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Users, TrendingUp, User, Loader2, Clock, Pencil, X, Save, Star, UserX, Eye, Lock, Unlock, Scissors, Plus, Trash2, Settings, Camera, Tag, ImageIcon, AlertCircle, List as ListIcon, Ban, ShieldCheck } from "lucide-react";
import { resizeImageClientSide, validateUploadFile, uploadAssetFile } from "~/lib/uploadAsset";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useInWebShell } from "~/components/layout/WebShell";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { TodayTab } from "~/components/master/tabs/TodayTab";
import { MonthCalendar } from "~/components/calendar/MonthCalendar";
import { AptCard } from "~/components/dashboard-ui/AptCard";
import { type ServiceTemplate } from "~/lib/serviceTemplates";
import { AddServiceDropdown, ServiceTemplatesSheet } from "~/components/salon/ServiceAddMenu";
import { TestBadge } from "~/components/ui/TestBadge";
import { Switch } from "~/components/ui/Switch";
import { useRole } from "~/components/RoleContext";
import { STATUS_LABELS, APT_BORDER } from "~/lib/appointments";

type Tab = "today" | "schedule" | "clients" | "earnings" | "reviews" | "services" | "profile";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  pending: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  cancelled: "bg-red-500/20 text-red-400 border border-red-500/30",
  no_show: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  done: "bg-brand-500/20 text-brand-400 border border-brand-500/30",
};

type Period = "week" | "month" | "year";

const NO_SHOW_KEYS = {
  client: "master.noShow.client",
  master: "master.noShow.master",
} as const;

const CANCELLED_BY_KEYS = {
  client: "master.cancelled.client",
  master: "master.cancelled.master",
  admin: "master.cancelled.admin",
} as const;

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
  const { lang } = useLang();
  const [hh, mm] = (apt.time ?? "00:00").split(":");
  const nameWords = (apt.userName ?? "?").trim().split(/\s+/);
  const initials = nameWords.length >= 2
    ? (nameWords[0]![0]! + nameWords[1]![0]!).toUpperCase()
    : (apt.userName ?? "?").slice(0, 2).toUpperCase();
  const statusKey = apt.noShow ? "no_show" : apt.cancelled ? "cancelled" : apt.status;
  const border = APT_BORDER[statusKey] ?? "border-l-slate-700";
  const noShowKey = NO_SHOW_KEYS[apt.noShowBy as keyof typeof NO_SHOW_KEYS];
  const cancelledKey = CANCELLED_BY_KEYS[apt.cancelledBy as keyof typeof CANCELLED_BY_KEYS];
  const statusLabel = statusKey === "no_show"
    ? (noShowKey ? t(noShowKey, lang) : t("master.noShow.fallback", lang))
    : statusKey === "cancelled" && cancelledKey
      ? t(cancelledKey, lang)
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
            <UserX className="h-3.5 w-3.5" /> {t("master.noShow.client", lang)}
          </button>
        </div>
      )}
    </div>
  );
}

/** Master's schedule — calendar / list toggle wrapping the same data. */
function ScheduleTab({
  tenantId,
  lang,
  schedule,
  canMutate,
  markNoShowMut,
}: {
  tenantId: string;
  lang: Lang;
  schedule: { isLoading: boolean; isError: boolean; data?: any[] };
  canMutate: boolean;
  markNoShowMut: { mutate: (input: { tenantId: string; id: string; noShowBy: "client" | "master" }) => void };
}) {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [calViewDate, setCalViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const dayMap: Record<string, any[]> = {};
  (schedule.data ?? []).forEach((a: any) => {
    (dayMap[a.date] ??= []).push(a);
  });
  const selectedDayApts = selectedDay ? dayMap[selectedDay] ?? [] : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex-1">
          {t("master.allApts", lang)}
        </h2>
        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 gap-0.5" data-testid="master-schedule-view-switcher">
          <button
            type="button"
            onClick={() => setView("calendar")}
            data-testid="master-schedule-mode-calendar"
            data-active={view === "calendar" ? "1" : "0"}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              view === "calendar"
                ? "bg-brand-500/20 text-brand-400"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            {t("salon.cal.calendar", lang)}
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            data-testid="master-schedule-mode-list"
            data-active={view === "list" ? "1" : "0"}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              view === "list"
                ? "bg-brand-500/20 text-brand-400"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            {t("salon.cal.list", lang)}
          </button>
        </div>
      </div>

      {schedule.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {schedule.isError && (
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-400">{t("common.errorLoading", lang)}</p>
        </div>
      )}

      {view === "calendar" && (
        <>
          <MonthCalendar
            apts={schedule.data ?? []}
            viewDate={calViewDate}
            setViewDate={(d) => { setCalViewDate(d); setSelectedDay(null); }}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            isLoading={schedule.isLoading}
            lang={lang}
          />
          {selectedDay && (
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                  {new Date(selectedDay + "T12:00:00").toLocaleDateString(
                    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU",
                    { weekday: "long", day: "numeric", month: "long" },
                  )}
                  {selectedDayApts.length > 0 && (
                    <span className="ml-2 text-slate-400 dark:text-slate-500 font-medium">
                      · {selectedDayApts.length}
                    </span>
                  )}
                </h3>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                {selectedDayApts.map((a: any) => (
                  <AptCard
                    key={a.id}
                    a={a}
                    lang={lang}
                    onNoShow={canMutate
                      ? (id, noShowBy) => markNoShowMut.mutate({ tenantId, id: String(id), noShowBy })
                      : undefined}
                  />
                ))}
                {selectedDayApts.length === 0 && (
                  <p className="text-slate-500 text-sm text-center py-4">{t("master.noApts", lang)}</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {view === "list" && (
        <div className="space-y-2">
          {schedule.data?.map((a: any) => (
            <AptRow
              key={a.id}
              apt={a}
              onNoShow={canMutate
                ? (id, noShowBy) => markNoShowMut.mutate({ tenantId, id: String(id), noShowBy })
                : undefined}
            />
          ))}
          {schedule.data?.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">{t("master.noApts", lang)}</p>
          )}
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
  forceTab,
}: {
  tenantId: string;
  masterId: number;
  isDelegating?: boolean;
  isPersonal?: boolean;
  forceTab?: Tab;
}) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const searchParams = useSearchParams();
  const inWeb = useInWebShell();

  const VALID_TABS: Tab[] = ["today", "schedule", "clients", "earnings", "reviews", "services", "profile"];
  const urlTab = searchParams.get("tab");
  const resolvedTab: Tab = urlTab && VALID_TABS.includes(urlTab as Tab) ? (urlTab as Tab) : "today";

  const [tab, setTab] = useState<Tab>(forceTab ?? resolvedTab);

  // Sync tab when URL changes (sidebar click in WebShell) or forceTab changes
  useEffect(() => {
    if (forceTab) { setTab(forceTab); return; }
    if (inWeb) setTab(resolvedTab);
  }, [resolvedTab, inWeb, forceTab]);
  const [period, setPeriod] = useState<Period>("month");

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
    { tenantId, masterId },
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
  const [svcForm, setSvcForm] = useState<{ names: string; price: string; duration: string; emoji: string; description: string; promo: string; photos: string[] } | null>(null);
  const [editingSvcId, setEditingSvcId] = useState<string | null>(null);
  const [showSvcEmojiPicker, setShowSvcEmojiPicker] = useState(false);
  const [showSvcTemplates, setShowSvcTemplates] = useState(false);
  const [svcUploading, setSvcUploading] = useState(false);
  const [svcPhotoError, setSvcPhotoError] = useState<string>("");
  const svcFileRef = useRef<HTMLInputElement>(null);
  const mintToken = api.salon.mintUploadToken.useMutation();
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
  const setVacationMut = api.master.setVacation.useMutation({
    onSuccess: () => { utils.master.getMyProfile.invalidate(); setVacationError(null); },
  });
  const [vacationFromInput, setVacationFromInput] = useState("");
  const [vacationUntilInput, setVacationUntilInput] = useState("");
  const [vacationError, setVacationError] = useState<string | null>(null);

  // Seed vacation inputs from the profile when it loads. We re-seed
  // whenever the underlying timestamps change so an external update (e.g.
  // owner overriding) reflects in the picker without the user noticing.
  const vacFrom = (profile.data as any)?.vacationFrom ?? null;
  const vacUntil = (profile.data as any)?.vacationUntil ?? null;
  useEffect(() => {
    const toDate = (sec: number | null) => {
      if (sec == null) return "";
      const d = new Date(sec * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    setVacationFromInput(toDate(vacFrom));
    setVacationUntilInput(toDate(vacUntil));
  }, [vacFrom, vacUntil]);

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
  const updateCalendarVisibility = api.master.updateCalendarVisibility.useMutation({
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

  const isTest = useRole().isTest;
  return (
    <Shell navItems={masterNavItems} title={t("master.title", lang)} subtitle="ManicBot Master">
      {isTest && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-yellow-300/40 bg-yellow-300/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          <TestBadge />
          <span>{t("master.testAccountBanner", lang)}</span>
        </div>
      )}
      {/* Delegation banner — shown when owner or admin is viewing as this master */}
      {isDelegating && (
        <div className={`mb-4 flex items-center gap-3 rounded-2xl px-4 py-3 ${
          allowDelegation
            ? "bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300"
            : "bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-300"
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
      {tab === "today" && <TodayTab tenantId={tenantId} masterId={masterId} canMutate={canMutate} />}

      {/* SCHEDULE */}
      {tab === "schedule" && (
        <ScheduleTab
          tenantId={tenantId}
          lang={lang}
          schedule={schedule}
          canMutate={canMutate}
          markNoShowMut={markNoShowMut}
        />
      )}

      {/* CLIENTS */}
      {tab === "clients" && (
        <MasterClientsList
          tenantId={tenantId}
          masterId={masterId}
          clientsList={clientsList}
        />
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
          {earnings.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}
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
              <AddServiceDropdown
                lang={lang}
                onNew={() => setSvcForm({ names: "", price: "", duration: "60", emoji: "💅", description: "", promo: "", photos: [] })}
                onTemplates={() => setShowSvcTemplates(true)}
              />
            )}
          </div>

          {showSvcTemplates && (
            <ServiceTemplatesSheet
              lang={lang}
              onClose={() => setShowSvcTemplates(false)}
              onSelect={(tmpl: ServiceTemplate) => {
                setShowSvcTemplates(false);
                setSvcForm({
                  names: tmpl.names[lang] ?? tmpl.names.en,
                  price: String(tmpl.price),
                  duration: String(tmpl.duration),
                  emoji: tmpl.emoji,
                  description: "",
                  promo: "",
                  photos: [],
                });
              }}
            />
          )}

          {/* Add/Edit form */}
          {svcForm && (
            <div className="glass-card rounded-2xl p-4 space-y-3">
              {/* Emoji + Name */}
              <div className="flex items-start gap-3">
                <div className="relative">
                  <button
                    onClick={() => setShowSvcEmojiPicker(p => !p)}
                    className="w-12 h-12 text-2xl rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-white/10 transition-colors focus:outline-none">
                    {svcForm.emoji || "💅"}
                  </button>
                  {showSvcEmojiPicker && (
                    <div className="absolute top-14 left-0 z-10 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-2">
                      <div className="grid grid-cols-5 gap-1">
                        {['💅','💆','💇','✂️','🪮','🌸','✨','💎','🌺','🫧','🧴','🧼','🪷','💜','🤍','🎀','🫶','⭐','🌟','💫','🎨','🌷','🪸','🫐','🍒'].map(e => (
                          <button key={e} onClick={() => { setSvcForm({ ...svcForm, emoji: e }); setShowSvcEmojiPicker(false); }}
                            className={`text-xl h-9 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/10 transition-colors ${e === svcForm.emoji ? "bg-brand-500/15 ring-1 ring-brand-500/40" : ""}`}>
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block">{t("master.svcName", lang)}</label>
                  <input value={svcForm.names} onChange={e => setSvcForm({ ...svcForm, names: e.target.value })}
                    placeholder={t("master.svcNamePlaceholder", lang)}
                    className="w-full rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-400 dark:placeholder:text-slate-600" />
                </div>
              </div>

              {/* Price + Duration */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block">{t("master.svcPrice", lang)}</label>
                  <input type="number" value={svcForm.price} onChange={e => setSvcForm({ ...svcForm, price: e.target.value })}
                    placeholder="150"
                    className="w-full rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-400 dark:placeholder:text-slate-600" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block">{t("master.svcDuration", lang)}</label>
                  <input type="number" value={svcForm.duration} onChange={e => setSvcForm({ ...svcForm, duration: e.target.value })}
                    placeholder="60"
                    className="w-full rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-400 dark:placeholder:text-slate-600" />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block">{t("common.description", lang)}</label>
                <textarea value={svcForm.description} onChange={e => setSvcForm({ ...svcForm, description: e.target.value })}
                  rows={2} placeholder={t("master.svcDescriptionPlaceholder", lang)}
                  className="w-full resize-none bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-400 dark:placeholder:text-slate-600" />
              </div>

              {/* Promo */}
              <div>
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1.5 flex items-center gap-1.5 block">
                  <Tag className="h-3 w-3" /> {t("master.promoSticker", lang)}
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {["-10%", "-15%", "-20%", t("master.promoPresetHit", lang), t("master.promoPresetNew", lang), t("master.promoPresetDiscount", lang)].map(p => (
                    <button key={p} onClick={() => setSvcForm({ ...svcForm, promo: svcForm.promo === p ? "" : p })}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        svcForm.promo === p
                          ? "bg-red-500 text-white border-red-500"
                          : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-red-400 hover:text-red-500"
                      }`}>{p}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input value={svcForm.promo} onChange={e => setSvcForm({ ...svcForm, promo: e.target.value })} maxLength={12}
                    placeholder={t("master.svcPromoPlaceholder", lang)}
                    className="flex-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 placeholder:text-slate-400 dark:placeholder:text-slate-600" />
                  {svcForm.promo && (
                    <span className="shrink-0 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">{svcForm.promo}</span>
                  )}
                </div>
              </div>

              {/* Photos */}
              <div>
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5 block">
                  <Camera className="h-3 w-3" /> {t("master.servicePhotos", lang)}
                </label>
                <div className="flex gap-2 flex-wrap">
                  {svcForm.photos.map((url, i) => (
                    <div key={url} className="relative h-14 w-14 rounded-xl overflow-hidden group border border-slate-200 dark:border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button onClick={() => setSvcForm({ ...svcForm, photos: svcForm.photos.filter((_, idx) => idx !== i) })}
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <X className="h-3.5 w-3.5 text-white" />
                      </button>
                    </div>
                  ))}
                  {svcForm.photos.length < 5 && (
                    <button onClick={() => svcFileRef.current?.click()} disabled={svcUploading}
                      className="h-14 w-14 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/15 flex flex-col items-center justify-center gap-0.5 text-slate-400 hover:border-brand-500 hover:text-brand-400 transition-colors disabled:opacity-50">
                      {svcUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                      {!svcUploading && <span className="text-[9px]">{t("common.add", lang)}</span>}
                    </button>
                  )}
                </div>
                <input ref={svcFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file || svcForm.photos.length >= 5) return;
                    const err = validateUploadFile(file);
                    if (err) { setSvcPhotoError(err); return; }
                    setSvcPhotoError("");
                    setSvcUploading(true);
                    try {
                      const compressed = await resizeImageClientSide(file, 1200, "image/webp", 0.82);
                      const { uploadUrl } = await mintToken.mutateAsync({ tenantId, kind: "service_photo" });
                      const result = await uploadAssetFile(uploadUrl, compressed);
                      setSvcForm(f => f ? { ...f, photos: [...f.photos, result.url].slice(0, 5) } : f);
                    } catch (e) {
                      console.error("Service photo upload failed:", e);
                      setSvcPhotoError(t("master.photoUploadError", lang));
                    }
                    finally { setSvcUploading(false); e.target.value = ""; }
                  }} />
              </div>

              {svcPhotoError && (
                <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg">
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                  <p className="text-sm text-red-600 dark:text-red-400">{svcPhotoError}</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    const price = parseFloat(svcForm.price);
                    const duration = parseInt(svcForm.duration);
                    if (!svcForm.names.trim() || isNaN(price) || isNaN(duration)) return;
                    const photosJson = svcForm.photos.length > 0 ? JSON.stringify(svcForm.photos) : undefined;
                    const promoVal = svcForm.promo.trim() || undefined;
                    if (editingSvcId) {
                      updateSvc.mutate({ tenantId, svcId: editingSvcId, names: svcForm.names, price, duration, emoji: svcForm.emoji || undefined, description: svcForm.description || undefined, photos: photosJson, promo: promoVal });
                    } else {
                      createSvc.mutate({ tenantId, names: svcForm.names, price, duration, emoji: svcForm.emoji || undefined, description: svcForm.description || undefined, photos: photosJson, promo: promoVal });
                    }
                  }}
                  disabled={createSvc.isPending || updateSvc.isPending || svcUploading || !svcForm.names.trim()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition disabled:opacity-50 shadow-sm"
                >
                  {(createSvc.isPending || updateSvc.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editingSvcId ? t("common.save", lang) : t("master.addService", lang)}
                </button>
                <button
                  onClick={() => { setSvcForm(null); setEditingSvcId(null); setShowSvcEmojiPicker(false); }}
                  className="rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {svcList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {svcList.data?.length === 0 && !svcForm && (
            <div className="flex flex-col items-center justify-center py-14 gap-5">
              <span className="text-4xl">💅</span>
              <p className="text-slate-400 text-sm">{t("master.noServices", lang)}</p>
              <AddServiceDropdown
                lang={lang}
                onNew={() => setSvcForm({ names: "", price: "", duration: "60", emoji: "💅", description: "", promo: "", photos: [] })}
                onTemplates={() => setShowSvcTemplates(true)}
              />
            </div>
          )}
          <div className="space-y-2">
            {svcList.data?.filter((s: any) => s.active).map((svc: any) => {
              const svcPhotos: string[] = (() => { try { return JSON.parse(svc.photos ?? "[]"); } catch { return []; } })();
              return (
              <div key={svc.svcId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="relative shrink-0">
                  {svcPhotos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={svcPhotos[0]} alt="" className="w-10 h-10 rounded-xl object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center text-xl">
                      {svc.emoji || "✂️"}
                    </div>
                  )}
                  {svc.promo && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow leading-none whitespace-nowrap">
                      {svc.promo}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white text-sm truncate">{svc.names || svc.svcId}</p>
                  <p className="text-[11px] text-slate-500">{svc.duration} min · {svc.price} zł</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setSvcForm({ names: svc.names ?? "", price: String(svc.price), duration: String(svc.duration), emoji: svc.emoji ?? "💅", description: svc.description ?? "", promo: svc.promo ?? "", photos: svcPhotos });
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
              );
            })}
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
                <Pencil className="h-3.5 w-3.5" />{t("common.edit", lang)}
              </button>
            )}
            {bioEdit && (
              <button onClick={() => setBioEdit(false)}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                <X className="h-3.5 w-3.5" />{t("common.cancel", lang)}
              </button>
            )}
          </div>
          {profile.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {profile.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}
          {profile.data && (
            <div className="glass-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl overflow-hidden bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shrink-0">
                  {(profile.data as any).photo
                    ? <img src={(profile.data as any).photo} alt="" className="h-full w-full object-cover" />
                    : (profile.data.name ?? "M").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">{profile.data.name ?? t("master.fallbackName", lang)}</p>
                  <p className="text-xs text-slate-500">ID: {(profile.data as any).chatId}</p>
                  {(profile.data as any).bio && !bioEdit && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{(profile.data as any).bio}</p>
                  )}
                </div>
              </div>

              {bioEdit && (
                <div className="space-y-3 border-t border-slate-200 dark:border-white/5 pt-3">
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("master.bioLabel", lang)}</label>
                    <textarea value={bio} onChange={(e) => setBio(e.target.value)}
                      rows={3} maxLength={500} placeholder={t("master.bioPlaceholder", lang)}
                      className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500 resize-none" />
                    <p className="text-right text-[10px] text-slate-600">{bio.length}/500</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-2 block">{t("master.portfolioLabel", lang)} ({portfolio.length})</label>
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
                        + {t("common.add", lang)}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => updateProfile.mutate({ tenantId, masterId, bio: bio || undefined, portfolio })}
                    disabled={updateProfile.isPending}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500/20 border border-brand-500/30 px-4 py-2.5 text-sm font-medium text-brand-400 hover:bg-brand-500/30 transition disabled:opacity-50">
                    {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t("master.saveProfile", lang)}
                  </button>
                </div>
              )}
              {!bioEdit && (profile.data as any).portfolio?.length > 0 && (
                <div className="border-t border-slate-200 dark:border-white/5 pt-3">
                  <p className="text-xs text-slate-500 mb-2">{t("master.portfolioLabel", lang)} ({(profile.data as any).portfolio.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {(profile.data as any).portfolio.map((url: string, i: number) => (
                      <img key={i} src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Vacation date range — independent masters only.
              Booksy-style: pick start/end and bookings are blocked, the
              public salon page shows "В отпуске до DD.MM". Leaving both
              fields empty + clicking Clear removes the vacation. */}
          {isPersonal && !isDelegating && profile.data && (
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {t("master.vacation", lang)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {(profile.data as any).onVacation ? t("master.vacationOn", lang) : t("master.vacationOff", lang)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-slate-500">{t("master.vacationFrom", lang)}</span>
                  <input
                    type="date"
                    value={vacationFromInput}
                    onChange={(e) => setVacationFromInput(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">{t("master.vacationUntil", lang)}</span>
                  <input
                    type="date"
                    value={vacationUntilInput}
                    onChange={(e) => setVacationUntilInput(e.target.value)}
                    min={vacationFromInput || undefined}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
              </div>
              {vacationError && (
                <p className="text-xs text-red-500">{vacationError}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={setVacationMut.isPending || !vacationFromInput || !vacationUntilInput}
                  onClick={() => {
                    const fromMs = new Date(vacationFromInput + "T00:00:00").getTime();
                    const untilMs = new Date(vacationUntilInput + "T23:59:59").getTime();
                    if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs < fromMs) {
                      setVacationError(t("master.vacationRangeError", lang));
                      return;
                    }
                    setVacationError(null);
                    setVacationMut.mutate({
                      tenantId,
                      masterId,
                      vacationFrom: Math.floor(fromMs / 1000),
                      vacationUntil: Math.floor(untilMs / 1000),
                    });
                  }}
                  className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("master.vacationSave", lang)}
                </button>
                <button
                  type="button"
                  disabled={setVacationMut.isPending || (!(profile.data as any).onVacation && vacFrom == null && vacUntil == null)}
                  onClick={() => {
                    setVacationError(null);
                    setVacationMut.mutate({ tenantId, masterId, vacationFrom: null, vacationUntil: null });
                    // Also clear the legacy boolean in case it was set without a range.
                    if ((profile.data as any).onVacation && vacFrom == null) {
                      updateWorkHoursMut.mutate({ tenantId, masterId, onVacation: 0 });
                    }
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {t("master.vacationClear", lang)}
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
                <Switch
                  tone="emerald"
                  checked={!!allowDelegation}
                  onChange={(next) => updateDelegation.mutate({
                    tenantId,
                    masterId,
                    allowDelegation: next ? 1 : 0,
                  })}
                  disabled={updateDelegation.isPending}
                  aria-label={t("delegation.toggleLabel", lang)}
                />
              </div>
              <p className={`text-xs flex items-center gap-1.5 ${allowDelegation ? "text-emerald-500" : "text-slate-500"}`}>
                {allowDelegation
                  ? <><Unlock className="h-3.5 w-3.5" /> {t("delegation.enabled", lang)}</>
                  : <><Lock className="h-3.5 w-3.5" /> {t("delegation.disabled", lang)}</>
                }
              </p>
            </div>
          )}

          {/* Calendar visibility — master-owned setting (migration 0049). */}
          {/* Salon owner always sees regardless. Personal-tenant masters skip this (no peers). */}
          {!isPersonal && !isDelegating && profile.data && (
            <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="master-calendar-visibility">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {t("master.calendar.visibility.title", lang)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t("master.calendar.visibility.desc", lang)}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {(["salon_only", "salon_and_peers"] as const).map((opt) => {
                  const current = ((profile.data as any).calendarVisibility as string | undefined) ?? "salon_only";
                  const isActive = current === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      data-testid={`calendar-visibility-${opt}`}
                      data-active={isActive ? "1" : "0"}
                      onClick={() => updateCalendarVisibility.mutate({ tenantId, masterId, visibility: opt })}
                      disabled={updateCalendarVisibility.isPending || isActive}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all ${
                        isActive
                          ? "border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                          : "border-slate-200 dark:border-white/10 bg-white/40 dark:bg-white/[0.02] text-slate-700 dark:text-slate-300 hover:border-brand-500/30"
                      }`}
                    >
                      <span className="text-xs font-medium">
                        {t(`master.calendar.visibility.${opt === "salon_and_peers" ? "peers" : "salonOnly"}` as any, lang)}
                      </span>
                      {isActive && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                    </button>
                  );
                })}
              </div>
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

// ─── Per-master client list with block / unblock action (0062) ────────────────
//
// Wraps `master.getMyClients` (existing list of clients who booked this
// master) and overlays `master.listMyBlockedClients` so the master can
// toggle a block from the same row. The block list is server-source-of-
// truth — we don't optimistically mutate the array, just invalidate.
function MasterClientsList({
  tenantId,
  masterId,
  clientsList,
}: {
  tenantId: string;
  masterId: number;
  clientsList: ReturnType<typeof api.master.getMyClients.useQuery>;
}) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [confirmBlock, setConfirmBlock] = useState<{ chatId: number; name: string | null } | null>(null);
  const [reason, setReason] = useState("");

  const blocked = api.master.listMyBlockedClients.useQuery({ tenantId, masterId });
  const block = api.master.blockClient.useMutation({
    onSuccess: () => {
      void utils.master.listMyBlockedClients.invalidate({ tenantId, masterId });
      setConfirmBlock(null);
      setReason("");
    },
  });
  const unblock = api.master.unblockClient.useMutation({
    onSuccess: () => {
      void utils.master.listMyBlockedClients.invalidate({ tenantId, masterId });
    },
  });

  const blockedSet = new Set((blocked.data ?? []).map((b: any) => b.clientChatId));
  // tRPC's runtime Query type doesn't preserve the Drizzle return shape
  // through the generic helper signature, so we cast to a permissive
  // array here. Each row is { chatId, name, phone, lastAppointment? }.
  const clients = (clientsList.data ?? []) as Array<any>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t("master.myClients", lang)}</h2>
      {clientsList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {clientsList.isError && (
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-400">{t("common.errorLoading", lang)}</p>
        </div>
      )}
      <div className="space-y-2">
        {clients.map((c: any) => {
          const isBlocked = blockedSet.has(c.chatId);
          return (
            <div key={c.chatId} className="glass-card flex items-center gap-3 rounded-xl p-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  isBlocked
                    ? "bg-rose-500/15 text-rose-400"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                {(c.name ?? "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {c.name ?? `#${c.chatId}`}
                  </p>
                  {isBlocked && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                      <Ban className="h-3 w-3" />
                      blocked
                    </span>
                  )}
                </div>
                {c.lastAppointment && (
                  <p className="text-[10px] text-slate-500">
                    {t("master.lastApt", lang)} {c.lastAppointment.date}
                  </p>
                )}
              </div>
              {/* Block / Unblock button — icon-only on mobile (saves
                  horizontal space), icon + label on tablet+. aria-label
                  keeps it accessible to screen readers regardless. */}
              {isBlocked ? (
                <button
                  type="button"
                  onClick={() => unblock.mutate({ tenantId, masterId, clientChatId: c.chatId })}
                  disabled={unblock.isPending}
                  aria-label={t("master.block.unblock", lang)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 sm:h-auto sm:w-auto sm:px-2 sm:py-1"
                  data-testid={`master-unblock-${c.chatId}`}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
                  <span className="hidden sm:inline">{t("master.block.unblock", lang)}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBlock({ chatId: c.chatId, name: c.name ?? null })}
                  aria-label={t("master.block.action", lang)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-[11px] font-medium text-slate-600 hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 sm:h-auto sm:w-auto sm:px-2 sm:py-1"
                  data-testid={`master-block-${c.chatId}`}
                >
                  <Ban className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
                  <span className="hidden sm:inline">{t("master.block.action", lang)}</span>
                </button>
              )}
            </div>
          );
        })}
        {clients.length === 0 && !clientsList.isLoading && (
          <p className="py-8 text-center text-sm text-slate-500">{t("master.noClients", lang)}</p>
        )}
      </div>

      {confirmBlock && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
          onClick={() => setConfirmBlock(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl border border-rose-500/30 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">
              {t("master.block.title", lang)}
            </h3>
            <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">
              {confirmBlock.name ?? `#${confirmBlock.chatId}`}
            </p>
            <input
              type="text"
              placeholder={t("clients.block.reasonPh", lang)}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="mb-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmBlock(null); setReason(""); }}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-100 py-2 text-xs font-medium text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80"
              >
                {t("common.cancel", lang)}
              </button>
              <button
                onClick={() =>
                  block.mutate({
                    tenantId,
                    masterId,
                    clientChatId: confirmBlock.chatId,
                    reason: reason.trim() || undefined,
                  })
                }
                disabled={block.isPending}
                className="flex-1 rounded-lg bg-rose-600 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {t("master.block.confirm", lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
