"use client";

import { useState, useCallback, useEffect } from "react";
import { CreditCard, Check, Loader2, ExternalLink, Zap, X, CheckCircle2, AlertCircle, ShieldCheck, PauseCircle, PlayCircle, CalendarClock } from "lucide-react";
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

type Plan = "start" | "pro" | "max";
const PLAN_RANK: Record<Plan, number> = { start: 0, pro: 1, max: 2 };

const LABELS: Record<Lang, {
  currentPlan: string; subscribe: string; current: string; upgrade: string; downgrade: string;
  manageSub: string; cancelSub: string; perMonth: string; popular: string; trialBanner: string;
  daysLeft: string; notConfigured: string; paySuccess: string; paySuccessDesc: string; close: string;
  trialExpiredTitle: string; trialExpiredDesc: string; trialExpiredCta: string; godMode: string; godModeDesc: string;
  pauseSub: string; resumeSub: string; pausedPill: string; pausedDesc: string;
  pendingTitle: string; pendingDesc: string; undo: string; scheduled: string;
  upgradeTitle: string; downgradeTitle: string; upgradeDesc: string; downgradeDesc: string;
  chargeNow: string; confirm: string; cancelBtn: string; effectiveOn: string;
}> = {
  ru: {
    currentPlan: "Текущий тариф", subscribe: "Попробовать", current: "Текущий", upgrade: "Повысить", downgrade: "Понизить",
    manageSub: "Платёжные данные", cancelSub: "Отменить подписку", perMonth: "/мес", popular: "Популярный", trialBanner: "Пробный период",
    daysLeft: "дней осталось", notConfigured: "Биллинг будет доступен в ближайшее время.", paySuccess: "Оплата прошла успешно",
    paySuccessDesc: "Ваша подписка активна.", close: "Закрыть", trialExpiredTitle: "Пробный период завершён",
    trialExpiredDesc: "Выберите тариф ниже, чтобы продолжить пользоваться ManicBot. Бот и все функции приостановлены до активации подписки.",
    trialExpiredCta: "Выберите тариф", godMode: "God Mode", godModeDesc: "Все функции платформы разблокированы. Подписка не требуется.",
    pauseSub: "Приостановить подписку", resumeSub: "Возобновить подписку", pausedPill: "На паузе",
    pausedDesc: "Подписка на паузе — оплата не списывается, бот и функции приостановлены.",
    pendingTitle: "Запланировано понижение тарифа", pendingDesc: "С {date} тариф изменится на", undo: "Отменить", scheduled: "Запланирован",
    upgradeTitle: "Повысить тариф", downgradeTitle: "Понизить тариф",
    upgradeDesc: "Тариф изменится сразу. Спишется разница за остаток текущего периода.",
    downgradeDesc: "Текущий тариф сохранится до конца оплаченного периода. Деньги не возвращаются — со следующего периода тариф станет дешевле.",
    chargeNow: "К оплате сейчас", confirm: "Подтвердить", cancelBtn: "Отмена", effectiveOn: "Вступит в силу",
  },
  ua: {
    currentPlan: "Поточний тариф", subscribe: "Спробувати", current: "Поточний", upgrade: "Підвищити", downgrade: "Понизити",
    manageSub: "Платіжні дані", cancelSub: "Скасувати підписку", perMonth: "/міс", popular: "Популярний", trialBanner: "Пробний період",
    daysLeft: "днів залишилось", notConfigured: "Білінг буде доступний найближчим часом.", paySuccess: "Оплата пройшла успішно",
    paySuccessDesc: "Ваша підписка активна.", close: "Закрити", trialExpiredTitle: "Пробний період завершено",
    trialExpiredDesc: "Оберіть тариф нижче, щоб продовжити користуватися ManicBot. Бот та всі функції призупинено до активації підписки.",
    trialExpiredCta: "Оберіть тариф", godMode: "God Mode", godModeDesc: "Всі функції платформи розблоковано. Підписка не потрібна.",
    pauseSub: "Призупинити підписку", resumeSub: "Відновити підписку", pausedPill: "На паузі",
    pausedDesc: "Підписку призупинено — оплата не списується, бот і функції призупинені.",
    pendingTitle: "Заплановано пониження тарифу", pendingDesc: "З {date} тариф зміниться на", undo: "Скасувати", scheduled: "Заплановано",
    upgradeTitle: "Підвищити тариф", downgradeTitle: "Понизити тариф",
    upgradeDesc: "Тариф зміниться одразу. Спишеться різниця за залишок поточного періоду.",
    downgradeDesc: "Поточний тариф збережеться до кінця оплаченого періоду. Кошти не повертаються — з наступного періоду тариф стане дешевшим.",
    chargeNow: "До сплати зараз", confirm: "Підтвердити", cancelBtn: "Скасувати", effectiveOn: "Набуде чинності",
  },
  en: {
    currentPlan: "Current plan", subscribe: "Try it", current: "Current", upgrade: "Upgrade", downgrade: "Downgrade",
    manageSub: "Billing details", cancelSub: "Cancel subscription", perMonth: "/mo", popular: "Popular", trialBanner: "Trial period",
    daysLeft: "days left", notConfigured: "Billing will be available soon.", paySuccess: "Payment successful",
    paySuccessDesc: "Your subscription is now active.", close: "Close", trialExpiredTitle: "Trial period ended",
    trialExpiredDesc: "Choose a plan below to continue using ManicBot. Your bot and all features are paused until a subscription is active.",
    trialExpiredCta: "Choose a plan", godMode: "God Mode", godModeDesc: "All platform features are unlocked. No subscription required.",
    pauseSub: "Pause subscription", resumeSub: "Resume subscription", pausedPill: "Paused",
    pausedDesc: "Subscription paused — no charges, and the bot and features are paused.",
    pendingTitle: "Downgrade scheduled", pendingDesc: "On {date} your plan changes to", undo: "Undo", scheduled: "Scheduled",
    upgradeTitle: "Upgrade plan", downgradeTitle: "Downgrade plan",
    upgradeDesc: "Your plan changes immediately. You'll be charged the prorated difference for the rest of the current period.",
    downgradeDesc: "You keep your current plan until the end of the paid period. No refund — your plan gets cheaper from the next period.",
    chargeNow: "Charged now", confirm: "Confirm", cancelBtn: "Cancel", effectiveOn: "Takes effect",
  },
  pl: {
    currentPlan: "Obecny plan", subscribe: "Wypróbuj", current: "Obecny", upgrade: "Podnieś", downgrade: "Obniż",
    manageSub: "Dane płatności", cancelSub: "Anuluj subskrypcję", perMonth: "/mies", popular: "Popularny", trialBanner: "Okres próbny",
    daysLeft: "dni pozostało", notConfigured: "Płatności będą dostępne wkrótce.", paySuccess: "Płatność zakończona sukcesem",
    paySuccessDesc: "Twoja subskrypcja jest aktywna.", close: "Zamknij", trialExpiredTitle: "Okres próbny zakończony",
    trialExpiredDesc: "Wybierz plan poniżej, aby kontynuować korzystanie z ManicBot. Bot i wszystkie funkcje są wstrzymane do aktywacji subskrypcji.",
    trialExpiredCta: "Wybierz plan", godMode: "God Mode", godModeDesc: "Wszystkie funkcje platformy są odblokowane. Subskrypcja nie jest wymagana.",
    pauseSub: "Wstrzymaj subskrypcję", resumeSub: "Wznów subskrypcję", pausedPill: "Wstrzymana",
    pausedDesc: "Subskrypcja wstrzymana — brak opłat, bot i funkcje są wstrzymane.",
    pendingTitle: "Zaplanowano obniżenie planu", pendingDesc: "Od {date} plan zmieni się na", undo: "Cofnij", scheduled: "Zaplanowano",
    upgradeTitle: "Podnieś plan", downgradeTitle: "Obniż plan",
    upgradeDesc: "Plan zmienia się natychmiast. Pobierzemy proporcjonalną różnicę za resztę bieżącego okresu.",
    downgradeDesc: "Zachowujesz obecny plan do końca opłaconego okresu. Bez zwrotu — od następnego okresu plan będzie tańszy.",
    chargeNow: "Do zapłaty teraz", confirm: "Potwierdź", cancelBtn: "Anuluj", effectiveOn: "Wchodzi w życie",
  },
};

