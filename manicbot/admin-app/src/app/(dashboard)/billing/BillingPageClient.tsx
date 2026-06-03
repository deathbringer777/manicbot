"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  Download,
  TrendingUp,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  Zap,
  Loader2,
  Wallet,
  Receipt,
  AlertTriangle,
  Percent,
  FlaskConical,
  ArrowDownToLine,
  Scale,
} from "lucide-react";
import { formatPlnWhole, formatMinorPln, PLAN_PRICES_PLN } from "~/lib/money";
import { useLang } from "~/components/LangContext";
import { t, localeFor } from "~/lib/i18n";
import { RevenueChart } from "~/components/dashboard/RevenueChart";
import { StatCard, StatCardSkeleton } from "~/components/dashboard-ui/StatCard";

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20",
  trialing: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20",
  grace_period: "text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-500/10 dark:border-orange-500/20",
  inactive: "text-slate-500 bg-slate-100 border-slate-300 dark:text-slate-400 dark:bg-slate-700/20 dark:border-slate-600/20",
};

const PLAN_COLORS: Record<string, string> = {
  start: "text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/40",
  pro: "text-brand-400 bg-brand-500/10",
  max: "text-purple-400 bg-purple-500/10",
};

function downloadCSV(data: string, filename: string) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type ModalType = { type: "plan" | "status" | "activate"; tenantId: string; tenantName: string } | null;

