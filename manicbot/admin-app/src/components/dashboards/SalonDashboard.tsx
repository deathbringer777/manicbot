"use client";

import { useState } from "react";
import {
  LayoutDashboard, CalendarDays, Users, Scissors, UserCheck,
  CreditCard, Settings, ChevronRight, Clock, AlertCircle,
  CheckCircle2, XCircle, Loader2, Building2,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

type Tab = "overview" | "appointments" | "masters" | "services" | "clients" | "billing" | "settings";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  pending: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  cancelled: "bg-red-500/20 text-red-400 border border-red-500/30",
  rejected: "bg-red-500/20 text-red-400 border border-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Подтверждено",
  pending: "Ожидает",
  cancelled: "Отменено",
  rejected: "Отклонено",
};

const PLAN_LABELS: Record<string, string> = {
  start: "Start",
  pro: "Pro",
  studio: "Studio",
};

const BILLING_LABELS: Record<string, string> = {
  active: "Активна",
  trialing: "Пробный",
  grace: "Льготный",
  expired: "Истёк",
};

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-4 flex items-start gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-slate-400">{label}</p>
        {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function AptCard({ apt }: { apt: any }) {
  return (
    <div className="glass-card rounded-xl p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white text-sm truncate">{apt.userName ?? `#${apt.chatId}`}</p>
        <p className="text-xs text-slate-400">{apt.svcId} · {apt.date} {apt.time}</p>
      </div>
      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[apt.status] ?? "bg-slate-700 text-slate-300"}`}>
        {STATUS_LABELS[apt.status] ?? apt.status}
      </span>
    </div>
  );
}

export function SalonDashboard({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const [tab, setTab] = useState<Tab>("overview");
  const [aptDate, setAptDate] = useState("");

  const salonNavItems: NavItem[] = [
    { href: "#overview", icon: LayoutDashboard, label: t("salon.overview", lang) },
    { href: "#appointments", icon: CalendarDays, label: t("salon.appointments", lang) },
    { href: "#masters", icon: Scissors, label: t("salon.masters", lang) },
    { href: "#services", icon: UserCheck, label: t("salon.services", lang) },
    { href: "#clients", icon: Users, label: t("salon.clients", lang) },
    { href: "#billing", icon: CreditCard, label: t("salon.billing", lang) },
    { href: "#settings", icon: Settings, label: t("common.settings", lang) },
  ];

  const overview = api.salon.getOverview.useQuery({ tenantId }, { enabled: tab === "overview" });
  const apts = api.salon.getAppointments.useQuery(
    { tenantId, date: aptDate || undefined },
    { enabled: tab === "appointments" }
  );
  const mastersList = api.salon.getMasters.useQuery({ tenantId }, { enabled: tab === "masters" });
  const svcList = api.salon.getServices.useQuery({ tenantId }, { enabled: tab === "services" });
  const clients = api.salon.getClients.useQuery({ tenantId }, { enabled: tab === "clients" });
  const billing = api.salon.getBillingStatus.useQuery({ tenantId }, { enabled: tab === "billing" });
  const profile = api.salon.getSalonProfile.useQuery({ tenantId }, { enabled: tab === "settings" });

  const tabLabels: Record<Tab, string> = {
    overview: t("salon.overview", lang),
    appointments: t("salon.appointments", lang),
    masters: t("salon.masters", lang),
    services: t("salon.services", lang),
    clients: t("salon.clients", lang),
    billing: t("salon.billing", lang),
    settings: t("common.settings", lang),
  };

  return (
    <Shell navItems={salonNavItems} title={t("salon.title", lang)} subtitle="ManicBot Salon">
      {/* Tab bar */}
      <div className="flex overflow-x-auto scrollbar-none gap-1 mb-6 pb-1">
        {(["overview", "appointments", "masters", "services", "clients", "billing", "settings"] as Tab[]).map(tab_ => (
          <button
            key={tab_}
            onClick={() => setTab(tab_)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              tab === tab_
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tabLabels[tab_]}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("salon.overview", lang)}</h2>
          {overview.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {overview.data && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t("salon.todayApts", lang)} value={overview.data.todayAppointments}
                icon={CalendarDays} color="bg-brand-500/20 text-brand-400" />
              <StatCard label={t("salon.activeMasters", lang)} value={overview.data.activeMasters}
                icon={Scissors} color="bg-purple-500/20 text-purple-400" />
              <StatCard label={t("salon.openTickets", lang)} value={overview.data.openTickets}
                icon={AlertCircle} color="bg-amber-500/20 text-amber-400" />
              <StatCard
                label={t("billing.plan", lang)}
                value={PLAN_LABELS[overview.data.plan ?? "start"] ?? overview.data.plan ?? "—"}
                sub={t(`billing.${overview.data.billingStatus ?? "trialing"}` as any, lang)}
                icon={CreditCard} color="bg-emerald-500/20 text-emerald-400"
              />
            </div>
          )}
        </div>
      )}

      {/* APPOINTMENTS */}
      {tab === "appointments" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white flex-1">{t("salon.appointments", lang)}</h2>
            <input type="date" value={aptDate} onChange={e => setAptDate(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-1.5" />
          </div>
          {apts.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {apts.data?.map((a: any) => <AptCard key={a.id} apt={a} />)}
            {apts.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noApts", lang)}</p>}
          </div>
        </div>
      )}

      {/* MASTERS */}
      {tab === "masters" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("salon.masters", lang)}</h2>
          {mastersList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {mastersList.data?.map((m: any) => (
              <div key={m.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {(m.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm">{m.name ?? `#${m.chatId}`}</p>
                  <p className="text-[10px] text-slate-500">ID: {m.chatId}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-600 shrink-0" />
              </div>
            ))}
            {mastersList.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noMasters", lang)}</p>}
          </div>
        </div>
      )}

      {/* SERVICES */}
      {tab === "services" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("salon.services", lang)}</h2>
          {svcList.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {svcList.data?.map((s: any) => {
              const names = s.names ? JSON.parse(s.names) : {};
              const name = names.ru ?? names.en ?? s.svcId;
              return (
                <div key={s.svcId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                  <span className="text-2xl shrink-0">{s.emoji ?? "💅"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-sm">{name}</p>
                    <p className="text-xs text-slate-400">{s.duration} мин · {s.price} ₴</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.active ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-slate-500"}`}>
                    {s.active ? "Активна" : "Скрыта"}
                  </span>
                </div>
              );
            })}
            {svcList.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noServices", lang)}</p>}
          </div>
        </div>
      )}

      {/* CLIENTS */}
      {tab === "clients" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("salon.clients", lang)}</h2>
          {clients.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {clients.data?.map((c: any) => (
              <div key={c.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-300 shrink-0">
                  {(c.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm">{c.name ?? `#${c.chatId}`}</p>
                  <p className="text-[10px] text-slate-500">
                    {c.tgUsername ? `@${c.tgUsername}` : ""} {c.phone ?? ""}
                  </p>
                </div>
              </div>
            ))}
            {clients.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noClients", lang)}</p>}
          </div>
        </div>
      )}

      {/* BILLING */}
      {tab === "billing" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("salon.billingTitle", lang)}</h2>
          {billing.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {billing.data && (
            <div className="space-y-3">
              <div className="glass-card rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">{t("billing.plan", lang)}</span>
                  <span className="font-bold text-white">{PLAN_LABELS[billing.data.plan ?? "start"] ?? billing.data.plan}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">{t("billing.status", lang)}</span>
                  <span className={`text-sm font-medium ${billing.data.billingStatus === "active" ? "text-emerald-400" : "text-amber-400"}`}>
                    {t(`billing.${billing.data.billingStatus ?? "trialing"}` as any, lang)}
                  </span>
                </div>
                {billing.data.nextPaymentDate && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">{t("billing.nextPayment", lang)}</span>
                    <span className="text-white text-sm">
                      {new Date(billing.data.nextPaymentDate * 1000).toLocaleDateString(lang === "en" ? "en" : "ru")}
                    </span>
                  </div>
                )}
                {billing.data.trialEndsAt && billing.data.billingStatus === "trialing" && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">{t("billing.trialUntil", lang)}</span>
                    <span className="text-amber-400 text-sm">
                      {new Date(billing.data.trialEndsAt * 1000).toLocaleDateString(lang === "en" ? "en" : "ru")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SETTINGS */}
      {tab === "settings" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">{t("salon.salonProfile", lang)}</h2>
          {profile.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {profile.data && (
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">{t("salon.name", lang)}</p>
                <p className="text-white font-medium">{profile.data.name || "—"}</p>
              </div>
              {profile.data.salon?.address && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">{t("salon.address", lang)}</p>
                  <p className="text-white text-sm">{profile.data.salon.address}</p>
                </div>
              )}
              {profile.data.salon?.phone && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">{t("salon.phone", lang)}</p>
                  <p className="text-white text-sm">{profile.data.salon.phone}</p>
                </div>
              )}
              {profile.data.salon?.workHours && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">{t("salon.hours", lang)}</p>
                  <p className="text-white text-sm">
                    {profile.data.salon.workHours.from}:00 — {profile.data.salon.workHours.to}:00
                  </p>
                </div>
              )}
              <p className="text-xs text-slate-600 pt-2">{t("salon.botHint", lang)}</p>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