function fmtDate(unixSec: number | null | undefined, lang: Lang): string {
  if (!unixSec) return "";
  const locale = lang === "ru" ? "ru-RU" : lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : "en-GB";
  return new Date(unixSec * 1000).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

// ─── Checkout modal ───────────────────────────────────────────────────────────

function CheckoutModal({ clientSecret, onClose, lang }: { clientSecret: string; onClose: () => void; lang: Lang }) {
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
      role="dialog" aria-modal="true" aria-label={t("billing.checkout.title", lang)}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">{t("billing.checkout.title", lang)}</span>
          <button onClick={onClose} aria-label={t("common.close", lang)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}

// ─── Plan-change confirm modal (upgrade / downgrade) ────────────────────────────

function PlanChangeModal({
  tenantId, target, kind, lang, onClose, onConfirm, busy,
}: {
  tenantId: string;
  target: Plan;
  kind: "upgrade" | "downgrade";
  lang: Lang;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const l = LABELS[lang];
  // Only upgrades incur an immediate prorated charge — preview it.
  const preview = api.salon.previewPlanChange.useQuery(
    { tenantId, plan: target },
    { enabled: kind === "upgrade", staleTime: 0, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      role="dialog" aria-modal="true"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-brand-400" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {kind === "upgrade" ? l.upgradeTitle : l.downgradeTitle}
            {" → "}
            <span className="uppercase">{target}</span>
          </h3>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300">
          {kind === "upgrade" ? l.upgradeDesc : l.downgradeDesc}
        </p>

        {kind === "upgrade" && (
          <div className="rounded-xl bg-brand-500/10 px-4 py-3 text-sm">
            <span className="text-slate-500 dark:text-slate-400">{l.chargeNow}: </span>
            <span className="font-bold text-slate-900 dark:text-white">
              {preview.isLoading ? "…" : preview.data ? `${(preview.data.amountDue / 100).toFixed(2)} zł` : "—"}
            </span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button" onClick={onClose} disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {l.cancelBtn}
          </button>
          <button
            type="button" onClick={onConfirm} disabled={busy}
            className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-500 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : l.confirm}
          </button>
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
  const [planChange, setPlanChange] = useState<{ target: Plan; kind: "upgrade" | "downgrade" } | null>(null);

  // Detect return from Stripe Embedded Checkout (checkout=success in URL)
  const [showSuccess, setShowSuccess] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      setShowSuccess(true);
      const cleaned = window.location.pathname + "?section=billing";
      window.history.replaceState({}, "", cleaned);
      void utils.salon.getBillingStatus.invalidate({ tenantId });
    }
  }, [tenantId, utils]);

  const hasEmbedded = !!stripePromise;
  const refreshBilling = useCallback(() => { void utils.salon.getBillingStatus.invalidate({ tenantId }); }, [tenantId, utils]);

  const embeddedMut = api.salon.createEmbeddedCheckout.useMutation({ onSuccess: (data) => setClientSecret(data.clientSecret) });
  const checkoutMut = api.salon.createCheckoutSession.useMutation({ onSuccess: (data) => { window.location.href = data.url; } });
  const portalMut = api.salon.createBillingPortalSession.useMutation({ onSuccess: (data) => { window.location.href = data.url; } });

  const changePlanMut = api.salon.changePlan.useMutation({ onSuccess: () => { setPlanChange(null); refreshBilling(); } });
  const pauseMut = api.salon.pauseSubscription.useMutation({ onSuccess: refreshBilling });
  const resumeMut = api.salon.resumeSubscription.useMutation({ onSuccess: refreshBilling });
  const cancelDowngradeMut = api.salon.cancelPendingDowngrade.useMutation({ onSuccess: refreshBilling });

  const handleSubscribe = useCallback((plan: Plan) => {
    if (hasEmbedded) embeddedMut.mutate({ tenantId, plan, locale: lang });
    else checkoutMut.mutate({ tenantId, plan, locale: lang });
  }, [hasEmbedded, embeddedMut, checkoutMut, tenantId, lang]);

  const handleCloseCheckout = useCallback(() => { setClientSecret(null); refreshBilling(); }, [refreshBilling]);

  const isBusy = embeddedMut.isPending || checkoutMut.isPending;
  const mutError = embeddedMut.error ?? checkoutMut.error ?? changePlanMut.error ?? pauseMut.error ?? resumeMut.error;

  const currentPlan = (billing.data?.plan ?? "start") as Plan;
  const billingStatus = billing.data?.billingStatus ?? "trialing";
  const hasStripeCustomer = !!billing.data?.stripeCustomerId;
  const hasSubscription = !!billing.data?.hasSubscription;
  const isTrialExpired = billingStatus === "inactive" && !hasStripeCustomer;
  const isPaused = billingStatus === "paused";
  const pendingPlan = billing.data?.pendingPlan as Plan | null | undefined;
  const pendingEffectiveAt = billing.data?.pendingPlanEffectiveAt ?? null;

  // In-app plan change is available only for a live, active subscription.
  // Trial / inactive / no-customer go through checkout; paused only resumes.
  const canChangePlan = hasSubscription && billingStatus === "active";

  const trialDaysLeft = (() => {
    if (billingStatus !== "trialing" || !billing.data?.trialEndsAt) return null;
    const diff = billing.data.trialEndsAt - Math.floor(Date.now() / 1000);
    return Math.max(0, Math.ceil(diff / 86400));
  })();

  return (
    <div className="space-y-4">
      {clientSecret && <CheckoutModal clientSecret={clientSecret} onClose={handleCloseCheckout} lang={lang} />}

      {planChange && (
        <PlanChangeModal
          tenantId={tenantId}
          target={planChange.target}
          kind={planChange.kind}
          lang={lang}
          busy={changePlanMut.isPending}
          onClose={() => setPlanChange(null)}
          onConfirm={() => changePlanMut.mutate({ tenantId, plan: planChange.target })}
        />
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
            <button onClick={() => setShowSuccess(false)} className="text-emerald-400 hover:text-emerald-600"><X className="h-4 w-4" /></button>
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

      {/* Paused banner */}
      {isPaused && (
        <section className="rounded-2xl bg-violet-500/10 border border-violet-500/30 p-4">
          <div className="flex items-center gap-3">
            <PauseCircle className="h-5 w-5 text-violet-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">{l.pausedPill}</p>
              <p className="text-xs text-violet-600/70 dark:text-violet-400/70">{l.pausedDesc}</p>
            </div>
            <button
              onClick={() => resumeMut.mutate({ tenantId })}
              disabled={resumeMut.isPending}
              className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
            >
              {resumeMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><PlayCircle className="h-3.5 w-3.5" />{l.resumeSub}</>}
            </button>
          </div>
        </section>
      )}

      {/* Pending downgrade banner */}
      {pendingPlan && (
        <section className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">{l.pendingTitle}</p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
                {l.pendingDesc.replace("{date}", fmtDate(pendingEffectiveAt, lang))} <span className="font-bold uppercase">{pendingPlan}</span>
              </p>
            </div>
            <button
              onClick={() => cancelDowngradeMut.mutate({ tenantId })}
              disabled={cancelDowngradeMut.isPending}
              className="rounded-xl bg-white dark:bg-slate-800 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {cancelDowngradeMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : l.undo}
            </button>
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
              <p className="text-xs text-slate-500 dark:text-slate-400">{trialDaysLeft} {l.daysLeft}</p>
            </div>
            <div className="h-8 w-8 rounded-full bg-brand-500/20 flex items-center justify-center text-sm font-bold text-brand-400">{trialDaysLeft}</div>
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
              billingStatus === "paused" ? "bg-violet-500/15 text-violet-500" :
              "bg-red-500/15 text-red-500"
            }`}>
              {isTrialExpired
                ? (lang === "ru" ? "Триал истёк" : lang === "ua" ? "Триал закінчився" : lang === "pl" ? "Próba wygasła" : "Trial expired")
                : isPaused ? l.pausedPill
                : t(`billing.${billingStatus === "grace_period" ? "grace" : billingStatus}` as never, lang)}
            </span>
          </div>
        )}
      </section>

      {/* Plan comparison cards */}
      {plans.data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.data.map((plan) => {
            const planId = plan.id as Plan;
            const isCurrent = planId === currentPlan && !isTrialExpired;
            const isUpgrade = PLAN_RANK[planId] > PLAN_RANK[currentPlan];
            const isPendingTarget = pendingPlan === planId;
            const features = (plan.featureList as Record<string, string[]>)?.[lang] ?? (plan.featureList as Record<string, string[]>)?.en ?? [];
            const subtitle = (plan.subtitle as Record<string, string>)?.[lang] ?? (plan.subtitle as Record<string, string>)?.en ?? "";

            return (
              <div key={plan.id} className={`glass-card rounded-2xl p-4 space-y-3 transition-all relative ${plan.popular ? "ring-2 ring-brand-500/40" : ""} ${isCurrent ? "ring-2 ring-brand-500/40" : ""}`}>
                {plan.popular && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full bg-gradient-to-r from-brand-500 to-purple-500 text-[10px] font-bold text-white uppercase tracking-wide">{l.popular}</span>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                  {subtitle && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2">{plan.price}<span className="text-xs font-normal text-slate-500"> zł{l.perMonth}</span></p>
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
                  <div className="w-full py-2 rounded-xl bg-brand-500/10 text-center text-xs font-semibold text-brand-400">{l.current}</div>
                ) : isPendingTarget ? (
                  <div className="w-full py-2 rounded-xl bg-amber-500/10 text-center text-xs font-semibold text-amber-500">{l.scheduled}</div>
                ) : canChangePlan ? (
                  <button
                    onClick={() => setPlanChange({ target: planId, kind: isUpgrade ? "upgrade" : "downgrade" })}
                    disabled={changePlanMut.isPending}
                    className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
                      isUpgrade ? "bg-brand-600 text-white hover:bg-brand-500" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {isUpgrade ? l.upgrade : l.downgrade}
                  </button>
                ) : (
                  <button
                    onClick={() => handleSubscribe(planId)}
                    disabled={isBusy || isPaused}
                    className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
                      plan.popular || isTrialExpired ? "bg-gradient-to-r from-brand-600 to-purple-600 text-white hover:from-brand-500 hover:to-purple-500" : "bg-brand-600 text-white hover:bg-brand-500"
                    }`}
                  >
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (isTrialExpired ? l.trialExpiredCta : isUpgrade ? l.upgrade : l.subscribe)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Manage subscription (Stripe portal — payment method / invoices) */}
      {hasStripeCustomer && (
        <button
          onClick={() => portalMut.mutate({ tenantId })}
          disabled={portalMut.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-500/40 transition-colors disabled:opacity-50"
        >
          {portalMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{l.manageSub}<ExternalLink className="h-3.5 w-3.5" /></>}
        </button>
      )}

      {/* Pause subscription — only when active and not already cancelling */}
      {canChangePlan && !billing.data?.cancelAtPeriodEnd && (
        <button
          type="button"
          onClick={() => pauseMut.mutate({ tenantId })}
          disabled={pauseMut.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-violet-500/40 hover:text-violet-600 dark:hover:text-violet-300 transition-colors disabled:opacity-50"
        >
          {pauseMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><PauseCircle className="h-4 w-4" />{l.pauseSub}</>}
        </button>
      )}

      {/* Cancel subscription — opens 3-stage retention flow. Active & not already cancelling. */}
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
          onCancelled={refreshBilling}
          onRetained={refreshBilling}
        />
      )}

      {mutError && <p className="text-xs text-red-400 text-center">{mutError.message}</p>}
    </div>
  );
}