export default function BillingPageClient() {
  const { lang } = useLang();
  const locale = localeFor(lang);
  const fmtDate = (ts: number | null | undefined): string => {
    if (!ts) return t("common.dash", lang);
    return new Date(ts * 1000).toLocaleDateString(locale);
  };

  const [expanded, setExpanded] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalType>(null);
  const [modalPlan, setModalPlan] = useState<"start" | "pro" | "max">("pro");
  const [modalStatus, setModalStatus] = useState<"active" | "trialing" | "grace_period" | "inactive">("active");
  const [modalMonths, setModalMonths] = useState(1);

  const utils = api.useUtils();

  const { data, isLoading } = api.billing.getOverview.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const exportQuery = api.export.revenue.useQuery({ format: "csv" }, { enabled: false });

  // Real-money half: live Stripe (balance / payouts / charges / disputes) plus
  // the D1 ledger summary (revenue series + reconciliation). A 60s cadence is
  // plenty — these aren't second-to-second numbers and it stays well under
  // Stripe's rate limit even with the dashboard left open.
  const { data: fin, isLoading: finLoading } = api.billing.getStripeFinancials.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: ledger, isLoading: ledgerLoading } = api.billing.getLedgerSummary.useQuery(
    { days: 90 },
    { refetchInterval: 60_000 },
  );
  const sumMinor = (arr?: { amount: number }[]) => (arr ?? []).reduce((s, b) => s + (b.amount ?? 0), 0);

  const updatePlanMut = api.billing.updatePlan.useMutation({
    onSuccess: () => { utils.billing.getOverview.invalidate(); setModal(null); },
  });
  const updateStatusMut = api.billing.updateStatus.useMutation({
    onSuccess: () => { utils.billing.getOverview.invalidate(); setModal(null); },
  });
  const manualActivateMut = api.billing.manualActivate.useMutation({
    onSuccess: () => { utils.billing.getOverview.invalidate(); setModal(null); },
  });

  const handleExport = async () => {
    const res = await exportQuery.refetch();
    if (res.data) downloadCSV(res.data.data, res.data.filename);
  };

  const openModal = (type: "plan" | "status" | "activate", t: { id: string; name: string; plan: string; billingStatus: string }) => {
    if (type === "plan") setModalPlan(t.plan as "start" | "pro" | "max");
    if (type === "status") setModalStatus(t.billingStatus as "active" | "trialing" | "grace_period" | "inactive");
    if (type === "activate") { setModalPlan(t.plan as "start" | "pro" | "max"); setModalMonths(1); }
    setModal({ type, tenantId: t.id, tenantName: t.name });
  };

  const m = data?.metrics;
  const tenants = data?.tenants ?? [];

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{t("gmBilling.title", lang)}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("gmBilling.subtitle", lang)}</p>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 text-slate-900 dark:text-white px-3 py-2 text-xs font-medium rounded-xl transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>

        {/* Metrics */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-4 h-20 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card rounded-2xl p-4 col-span-2 flex items-center gap-4">
              <TrendingUp className="w-6 h-6 text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("gmBilling.mrrLabel", lang)}</p>
                <p className="text-3xl font-extrabold text-slate-900 dark:text-white">{formatPlnWhole(m?.mrr ?? 0)}</p>
              </div>
            </div>
            <div className="glass-card rounded-2xl p-4 text-center">
              <CheckCircle className="w-5 h-5 text-brand-400 mx-auto mb-1.5" />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{m?.activeSubscribers ?? 0}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">{t("gmBilling.activeCount", lang)}</p>
            </div>
            <div className="glass-card rounded-2xl p-4 text-center">
              <Clock className="w-5 h-5 text-amber-400 mx-auto mb-1.5" />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{m?.trialing ?? 0}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">{t("gmBilling.trialingCount", lang)}</p>
            </div>
          </div>
        )}

        {/* Plan breakdown */}
        {m?.planBreakdown && Object.keys(m.planBreakdown).length > 0 && (
          <div className="glass-card rounded-2xl p-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">{t("gmBilling.plansActive", lang)}</p>
            <div className="flex gap-3">
              {Object.entries(m.planBreakdown).map(([plan, count]) => (
                <div key={plan} className="flex-1 text-center bg-slate-100/50 dark:bg-slate-800/50 rounded-xl p-3">
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{count}</p>
                  <p className={`text-[10px] font-bold uppercase mt-0.5 ${PLAN_COLORS[plan] ?? ""}`}>
                    {plan}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Real money · Stripe (live + ledger) ─────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("gmBilling.realMoney", lang)}</p>
            {fin?.configured && fin.liveMode === false && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase text-amber-600 bg-amber-50 border border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20">
                <FlaskConical className="w-2.5 h-2.5" />{t("gmBilling.testData", lang)}
              </span>
            )}
          </div>

          {fin && !fin.configured ? (
            <div className="glass-card rounded-2xl py-6 text-center">
              <p className="text-xs text-slate-500">{t("gmBilling.notConfigured", lang)}</p>
            </div>
          ) : (
            <>
              {/* Real-money KPIs */}
              {finLoading || ledgerLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label={t("gmBilling.availableBalance", lang)} value={formatMinorPln(sumMinor(fin?.balance?.available), locale)} icon={Wallet} color="bg-emerald-500/15 text-emerald-500 dark:text-emerald-400" />
                  <StatCard label={t("gmBilling.pendingBalance", lang)} value={formatMinorPln(sumMinor(fin?.balance?.pending), locale)} icon={Clock} color="bg-amber-500/15 text-amber-500 dark:text-amber-400" />
                  <StatCard label={t("gmBilling.netRevenue", lang)} sub={t("gmBilling.windowSub", lang)} value={formatMinorPln(ledger?.totals.net ?? 0, locale)} icon={TrendingUp} color="bg-brand-500/15 text-brand-500 dark:text-brand-400" sparkline={(ledger?.series ?? []).map((s) => s.net)} />
                  <StatCard label={t("gmBilling.stripeFees", lang)} sub={t("gmBilling.windowSub", lang)} value={formatMinorPln(ledger?.totals.fee ?? 0, locale)} icon={Percent} color="bg-slate-500/15 text-slate-500 dark:text-slate-400" />
                </div>
              )}
              {fin?.errors?.includes("balance") && (
                <p className="text-[11px] text-amber-500">{t("gmBilling.stripeUnavailable", lang)}</p>
              )}

              {/* Revenue chart (from the D1 ledger) */}
              <div className="glass-card rounded-2xl p-4">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">{t("gmBilling.revenueChart", lang)}</p>
                <RevenueChart data={ledger?.series} />
              </div>

              {/* Reconciliation: estimated MRR vs actual net */}
              {ledger && (
                <div className="glass-card rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Scale className="w-4 h-4 text-slate-400" />
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("gmBilling.reconciliation", lang)}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] text-slate-500">{t("gmBilling.estMrr", lang)}</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{formatMinorPln(ledger.reconciliation.estimatedMrrMinor, locale)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">{t("gmBilling.actualNet30", lang)}</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{formatMinorPln(ledger.reconciliation.actualNet30dMinor, locale)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">{t("gmBilling.reconDelta", lang)}</p>
                      <p className={`text-sm font-bold ${ledger.reconciliation.deltaMinor >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatMinorPln(ledger.reconciliation.deltaMinor, locale)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Bank payouts */}
              <div className="glass-card rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDownToLine className="w-4 h-4 text-slate-400" />
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("gmBilling.payouts", lang)}</p>
                </div>
                {fin?.errors?.includes("payouts") ? (
                  <p className="text-[11px] text-amber-500">{t("gmBilling.stripeUnavailable", lang)}</p>
                ) : (fin?.payouts.rows.length ?? 0) === 0 ? (
                  <p className="text-[11px] text-slate-500">{t("common.noData", lang)}</p>
                ) : (
                  <div className="space-y-1.5">
                    {fin?.payouts.rows.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500">{fmtDate(p.arrivalDate)}</span>
                        <span className="text-slate-400 text-[10px] uppercase">{p.status}</span>
                        <span className="font-semibold text-slate-900 dark:text-white">{formatMinorPln(p.amount, locale)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent real payments */}
              <div className="glass-card rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Receipt className="w-4 h-4 text-slate-400" />
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("gmBilling.recentCharges", lang)}</p>
                </div>
                {fin?.errors?.includes("charges") ? (
                  <p className="text-[11px] text-amber-500">{t("gmBilling.stripeUnavailable", lang)}</p>
                ) : (fin?.charges.rows.length ?? 0) === 0 ? (
                  <p className="text-[11px] text-slate-500">{t("common.noData", lang)}</p>
                ) : (
                  <div className="space-y-1.5">
                    {fin?.charges.rows.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 shrink-0">{fmtDate(c.created)}</span>
                        <span className="text-slate-400 truncate flex-1 text-[10px]">{c.email ?? c.description ?? ""}</span>
                        {c.refunded && <span className="text-[9px] uppercase text-red-400 shrink-0">{t("gmBilling.refunded", lang)}</span>}
                        <span className="font-semibold text-slate-900 dark:text-white shrink-0">{formatMinorPln(c.amount, locale)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Disputes — only surfaced when there are open ones */}
              {(fin?.disputes.rows.length ?? 0) > 0 && (
                <div className="glass-card rounded-2xl p-4 border border-red-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <p className="text-xs font-semibold text-red-500 dark:text-red-400">{t("gmBilling.disputes", lang)}</p>
                  </div>
                  <div className="space-y-1.5">
                    {fin?.disputes.rows.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 text-[10px] uppercase">{d.reason}</span>
                        <span className="text-slate-400 text-[10px]">{d.dueBy ? `${t("gmBilling.disputeDue", lang)} ${fmtDate(d.dueBy)}` : d.status}</span>
                        <span className="font-semibold text-red-500">{formatMinorPln(d.amount, locale)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Tenants list */}
        <div className="space-y-2.5">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("gmBilling.allTenants", lang)}</p>
          {tenants.map((tenant) => (
            <div key={tenant.id} className="glass-card rounded-2xl overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{tenant.name}</p>
                    {tenant.email && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{tenant.email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase ${
                        STATUS_COLORS[tenant.billingStatus] ?? STATUS_COLORS.inactive
                      }`}
                    >
                      {tenant.billingStatus}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                        PLAN_COLORS[tenant.plan] ?? PLAN_COLORS.start
                      }`}
                    >
                      {tenant.plan}
                    </span>
                    <button
                      onClick={() => setExpanded(expanded === tenant.id ? null : tenant.id)}
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 text-slate-600 dark:text-slate-300"
                    >
                      {expanded === tenant.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-border/30">
                  <span className="text-[10px] font-mono text-slate-600 truncate flex-1">{tenant.id}</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white shrink-0 ml-2">
                    {tenant.monthlyRevenue > 0 ? `${formatPlnWhole(tenant.monthlyRevenue)}${t("gmBilling.perMonthShort", lang)}` : t("common.dash", lang)}
                  </span>
                </div>
              </div>

              {/* Expanded billing details + actions */}
              {expanded === tenant.id && (
                <div className="border-t border-border/50 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-3">
                  {/* Billing details */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div className="text-slate-500 dark:text-slate-400">{t("gmBilling.trialUntil", lang)}</div>
                    <div className="text-slate-700 dark:text-slate-300 text-right">{fmtDate(tenant.trialEndsAt)}</div>
                    <div className="text-slate-500 dark:text-slate-400">{t("gmBilling.periodUntil", lang)}</div>
                    <div className="text-slate-700 dark:text-slate-300 text-right">{fmtDate(tenant.currentPeriodEnd)}</div>
                    <div className="text-slate-500 dark:text-slate-400">{t("gmBilling.stripeCustomer", lang)}</div>
                    <div className="text-slate-700 dark:text-slate-300 text-right font-mono text-[10px] truncate">{tenant.stripeCustomerId ?? t("common.dash", lang)}</div>
                    <div className="text-slate-500 dark:text-slate-400">{t("gmBilling.stripeSub", lang)}</div>
                    <div className="text-slate-700 dark:text-slate-300 text-right font-mono text-[10px] truncate">{tenant.stripeSubscriptionId ?? t("common.dash", lang)}</div>
                    <div className="text-slate-500 dark:text-slate-400">{t("gmBilling.cancelAtPeriodEnd", lang)}</div>
                    <div className="text-slate-700 dark:text-slate-300 text-right">{tenant.cancelAtPeriodEnd ? t("common.yes", lang) : t("common.no", lang)}</div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => openModal("plan", tenant)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-400 text-xs font-medium active:bg-brand-500/20"
                    >
                      {t("gmBilling.changePlan", lang)}
                    </button>
                    <button
                      onClick={() => openModal("status", tenant)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600/30 bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 text-xs font-medium active:bg-slate-100 dark:active:bg-slate-700/50"
                    >
                      {t("gmBilling.changeStatus", lang)}
                    </button>
                    <button
                      onClick={() => openModal("activate", tenant)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-medium active:bg-emerald-500/20"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      {t("gmBilling.manualActivate", lang)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {tenants.length === 0 && !isLoading && (
            <div className="glass-card rounded-2xl py-12 text-center">
              <p className="text-slate-500 text-sm">{t("common.noData", lang)}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Change Plan Modal ── */}
      {modal?.type === "plan" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setModal(null)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmBilling.changePlan", lang)}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{modal.tenantName}</p>
              </div>
              <button onClick={() => setModal(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                {(["start", "pro", "max"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setModalPlan(p)}
                    className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase border transition-colors ${
                      modalPlan === p ? "bg-brand-500/20 text-brand-400 border-brand-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/30"
                    }`}
                  >
                    <div>{p}</div>
                    <div className="text-[10px] font-normal mt-0.5 normal-case">{PLAN_PRICES_PLN[p]} zł{t("gmBilling.perMonthShort", lang)}</div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => updatePlanMut.mutate({ tenantId: modal.tenantId, plan: modalPlan })}
                disabled={updatePlanMut.isPending}
                className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-semibold text-sm active:bg-brand-500 disabled:opacity-50 mt-2"
              >
                {updatePlanMut.isPending ? "..." : t("gmBilling.changePlan", lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Status Modal ── */}
      {modal?.type === "status" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setModal(null)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmBilling.changeStatus", lang)}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{modal.tenantName}</p>
              </div>
              <button onClick={() => setModal(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(["active", "trialing", "grace_period", "inactive"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setModalStatus(s)}
                    className={`py-2.5 rounded-xl text-xs font-bold uppercase border transition-colors ${
                      modalStatus === s
                        ? STATUS_COLORS[s]
                        : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/30"
                    }`}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
              <button
                onClick={() => updateStatusMut.mutate({ tenantId: modal.tenantId, billingStatus: modalStatus })}
                disabled={updateStatusMut.isPending}
                className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-semibold text-sm active:bg-brand-500 disabled:opacity-50 mt-2"
              >
                {updateStatusMut.isPending ? "..." : t("gmBilling.changeStatus", lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual Activate Modal ── */}
      {modal?.type === "activate" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setModal(null)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmBilling.manualActivate", lang)}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{modal.tenantName}</p>
              </div>
              <button onClick={() => setModal(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmBilling.tariffPlan", lang)}</label>
                <div className="flex gap-2">
                  {(["start", "pro", "max"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setModalPlan(p)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase border transition-colors ${
                        modalPlan === p ? "bg-brand-500/20 text-brand-400 border-brand-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/30"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmBilling.monthsCount", lang)}</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={24}
                    value={modalMonths}
                    onChange={(e) => setModalMonths(Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="text-lg font-bold text-slate-900 dark:text-white w-8 text-center">{modalMonths}</span>
                </div>
              </div>

              {/* Calculated summary */}
              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{t("gmBilling.activeUntil", lang)}</span>
                  <span className="text-slate-700 dark:text-slate-300 font-medium">
                    {new Date(Date.now() + modalMonths * 30 * 24 * 3600 * 1000).toLocaleDateString(locale)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{t("gmBilling.total", lang)}</span>
                  <span className="text-emerald-400 font-bold">
                    {formatPlnWhole((PLAN_PRICES_PLN[modalPlan] ?? 0) * modalMonths)}
                  </span>
                </div>
              </div>

              {manualActivateMut.error && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                  {manualActivateMut.error.message}
                </p>
              )}

              <button
                onClick={() => manualActivateMut.mutate({ tenantId: modal.tenantId, plan: modalPlan, months: modalMonths })}
                disabled={manualActivateMut.isPending}
                className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white font-semibold text-sm active:bg-emerald-500 disabled:opacity-50 mt-2"
              >
                {manualActivateMut.isPending ? (
                  <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{t("gmBilling.activating", lang)}</span>
                ) : (
                  t("gmBilling.activate", lang)
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
