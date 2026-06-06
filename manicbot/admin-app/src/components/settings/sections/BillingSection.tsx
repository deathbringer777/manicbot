"use client";

import { useState, useCallback, useEffect } from "react";
import { CreditCard, Check, Loader2, ExternalLink, Zap, X, CheckCircle2, AlertCircle, ShieldCheck } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { useRole } from "~/components/RoleContext";
import { api } from "~/trpc/react";
import { t } from "~/lib/i18n";
import type { Lang } from "~/lib/i18n";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { RetentionFlow } from "~/components/billing/RetentionFlow";

// Stripe.js loaded once — publishable key is baked in at build time
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

const LABELS: Record<Lang, {
  currentPlan: string;
  subscribe: string;
  current: string;
  upgrade: string;
  manageSub: string;
  cancelSub: string;
  perMonth: string;
  popular: string;
  trialBanner: string;
  daysLeft: string;
  notConfigured: string;
  paySuccess: string;
  paySuccessDesc: string;
  close: string;
  trialExpiredTitle: string;
  trialExpiredDesc: string;
  trialExpiredCta: string;
  lockedBadge: string;
  compedUntil: string;
  renewsOn: string;
  activeUntil: string;
  cancellingNote: string;
  trialEndsOn: string;
  paymentIssueUntil: string;
  usageMasters: string;
  usageUnlimited: string;
  invoicesTitle: string;
  invoiceReceipt: string;
  godMode: string;
  godModeDesc: string;
}> = {
  ru: {
    currentPlan: "Текущий тариф",
    subscribe: "Попробовать",
    current: "Текущий",
    upgrade: "Перейти",
    manageSub: "Платёжные данные и карта",
    cancelSub: "Отменить подписку",
    perMonth: "/мес",
    popular: "Популярный",
    trialBanner: "Пробный период",
    daysLeft: "дней осталось",
    notConfigured: "Биллинг будет доступен в ближайшее время.",
    paySuccess: "Оплата прошла успешно",
    paySuccessDesc: "Ваша подписка активна.",
    close: "Закрыть",
    trialExpiredTitle: "Доступ к панели ограничен",
    trialExpiredDesc: "Выберите тариф ниже, чтобы вернуть доступ к панели. Бот и все функции приостановлены до активации подписки.",
    trialExpiredCta: "Выберите тариф",
    lockedBadge: "Доступ ограничен",
    compedUntil: "Бесплатный доступ до",
    renewsOn: "Следующее списание",
    activeUntil: "Активна до",
    cancellingNote: "Подписка отменяется",
    trialEndsOn: "Пробный период до",
    paymentIssueUntil: "Проблема с оплатой · доступ до",
    usageMasters: "Мастеров",
    usageUnlimited: "без лимита",
    invoicesTitle: "История платежей",
    invoiceReceipt: "Чек",
    godMode: "God Mode",
    godModeDesc: "Все функции платформы разблокированы. Подписка не требуется.",
  },
  ua: {
    currentPlan: "Поточний тариф",
    subscribe: "Спробувати",
    current: "Поточний",
    upgrade: "Перейти",
    manageSub: "Платіжні дані та картка",
    cancelSub: "Скасувати підписку",
    perMonth: "/міс",
    popular: "Популярний",
    trialBanner: "Пробний період",
    daysLeft: "днів залишилось",
    notConfigured: "Білінг буде доступний найближчим часом.",
    paySuccess: "Оплата пройшла успішно",
    paySuccessDesc: "Ваша підписка активна.",
    close: "Закрити",
    trialExpiredTitle: "Доступ до панелі обмежено",
    trialExpiredDesc: "Оберіть тариф нижче, щоб повернути доступ до панелі. Бот та всі функції призупинено до активації підписки.",
    trialExpiredCta: "Оберіть тариф",
    lockedBadge: "Доступ обмежено",
    compedUntil: "Безкоштовний доступ до",
    renewsOn: "Наступне списання",
    activeUntil: "Активна до",
    cancellingNote: "Підписка скасовується",
    trialEndsOn: "Пробний період до",
    paymentIssueUntil: "Проблема з оплатою · доступ до",
    usageMasters: "Майстрів",
    usageUnlimited: "без ліміту",
    invoicesTitle: "Історія платежів",
    invoiceReceipt: "Чек",
    godMode: "God Mode",
    godModeDesc: "Всі функції платформи розблоковано. Підписка не потрібна.",
  },
  en: {
    currentPlan: "Current plan",
    subscribe: "Try it",
    current: "Current",
    upgrade: "Upgrade",
    manageSub: "Payment details & card",
    cancelSub: "Cancel subscription",
    perMonth: "/mo",
    popular: "Popular",
    trialBanner: "Trial period",
    daysLeft: "days left",
    notConfigured: "Billing will be available soon.",
    paySuccess: "Payment successful",
    paySuccessDesc: "Your subscription is now active.",
    close: "Close",
    trialExpiredTitle: "Dashboard access is limited",
    trialExpiredDesc: "Choose a plan below to restore dashboard access. Your bot and all features are paused until a subscription is active.",
    trialExpiredCta: "Choose a plan",
    lockedBadge: "Access limited",
    compedUntil: "Free access until",
    renewsOn: "Next charge",
    activeUntil: "Active until",
    cancellingNote: "Subscription is ending",
    trialEndsOn: "Trial ends",
    paymentIssueUntil: "Payment issue · access until",
    usageMasters: "Specialists",
    usageUnlimited: "unlimited",
    invoicesTitle: "Payment history",
    invoiceReceipt: "Receipt",
    godMode: "God Mode",
    godModeDesc: "All platform features are unlocked. No subscription required.",
  },
  pl: {
    currentPlan: "Obecny plan",
    subscribe: "Wypróbuj",
    current: "Obecny",
    upgrade: "Zmień",
    manageSub: "Dane płatności i karta",
    cancelSub: "Anuluj subskrypcję",
    perMonth: "/mies",
    popular: "Popularny",
    trialBanner: "Okres próbny",
    daysLeft: "dni pozostało",
    notConfigured: "Płatności będą dostępne wkrótce.",
    paySuccess: "Płatność zakończona sukcesem",
    paySuccessDesc: "Twoja subskrypcja jest aktywna.",
    close: "Zamknij",
    trialExpiredTitle: "Dostęp do panelu jest ograniczony",
    trialExpiredDesc: "Wybierz plan poniżej, aby przywrócić dostęp do panelu. Bot i wszystkie funkcje są wstrzymane do aktywacji subskrypcji.",
    trialExpiredCta: "Wybierz plan",
    lockedBadge: "Dostęp ograniczony",
    compedUntil: "Darmowy dostęp do",
    renewsOn: "Następne obciążenie",
    activeUntil: "Aktywna do",
    cancellingNote: "Subskrypcja jest anulowana",
    trialEndsOn: "Okres próbny do",
    paymentIssueUntil: "Problem z płatnością · dostęp do",
    usageMasters: "Specjalistów",
    usageUnlimited: "bez limitu",
    invoicesTitle: "Historia płatności",
    invoiceReceipt: "Paragon",
    godMode: "God Mode",
    godModeDesc: "Wszystkie funkcje platformy są odblokowane. Subskrypcja nie jest wymagana.",
  },
};

