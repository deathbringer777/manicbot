"use client";

import { useState } from "react";
import {
  LayoutDashboard, CalendarDays, Users, Scissors, UserCheck,
  CreditCard, Settings, ChevronRight, Clock, AlertCircle,
  CheckCircle2, XCircle, Loader2, Building2,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";

const salonNavItems: NavItem[] = [
  { href: "#overview", icon: LayoutDashboard, label: "Обзор" },
  { href: "#appointments", icon: CalendarDays, label: "Записи" },
  { href: "#masters", icon: Scissors, label: "Мастера" },
  { href: "#services", icon: UserCheck, label: "Услуги" },
  { href: "#clients", icon: Users, label: "Клиенты" },
  { href: "#billing", icon: CreditCard, label: "Тариф" },
  { href: "#settings", icon: Settings, label: "Настройки" },
];

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
  const [tab, setTab] = useState<Tab>("overview");
  const [aptDate, setAptDate] = useState("");

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

  return (
    <Shell navItems={salonNavItems} title="Мой салон" subtitle="ManicBot Salon">
      {/* Tab bar */}
      <div className="flex overflow-x-auto scrollbar-none gap-1 mb-6 pb-1">
        {(["overview", "appointments", "masters", "services", "clients", "billing", "settings"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              tab === t
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {({ overview: "Обзор", appointments: "Записи", masters: "Мастера",
               services: "Услуги", clients: "Клиенты", billing: "Тариф", settings: "Настройки" })[t]}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Обзор</h2>
          {overview.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {overview.data && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Записей сегодня" value={overview.data.todayAppointments}
                icon={CalendarDays} color="bg-brand-500/20 text-brand-400" />
              <StatCard label="Мастеров" value={overview.data.activeMasters}
                icon={Scissors} color="bg-purple-500/20 text-purple-400" />
              <StatCard label="Открытых тикетов" value={overview.data.openTickets}
                icon={AlertCircle} color="bg-amber-500/20 text-amber-400" />
              <StatCard
                label="Тариф"
                value={PLAN_LABELS[overview.data.plan ?? "start"] ?? overview.data.plan ?? "—"}
                sub={BILLING_LABELS[overview.data.billingStatus ?? "trialing"]}
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
            <h2 className="text-lg font-bold text-white flex-1">Записи</h2>
            <input type="date" value={aptDate} onChange={e => setAptDate(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-xl px-3 py-1.5" />
          </div>
          {apts.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          <div className="space-y-2">
            {apts.data?.map((a: any) => <AptCard key={a.id} apt={a} />)}
            {apts.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">Записей нет</p>}
          </div>
        </div>
      )}

      {/* MASTERS */}
      {tab === "masters" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Мастера</h2>
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
            {mastersList.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">Мастеров нет</p>}
          </div>
        </div>
      )}

      {/* SERVICES */}
      {tab === "services" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Услуги</h2>
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
            {svcList.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">Услуг нет</p>}
          </div>
        </div>
      )}

      {/* CLIENTS */}
      {tab === "clients" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Клиенты</h2>
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
            {clients.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">Клиентов нет</p>}
          </div>
        </div>
      )}

      {/* BILLING */}
      {tab === "billing" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Тариф и оплата</h2>
          {billing.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {billing.data && (
            <div className="space-y-3">
              <div className="glass-card rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">Тариф</span>
                  <span className="font-bold text-white">{PLAN_LABELS[billing.data.plan ?? "start"] ?? billing.data.plan}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">Статус</span>
                  <span className={`text-sm font-medium ${billing.data.billingStatus === "active" ? "text-emerald-400" : "text-amber-400"}`}>
                    {BILLING_LABELS[billing.data.billingStatus ?? "trialing"] ?? billing.data.billingStatus}
                  </span>
                </div>
                {billing.data.nextPaymentDate && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Следующий платёж</span>
                    <span className="text-white text-sm">
                      {new Date(billing.data.nextPaymentDate * 1000).toLocaleDateString("ru")}
                    </span>
                  </div>
                )}
                {billing.data.trialEndsAt && billing.data.billingStatus === "trialing" && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Пробный до</span>
                    <span className="text-amber-400 text-sm">
                      {new Date(billing.data.trialEndsAt * 1000).toLocaleDateString("ru")}
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
          <h2 className="text-lg font-bold text-white">Настройки салона</h2>
          {profile.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {profile.data && (
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Название</p>
                <p className="text-white font-medium">{profile.data.name || "—"}</p>
              </div>
              {profile.data.salon?.address && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Адрес</p>
                  <p className="text-white text-sm">{profile.data.salon.address}</p>
                </div>
              )}
              {profile.data.salon?.phone && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Телефон</p>
                  <p className="text-white text-sm">{profile.data.salon.phone}</p>
                </div>
              )}
              {profile.data.salon?.workHours && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Часы работы</p>
                  <p className="text-white text-sm">
                    {profile.data.salon.workHours.from}:00 — {profile.data.salon.workHours.to}:00
                  </p>
                </div>
              )}
              <p className="text-xs text-slate-600 pt-2">
                Для изменения настроек используйте бота: /settings
              </p>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
