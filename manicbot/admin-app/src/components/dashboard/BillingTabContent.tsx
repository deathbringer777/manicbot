"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertCircle, Loader2, X, CheckCircle2 } from "lucide-react";
import { api } from "~/trpc/react";
import { SectionHeader } from "~/components/salon/SalonShared";
import { t, type Lang } from "~/lib/i18n";
import { TrialBanner } from "./BillingTab/TrialBanner";
import { CycleToggle, type BillingCycle } from "./BillingTab/CycleToggle";
import { PlanCard, type PlanCardData, type PlanId } from "./BillingTab/PlanCard";
import { SubscriptionManagement } from "./BillingTab/SubscriptionManagement";
import { EmbeddedCheckoutModal, hasEmbeddedCheckout } from "./BillingTab/EmbeddedCheckoutModal";

interface BillingData {
  plan?: string | null;
  billingStatus?: string | null;
  trialEndsAt?: number | null;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: number | null;
  nextPaymentDate?: number | null;
  stripeCustomerId?: string | null;
}

interface Props {
  tenantId: string;
  billing: {
    data?: BillingData;
    isLoading: boolean;
    isError: boolean;
  };
  lang: Lang;
}

// Annual cycle gets a 20% discount → 0.8 of monthly price (rounded down to nearest zł).
const ANNUAL_DISCOUNT = 0.8;

const SHOWS_MANAGEMENT_FOR = new Set(["active", "grace_period", "past_due", "canceled"]);

export function BillingTabContent({ tenantId, billing, lang }: Props) {
  const utils = api.useUtils();
  const plansQuery = api.salon.getPlans.useQuery(undefined, {
    staleTime: 60_000,
  });

  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [upgrading, setUpgrading] = useState<PlanId | null>(null);
  const [billingError, setBillingError] = useState<string>("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Detect return from Stripe Embedded Checkout (?checkout=success) — same pattern as BillingSection.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      setShowSuccess(true);
      // Clean URL without forcing a reload — preserve tab anchor.
      const tab = params.get("tab") ?? "billing";
      window.history.replaceState({}, "", `${window.location.pathname}?tab=${tab}`);
      void utils.salon.getBillingStatus.invalidate({ tenantId });
    }
  }, [tenantId, utils]);

  const embeddedMut = api.salon.createEmbeddedCheckout.useMutation({
    onSuccess: (res) => setClientSecret(res.clientSecret),
    onError: (e) => {
      setBillingError(e.message || t("billing.openFailed", lang));
      setUpgrading(null);
    },
  });

  const redirectMut = api.salon.createCheckoutSession.useMutation({
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
    onError: (e) => {
      setBillingError(e.message || t("billing.openFailed", lang));
      setUpgrading(null);
    },
  });

  const upgrade = useCallback(
    (plan: PlanId) => {
      setBillingError("");
      setUpgrading(plan);
      if (hasEmbeddedCheckout) {
        embeddedMut.mutate({ tenantId, plan, locale: lang, billingCycle: cycle });
      } else {
        redirectMut.mutate({ tenantId, plan, locale: lang, billingCycle: cycle });
      }
    },
    [embeddedMut, redirectMut, tenantId, lang, cycle],
  );

  const closeCheckout = useCallback(() => {
    setClientSecret(null);
    setUpgrading(null);
    void utils.salon.getBillingStatus.invalidate({ tenantId });
  }, [tenantId, utils]);

  const currentPlan = ((billing.data?.plan ?? "start").toLowerCase()) as PlanId;
  const billingStatus = billing.data?.billingStatus ?? "trialing";
  const isActiveSub = billingStatus === "active" || billingStatus === "grace_period" || billingStatus === "past_due";
  // Active paid sub on this exact plan + cycle disables the CTA. Trial users can always click.
  const currentCycle: BillingCycle = "monthly"; // TODO: derive from subscription metadata once persisted on the server.
  const isCurrentActive = (plan: PlanId) => isActiveSub && currentPlan === plan && cycle === currentCycle;
  const showManagement = !!billing.data?.stripeCustomerId && SHOWS_MANAGEMENT_FOR.has(billingStatus);

  // Map server plans → PlanCardData (with localized features + computed annual price).
  const cards: PlanCardData[] = (plansQuery.data ?? []).map((p) => {
    const features = ((p.featureList as Record<string, string[]> | undefined)?.[lang]
      ?? (p.featureList as Record<string, string[]> | undefined)?.en
      ?? []) as string[];
    const subtitle = ((p.subtitle as Record<string, string> | undefined)?.[lang]
      ?? (p.subtitle as Record<string, string> | undefined)?.en
      ?? "") as string;
    return {
      id: p.id as PlanId,
      name: p.name,
      monthlyPrice: p.price,
      annualMonthlyPrice: Math.floor(p.price * ANNUAL_DISCOUNT),
      currency: p.currency,
      popular: !!p.popular,
      subtitle,
      features,
    };
  });

  const monthlyForCurrent = cards.find((c) => c.id === currentPlan)?.monthlyPrice ?? null;
  const annualForCurrent = cards.find((c) => c.id === currentPlan)?.annualMonthlyPrice ?? null;
  const currencyForCurrent = cards.find((c) => c.id === currentPlan)?.currency ?? "PLN";

  return (
    <div className="space-y-5">
      <SectionHeader title={t("salon.billingTitle", lang)} />

      {billing.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        </div>
      )}

      {billing.isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/40 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-300">{t("common.errorLoading", lang)}</p>
        </div>
      )}

      {showSuccess && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08]">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="flex-1 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            {t("billing.checkout.success", lang)}
          </p>
          <button
            type="button"
            onClick={() => setShowSuccess(false)}
            className="text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300"
            aria-label={t("common.close", lang)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {billingError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-900/20">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="flex-1 text-sm text-red-600 dark:text-red-400">{billingError}</p>
          <button
            type="button"
            onClick={() => setBillingError("")}
            className="text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
            aria-label={t("common.close", lang)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {billingStatus === "trialing" && billing.data?.trialEndsAt && (
        <TrialBanner trialEndsAt={billing.data.trialEndsAt} lang={lang} />
      )}

      {showManagement && (
        <SubscriptionManagement
          tenantId={tenantId}
          plan={billing.data?.plan ?? null}
          billingStatus={billingStatus}
          currentPeriodEnd={billing.data?.currentPeriodEnd ?? null}
          cancelAtPeriodEnd={billing.data?.cancelAtPeriodEnd ?? null}
          stripeCustomerId={billing.data?.stripeCustomerId ?? null}
          cycle={cycle}
          monthlyPrice={monthlyForCurrent}
          annualMonthlyPrice={annualForCurrent}
          currency={currencyForCurrent}
          lang={lang}
        />
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t("billing.changePlan", lang)}
          </h3>
          <CycleToggle value={cycle} onChange={setCycle} lang={lang} />
        </div>

        {plansQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-80 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.04]" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 sm:gap-3 md:gap-4">
            {cards.map((card) => (
              <PlanCard
                key={card.id}
                plan={card}
                cycle={cycle}
                currentPlan={currentPlan}
                isCurrentActive={isCurrentActive(card.id)}
                upgrading={upgrading === card.id}
                onSelect={upgrade}
                lang={lang}
              />
            ))}
          </div>
        )}
      </div>

      <EmbeddedCheckoutModal
        clientSecret={clientSecret}
        onClose={closeCheckout}
        lang={lang}
      />
    </div>
  );
}
