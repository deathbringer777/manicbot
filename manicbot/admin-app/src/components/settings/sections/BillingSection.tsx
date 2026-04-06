"use client";

import { CreditCard, Check, Loader2, ExternalLink, Zap } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import { t } from "~/lib/i18n";
import type { Lang } from "~/lib/i18n";

const LABELS: Record<Lang, {
  currentPlan: string;
  subscribe: string;
  current: string;
  upgrade: string;
  manageSub: string;
  perMonth: string;
  masters: string;
  unlimited: string;
  features: Record<string, string>;
  trialBanner: string;
  daysLeft: string;
  notConfigured: string;
}> = {
  ru: {
    currentPlan: "Текущий тариф",
    subscribe: "Подписаться",
    current: "Текущий",
    upgrade: "Перейти",
    manageSub: "Управление подпиской",
    perMonth: "/мес",
    masters: "мастеров",
    unlimited: "Без лимита",
    features: { ai: "AI ассистент", calendar: "Google Календарь", support: "Агенты поддержки", channels: "Каналы" },
    trialBanner: "Пробный период",
    daysLeft: "дней осталось",
    notConfigured: "Биллинг будет доступен в ближайшее время.",
  },
  ua: {
    currentPlan: "Поточний тариф",
    subscribe: "Підписатися",
    current: "Поточний",
    upgrade: "Перейти",
    manageSub: "Керування підпискою",
    perMonth: "/міс",
    masters: "майстрів",
    unlimited: "Без ліміту",
    features: { ai: "AI асистент", calendar: "Google Календар", support: "Агенти підтримки", channels: "Канали" },
    trialBanner: "Пробний період",
    daysLeft: "днів залишилось",
    notConfigured: "Білінг буде доступний найближчим часом.",
  },
  en: {
    currentPlan: "Current plan",
    subscribe: "Subscribe",
    current: "Current",
    upgrade: "Upgrade",
    manageSub: "Manage subscription",
    perMonth: "/mo",
    masters: "masters",
    unlimited: "Unlimited",
    features: { ai: "AI assistant", calendar: "Google Calendar", support: "Support agents", channels: "Channels" },
    trialBanner: "Trial period",
    daysLeft: "days left",
    notConfigured: "Billing will be available soon.",
  },
  pl: {
    currentPlan: "Obecny plan",
    subscribe: "Subskrybuj",
    current: "Obecny",
    upgrade: "Zmień",
    manageSub: "Zarządzanie subskrypcją",
    perMonth: "/mies",
    masters: "mistrzów",
    unlimited: "Bez limitu",
    features: { ai: "Asystent AI", calendar: "Google Kalendarz", support: "Agenci wsparcia", channels: "Kanały" },
    trialBanner: "Okres próbny",
    daysLeft: "dni pozostało",
    notConfigured: "Płatności będą dostępne wkrótce.",
  },
};

export function BillingSection({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const l = LABELS[lang];
  const billing = api.salon.getBillingStatus.useQuery({ tenantId });
  const plans = api.salon.getPlans.useQuery();

  const checkoutMut = api.salon.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const portalMut = api.salon.createBillingPortalSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const currentPlan = billing.data?.plan ?? "start";
  const billingStatus = billing.data?.billingStatus ?? "trialing";
  const hasStripeCustomer = !!billing.data?.stripeCustomerId;

  // Trial days remaining
  const trialDaysLeft = (() => {
    if (billingStatus !== "trialing" || !billing.data?.trialEndsAt) return null;
    const diff = billing.data.trialEndsAt - Math.floor(Date.now() / 1000);
    return Math.max(0, Math.ceil(diff / 86400));
  })();

  return (
    <div className="space-y-4">
      {/* Trial banner */}
      {trialDaysLeft !== null && trialDaysLeft >= 0 && (
        <section className="rounded-2xl bg-gradient-to-r from-brand-500/15 to-purple-500/15 border border-brand-500/20 p-4">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-brand-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{l.trialBanner}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {trialDaysLeft} {l.daysLeft}
              </p>
            </div>
            <div className="h-8 w-8 rounded-full bg-brand-500/20 flex items-center justify-center text-sm font-bold text-brand-400">
              {trialDaysLeft}
            </div>
          </div>
        </section>
      )}

      {/* Current billing status */}
      <section className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-brand-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{l.currentPlan}</h2>
        </div>
        {billing.isLoading ? (
          <div className="h-12 rounded-xl bg-slate-200 dark:bg-slate-700/40 animate-pulse" />
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-slate-900 dark:text-white uppercase">{currentPlan}</span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
              billingStatus === "active" ? "bg-emerald-500/15 text-emerald-500" :
              billingStatus === "trialing" ? "bg-sky-500/15 text-sky-500" :
              billingStatus === "grace_period" ? "bg-amber-500/15 text-amber-500" :
              "bg-red-500/15 text-red-500"
            }`}>
              {t(`billing.${billingStatus === "grace_period" ? "grace" : billingStatus}` as any, lang)}
            </span>
          </div>
        )}
      </section>

      {/* Plan comparison cards */}
      {plans.data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.data.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const isUpgrade = !isCurrent && (
              (currentPlan === "start" && (plan.id === "pro" || plan.id === "studio")) ||
              (currentPlan === "pro" && plan.id === "studio")
            );

            return (
              <div
                key={plan.id}
                className={`glass-card rounded-2xl p-4 space-y-3 transition-all ${
                  isCurrent ? "ring-2 ring-brand-500/40" : ""
                }`}
              >
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                    {plan.price}
                    <span className="text-xs font-normal text-slate-500"> {plan.currency}{l.perMonth}</span>
                  </p>
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {plan.masters === -1 ? l.unlimited : `${plan.masters} ${l.masters}`}
                </div>

                <ul className="space-y-1.5">
                  {Object.entries(plan.features).map(([key, value]) => {
                    if (key === "channels") return null;
                    const enabled = value as boolean;
                    return (
                      <li key={key} className="flex items-center gap-2 text-xs">
                        <Check className={`h-3 w-3 shrink-0 ${enabled ? "text-emerald-400" : "text-slate-600"}`} />
                        <span className={enabled ? "text-slate-700 dark:text-slate-300" : "text-slate-500 line-through"}>
                          {l.features[key] ?? key}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {isCurrent ? (
                  <div className="w-full py-2 rounded-xl bg-brand-500/10 text-center text-xs font-semibold text-brand-400">
                    {l.current}
                  </div>
                ) : (
                  <button
                    onClick={() => checkoutMut.mutate({ tenantId, plan: plan.id as "start" | "pro" | "studio" })}
                    disabled={checkoutMut.isPending}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand-600 text-white text-xs font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50"
                  >
                    {checkoutMut.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      isUpgrade ? l.upgrade : l.subscribe
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Manage subscription button */}
      {hasStripeCustomer && (
        <button
          onClick={() => portalMut.mutate({ tenantId })}
          disabled={portalMut.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-500/40 transition-colors disabled:opacity-50"
        >
          {portalMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {l.manageSub}
              <ExternalLink className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}

      {checkoutMut.error && (
        <p className="text-xs text-red-400 text-center">{checkoutMut.error.message}</p>
      )}
    </div>
  );
}