// ─── Checkout modal ───────────────────────────────────────────────────────────

function CheckoutModal({
  clientSecret,
  onClose,
  lang,
}: {
  clientSecret: string;
  onClose: () => void;
  lang: Lang;
}) {
  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!stripePromise) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t("billing.checkout.title", lang)}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            {t("billing.checkout.title", lang)}
          </span>
          <button
            onClick={onClose}
            aria-label={t("common.close", lang)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stripe Embedded Checkout — Apple Pay / Google Pay included automatically */}
        <div className="overflow-y-auto flex-1">
          <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={{ clientSecret }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}

// ─── BillingSection ──────────────────────────────────────────────────────────

export function BillingSection({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const { role } = useRole();
  const l = LABELS[lang];

  // ── God Mode: system_admin (no per-tenant impersonation) ─────────────────────
  if (role === "system_admin") {
    return (
      <div className="space-y-4">
        <div className="glass-card rounded-2xl p-6 text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <ShieldCheck className="h-6 w-6 text-brand-400" />
            <span className="text-lg font-bold text-slate-900 dark:text-white">{l.godMode}</span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{l.godModeDesc}</p>
        </div>
      </div>
    );
  }

  const utils = api.useUtils();
  const billing = api.salon.getBillingStatus.useQuery({ tenantId });
  const plans = api.salon.getPlans.useQuery();
  // Inline payment history — only fetched once we know a Stripe customer exists.
  const invoices = api.salon.listInvoices.useQuery(
    { tenantId },
    { enabled: !!billing.data?.stripeCustomerId },
  );

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [retentionOpen, setRetentionOpen] = useState(false);

  // Detect return from Stripe Embedded Checkout (checkout=success in URL)
  const [showSuccess, setShowSuccess] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      setShowSuccess(true);
      // Clean up URL without reloading the page
      const cleaned = window.location.pathname + "?section=billing";
      window.history.replaceState({}, "", cleaned);
      // Refresh billing data
      void utils.salon.getBillingStatus.invalidate({ tenantId });
    }
  }, [tenantId, utils]);

  // Use embedded checkout if Stripe.js publishable key is configured,
  // fall back to redirect checkout otherwise
  const hasEmbedded = !!stripePromise;

  const embeddedMut = api.salon.createEmbeddedCheckout.useMutation({
    onSuccess: (data) => setClientSecret(data.clientSecret),
  });

  const checkoutMut = api.salon.createCheckoutSession.useMutation({
    onSuccess: (data) => { window.location.href = data.url; },
  });

  const portalMut = api.salon.createBillingPortalSession.useMutation({
    onSuccess: (data) => { window.location.href = data.url; },
  });

  const handleSubscribe = useCallback((plan: "start" | "pro" | "max") => {
    if (hasEmbedded) {
      embeddedMut.mutate({ tenantId, plan, locale: lang });
    } else {
      checkoutMut.mutate({ tenantId, plan, locale: lang });
    }
  }, [hasEmbedded, embeddedMut, checkoutMut, tenantId, lang]);

  const handleCloseCheckout = useCallback(() => {
    setClientSecret(null);
    void utils.salon.getBillingStatus.invalidate({ tenantId });
  }, [tenantId, utils]);

  const isBusy = embeddedMut.isPending || checkoutMut.isPending;
  const mutError = embeddedMut.error ?? checkoutMut.error;

  const currentPlan = billing.data?.plan ?? "start";
  const billingStatus = billing.data?.billingStatus ?? "trialing";
  const hasStripeCustomer = !!billing.data?.stripeCustomerId;
  // A real Stripe subscription must back the plan for "Cancel subscription" to
  // mean anything. A comped grant may have a customer but no subscription.
  const hasActiveSubscription = !!billing.data?.hasActiveSubscription;
  const isComped = !!billing.data?.isComped;
  // "Locked" = access has lapsed (expired trial, churned/cancelled, or any
  // terminal inactive state). Comped grants are `active`, so never locked.
  const isBillingLocked = billingStatus === "inactive" || billingStatus === "canceled";

  const trialDaysLeft = (() => {
    if (billingStatus !== "trialing" || !billing.data?.trialEndsAt) return null;
    const diff = billing.data.trialEndsAt - Math.floor(Date.now() / 1000);
    return Math.max(0, Math.ceil(diff / 86400));
  })();

  // Shared short-date formatter (locale-aware; 'ua' → 'uk' for Intl).
  const fmtDate = (sec: number) =>
    new Date(sec * 1000).toLocaleDateString(lang === "ua" ? "uk" : lang, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  // Comped "free until <date>" badge in the status card.
  const compedUntil =
    isComped && billing.data?.currentPeriodEnd ? fmtDate(billing.data.currentPeriodEnd) : null;

  // One human line describing what this account IS and the date that matters —
  // the heart of "is this paid / trial / comped / lapsed, and until when".
  const accountSummary: { label: string; value: string } | null = (() => {
    const d = billing.data;
    if (!d || isComped) return null; // comped handled by the badge above
    if (billingStatus === "trialing" && d.trialEndsAt) {
      return { label: l.trialEndsOn, value: fmtDate(d.trialEndsAt) };
    }
    if (billingStatus === "grace_period" && d.graceEndsAt) {
      return { label: l.paymentIssueUntil, value: fmtDate(d.graceEndsAt) };
    }
    if (d.cancelAtPeriodEnd && d.currentPeriodEnd) {
      return { label: `${l.cancellingNote} · ${l.activeUntil}`, value: fmtDate(d.currentPeriodEnd) };
    }
    if (hasActiveSubscription && (d.nextPaymentDate || d.currentPeriodEnd)) {
      return { label: l.renewsOn, value: fmtDate((d.nextPaymentDate || d.currentPeriodEnd)!) };
    }
    return null;
  })();

  // Plan utilisation: active staff vs the plan's seat limit (∞ on Max).
  const mastersLimit = currentPlan === "start" ? 1 : currentPlan === "pro" ? 5 : null;
  const mastersUsed = billing.data?.mastersCount ?? null;

  // Currency formatter for invoice amounts (minor units → locale currency).
  const fmtMoney = (minor: number, currency: string) => {
    try {
      return new Intl.NumberFormat(lang === "ua" ? "uk" : lang, {
        style: "currency",
        currency: currency || "PLN",
        maximumFractionDigits: 2,
      }).format(minor / 100);
    } catch {
      return `${(minor / 100).toFixed(2)} ${currency}`;
    }
  };

  return (
    <div className="space-y-4">
      {/* Checkout modal */}
      {clientSecret && (
        <CheckoutModal clientSecret={clientSecret} onClose={handleCloseCheckout} lang={lang} />
      )}

      {/* Payment success banner */}
      {showSuccess && (
        <section className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{l.paySuccess}</p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-500/70">{l.paySuccessDesc}</p>
            </div>
            <button onClick={() => setShowSuccess(false)} className="text-emerald-400 hover:text-emerald-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {/* Billing locked — hard block (expired trial, churned, or cancelled) */}
      {isBillingLocked && (
        <section className="rounded-2xl bg-red-500/10 border border-red-500/30 p-5 space-y-2">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700 dark:text-red-400">{l.trialExpiredTitle}</p>
              <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-0.5">{l.trialExpiredDesc}</p>
            </div>
          </div>
        </section>
      )}

      {/* Trial banner — only when days > 0 */}
      {trialDaysLeft !== null && trialDaysLeft > 0 && (
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-slate-900 dark:text-white uppercase">{currentPlan}</span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
                billingStatus === "active" ? "bg-emerald-500/15 text-emerald-500" :
                billingStatus === "trialing" ? "bg-sky-500/15 text-sky-500" :
                billingStatus === "grace_period" ? "bg-amber-500/15 text-amber-500" :
                "bg-red-500/15 text-red-500"
              }`}>
                {isBillingLocked
                  ? l.lockedBadge
                  : t(`billing.${billingStatus === "grace_period" ? "grace" : billingStatus}` as any, lang)
                }
              </span>
            </div>
            {compedUntil && (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {l.compedUntil} {compedUntil}
              </p>
            )}
            {accountSummary && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {accountSummary.label}:{" "}
                <span className="font-medium text-slate-700 dark:text-slate-300">{accountSummary.value}</span>
              </p>
            )}
            {mastersUsed !== null && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {l.usageMasters}:{" "}
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {mastersUsed}
                  {mastersLimit !== null ? ` / ${mastersLimit}` : ` · ${l.usageUnlimited}`}
                </span>
              </p>
            )}
          </div>
        )}
      </section>

      {/* Plan comparison cards */}
      {plans.data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.data.map((plan) => {
            const isCurrent = plan.id === currentPlan && !isBillingLocked;
            const isUpgrade = !isCurrent && !isBillingLocked && (
              (currentPlan === "start" && (plan.id === "pro" || plan.id === "max")) ||
              (currentPlan === "pro" && plan.id === "max")
            );
            const features = (plan.featureList as Record<string, string[]>)?.[lang]
              ?? (plan.featureList as Record<string, string[]>)?.en
              ?? [];
            const subtitle = (plan.subtitle as Record<string, string>)?.[lang]
              ?? (plan.subtitle as Record<string, string>)?.en
              ?? "";

            return (
              <div
                key={plan.id}
                className={`glass-card rounded-2xl p-4 space-y-3 transition-all relative ${
                  plan.popular ? "ring-2 ring-brand-500/40" : ""
                } ${isCurrent ? "ring-2 ring-brand-500/40" : ""}`}
              >
                {plan.popular && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full bg-gradient-to-r from-brand-500 to-purple-500 text-[10px] font-bold text-white uppercase tracking-wide">
                      {l.popular}
                    </span>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                  {subtitle && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
                  )}
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2">
                    {plan.price}
                    <span className="text-xs font-normal text-slate-500"> zł{l.perMonth}</span>
                  </p>
                </div>

                <ul className="space-y-1.5">
                  {features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs">
                      <Check className="h-3 w-3 shrink-0 text-emerald-400 mt-0.5" />
                      <span className="text-slate-700 dark:text-slate-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="w-full py-2 rounded-xl bg-brand-500/10 text-center text-xs font-semibold text-brand-400">
                    {l.current}
                  </div>
                ) : (
                  <button
                    onClick={() => handleSubscribe(plan.id as "start" | "pro" | "max")}
                    disabled={isBusy}
                    className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
                      plan.popular || isBillingLocked
                        ? "bg-gradient-to-r from-brand-600 to-purple-600 text-white hover:from-brand-500 hover:to-purple-500"
                        : "bg-brand-600 text-white hover:bg-brand-500"
                    }`}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      isBillingLocked ? l.trialExpiredCta : isUpgrade ? l.upgrade : l.subscribe
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

      {/* Payment history — a tenant's own recent invoices, inline. Hidden when
          there are none (or no Stripe customer). Receipt links open the Stripe
          PDF / hosted invoice. */}
      {invoices.data && invoices.data.data.length > 0 && (
        <section className="glass-card rounded-2xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{l.invoicesTitle}</h2>
          <ul className="divide-y divide-slate-200/70 dark:divide-slate-700/50">
            {invoices.data.data.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <div className="flex flex-col">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {fmtMoney(inv.amount, inv.currency)}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">{fmtDate(inv.created)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                      inv.paid
                        ? "bg-emerald-500/15 text-emerald-500"
                        : inv.status === "open"
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-slate-500/15 text-slate-400"
                    }`}
                  >
                    {inv.status || (inv.paid ? "paid" : "")}
                  </span>
                  {(inv.pdfUrl ?? inv.hostedUrl) && (
                    <a
                      href={(inv.pdfUrl ?? inv.hostedUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300"
                    >
                      {l.invoiceReceipt}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Cancel subscription — opens 3-stage retention flow.
          Gated on a REAL Stripe subscription (hasActiveSubscription), NOT merely
          on a Stripe customer: a comped grant can have a customer but no
          subscription, and requestCancellation throws `no_active_subscription`
          for it — which previously surfaced as the generic "что-то пошло не так"
          toast. Also hidden once already scheduled to cancel at period end.
          Manage subscription (Stripe Portal) stays for card/invoice management. */}
      {hasActiveSubscription && billing.data && !billing.data.cancelAtPeriodEnd &&
        (billingStatus === "active" || billingStatus === "trialing") && (
          <button
            type="button"
            onClick={() => setRetentionOpen(true)}
            className="w-full text-center text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors py-1"
            data-testid="cancel-subscription-trigger"
          >
            {l.cancelSub}
          </button>
        )}

      {retentionOpen && (
        <RetentionFlow
          tenantId={tenantId}
          onClose={() => setRetentionOpen(false)}
          onCancelled={() => {
            void utils.salon.getBillingStatus.invalidate({ tenantId });
          }}
          onRetained={() => {
            void utils.salon.getBillingStatus.invalidate({ tenantId });
          }}
        />
      )}

      {mutError && (
        <p className="text-xs text-red-400 text-center">{mutError.message}</p>
      )}
    </div>
  );
}
