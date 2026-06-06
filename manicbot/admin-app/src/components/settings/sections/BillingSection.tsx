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
  godMode: string;
  godModeDesc: string;
}> = {
  ru: {
    currentPlan: "Текущий тариф",
    subscribe: "Попробовать",
    current: "Текущий",
    upgrade: "Перейти",
    manageSub: "Управление подпиской",
    cancelSub: "Отменить подписку",
    perMonth: "/мес",
    popular: "Популярный",
    trialBanner: "Пробный период",
    daysLeft: "дней осталось",
    notConfigured: "Биллинг будет доступен в ближайшее время.",
    paySuccess: "Оплата прошла успешно",
    paySuccessDesc: "Ваша подписка активна.",
    close: "Закрыть",
    trialExpiredTitle: "Пробный период завершён",
    trialExpiredDesc: "Выберите тариф ниже, чтобы продолжить пользоваться ManicBot. Бот и все функции приостановлены до активации подписки.",
    trialExpiredCta: "Выберите тариф",
    godMode: "God Mode",
    godModeDesc: "Все функции платформы разблокированы. Подписка не требуется.",
  },
  ua: {
    currentPlan: "Поточний тариф",
    subscribe: "Спробувати",
    current: "Поточний",
    upgrade: "Перейти",
    manageSub: "Керування підпискою",
    cancelSub: "Скасувати підписку",
    perMonth: "/міс",
    popular: "Популярний",
    trialBanner: "Пробний період",
    daysLeft: "днів залишилось",
    notConfigured: "Білінг буде доступний найближчим часом.",
    paySuccess: "Оплата пройшла успішно",
    paySuccessDesc: "Ваша підписка активна.",
    close: "Закрити",
    trialExpiredTitle: "Пробний період завершено",
    trialExpiredDesc: "Оберіть тариф нижче, щоб продовжити користуватися ManicBot. Бот та всі функції призупинено до активації підписки.",
    trialExpiredCta: "Оберіть тариф",
    godMode: "God Mode",
    godModeDesc: "Всі функції платформи розблоковано. Підписка не потрібна.",
  },
  en: {
    currentPlan: "Current plan",
    subscribe: "Try it",
    current: "Current",
    upgrade: "Upgrade",
    manageSub: "Manage subscription",
    cancelSub: "Cancel subscription",
    perMonth: "/mo",
    popular: "Popular",
    trialBanner: "Trial period",
    daysLeft: "days left",
    notConfigured: "Billing will be available soon.",
    paySuccess: "Payment successful",
    paySuccessDesc: "Your subscription is now active.",
    close: "Close",
    trialExpiredTitle: "Trial period ended",
    trialExpiredDesc: "Choose a plan below to continue using ManicBot. Your bot and all features are paused until a subscription is active.",
    trialExpiredCta: "Choose a plan",
    godMode: "God Mode",
    godModeDesc: "All platform features are unlocked. No subscription required.",
  },
  pl: {
    currentPlan: "Obecny plan",
    subscribe: "Wypróbuj",
    current: "Obecny",
    upgrade: "Zmień",
    manageSub: "Zarządzanie subskrypcją",
    cancelSub: "Anuluj subskrypcję",
    perMonth: "/mies",
    popular: "Popularny",
    trialBanner: "Okres próbny",
    daysLeft: "dni pozostało",
    notConfigured: "Płatności będą dostępne wkrótce.",
    paySuccess: "Płatność zakończona sukcesem",
    paySuccessDesc: "Twoja subskrypcja jest aktywna.",
    close: "Zamknij",
    trialExpiredTitle: "Okres próbny zakończony",
    trialExpiredDesc: "Wybierz plan poniżej, aby kontynuować korzystanie z ManicBot. Bot i wszystkie funkcje są wstrzymane do aktywacji subskrypcji.",
    trialExpiredCta: "Wybierz plan",
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4"
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
  const isTrialExpired = billingStatus === "inactive" && !hasStripeCustomer;

  const trialDaysLeft = (() => {
    if (billingStatus !== "trialing" || !billing.data?.trialEndsAt) return null;
    const diff = billing.data.trialEndsAt - Math.floor(Date.now() / 1000);
    return Math.max(0, Math.ceil(diff / 86400));
  })();

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

      {/* Trial expired — hard block */}
      {isTrialExpired && (
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
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-slate-900 dark:text-white uppercase">{currentPlan}</span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
              billingStatus === "active" ? "bg-emerald-500/15 text-emerald-500" :
              billingStatus === "trialing" ? "bg-sky-500/15 text-sky-500" :
              billingStatus === "grace_period" ? "bg-amber-500/15 text-amber-500" :
              "bg-red-500/15 text-red-500"
            }`}>
              {isTrialExpired
                ? (lang === "ru" ? "Триал истёк" : lang === "ua" ? "Триал закінчився" : lang === "pl" ? "Próba wygasła" : "Trial expired")
                : t(`billing.${billingStatus === "grace_period" ? "grace" : billingStatus}` as any, lang)
              }
            </span>
          </div>
        )}
      </section>

      {/* Plan comparison cards */}
      {plans.data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.data.map((plan) => {
            const isCurrent = plan.id === currentPlan && !isTrialExpired;
            const isUpgrade = !isCurrent && !isTrialExpired && (
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
                      plan.popular || isTrialExpired
                        ? "bg-gradient-to-r from-brand-600 to-purple-600 text-white hover:from-brand-500 hover:to-purple-500"
                        : "bg-brand-600 text-white hover:bg-brand-500"
                    }`}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      isTrialExpired ? l.trialExpiredCta : isUpgrade ? l.upgrade : l.subscribe
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

      {/* Cancel subscription — opens 3-stage retention flow.
          Shown only when the subscription is active AND not already
          scheduled to cancel at period end.
          The historical "go straight to Stripe Customer Portal" path is now
          unreachable for the explicit cancel intent — Manage subscription
          stays for invoice/payment-method management. */}
      {hasStripeCustomer && billing.data && !billing.data.cancelAtPeriodEnd &&
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
