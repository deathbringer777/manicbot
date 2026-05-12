"use client";

import { MarketingShell, StubCard } from "./MarketingShell";
import { api } from "~/trpc/react";
import { Users, Mail, MessageSquare, Megaphone, Activity } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-1">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">{value}</div>
    </div>
  );
}

export default function OverviewClient() {
  const { lang } = useLang();
  const statsQ = (api as any).marketing.stats.useQuery();
  const providersQ = (api as any).marketing.providersList.useQuery();

  const s = statsQ.data;

  return (
    <MarketingShell subtitle="Marketing command center — CRM, campaigns, automations">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Metric label="Контакты" value={s?.contacts?.total ?? "—"} icon={Users} />
        <Metric label="Подписаны" value={s?.contacts?.subscribed ?? "—"} icon={Activity} />
        <Metric label="Сегменты" value={s?.segments ?? "—"} icon={Megaphone} />
        <Metric label="Кампании" value={Object.values(s?.campaigns ?? {}).reduce((a: number, b: any) => a + Number(b), 0) || "—"} icon={Mail} />
      </div>

      <StubCard
        title="Добро пожаловать в отдел маркетинга"
        description="Это фундамент (Phase 1). Таблицы БД, API, провайдеры email/SMS уже подготовлены. Отправка писем/SMS будет включена в Phase 2."
      >
        <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1.5 mt-2">
          <li>• <b>Contacts</b> — CRM с тегами, сегментами, согласием GDPR</li>
          <li>• <b>Campaigns</b> — email-рассылки (Brevo/Resend)</li>
          <li>• <b>SMS</b> — как доп. фича тарифа Max (через Brevo)</li>
          <li>• <b>Automations</b> — триггерные сценарии (welcome, re-engage, birthday)</li>
          <li>• <b>Templates</b> — библиотека HTML/SMS шаблонов</li>
          <li>• <b>Providers</b> — Brevo + Resend, health-checks, переключение</li>
        </ul>
      </StubCard>

      <div className="mt-4">
        <StubCard
          title="Статус провайдеров"
          description="Brevo интегрирован в dormant-режиме. Resend активен для транзакционных писем."
        >
          {providersQ.isLoading && <div className="text-xs text-slate-500">Загрузка…</div>}
          {providersQ.data && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              {providersQ.data.map((p: any) => (
                <div key={p.name} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 capitalize">{p.name}</div>
                    <div className="text-[10px] text-slate-500">
                      channels: {p.channels.join(", ")} • {p.configured.email ? "✓ email" : "✗ email"}
                      {p.channels.includes("sms") ? (p.configured.sms ? " • ✓ sms" : " • ✗ sms") : ""}
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                    p.db?.enabled
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                      : "bg-slate-200 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700"
                  }`}>
                    {p.db?.enabled ? t("marketing.provider.enabled", lang) : t("marketing.provider.dormant", lang)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </StubCard>
      </div>
    </MarketingShell>
  );
}
