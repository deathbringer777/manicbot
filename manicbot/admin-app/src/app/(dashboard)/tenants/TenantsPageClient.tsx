"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { PageHeader } from "~/components/ui/PageHeader";
import { EmptyState } from "~/components/ui/EmptyState";
import { SkeletonCard } from "~/components/ui/Skeleton";
import {
  Users,
  CalendarDays,
  Bot,
  ChevronDown,
  ChevronUp,
  Power,
  PowerOff,
  Plus,
  X,
  CheckCircle,
  XCircle,
  Shield,
  UserPlus,
  Trash2,
  Zap,
  Copy,
  Check,
  ArrowLeft,
  Loader2,
  Building2,
} from "lucide-react";
import { TestBadge } from "~/components/ui/TestBadge";
import { useLang } from "~/components/LangContext";
import { t, localeFor } from "~/lib/i18n";

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20",
  trialing: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20",
  grace_period: "text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-500/10 dark:border-orange-500/20",
  inactive: "text-slate-500 bg-slate-100 border-slate-300 dark:text-slate-400 dark:bg-slate-700/20 dark:border-slate-600/20",
};

type TenantRole = { tenantId: string; chatId: number; role: string };

function ConfirmButton({
  label,
  onClick,
  color = "red",
  icon: Icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  color?: "red" | "green" | "amber";
  icon: React.ElementType;
  disabled?: boolean;
}) {
  const { lang } = useLang();
  const [step, setStep] = useState(0);
  const colors = {
    red: "bg-red-500/10 text-red-400 active:bg-red-500/20 border-red-500/20",
    green: "bg-emerald-500/10 text-emerald-400 active:bg-emerald-500/20 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-400 active:bg-amber-500/20 border-amber-500/20",
  };
  if (step === 1) {
    return (
      <div className="flex gap-1.5">
        <button
          onClick={() => { onClick(); setStep(0); }}
          disabled={disabled}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-500/20 text-red-400 text-xs font-bold active:bg-red-500/30 disabled:opacity-50"
        >
          {t("gmTenants.confirmYes", lang)}
        </button>
        <button onClick={() => setStep(0)} className="px-2.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 text-xs">
          {t("gmTenants.confirmNo", lang)}
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setStep(1)}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors disabled:opacity-50 ${colors[color]}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); } catch {}
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 p-1.5 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

type QuickOnboardResult = {
  ok: boolean;
  tenantId: string;
  botId: string;
  webhookUrl: string;
  webhookOk: boolean;
  ownerEmail: string;
  tempPassword: string;
};

export default function TenantsPageClient() {
  const { lang } = useLang();
  const locale = localeFor(lang);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPlan, setCreatePlan] = useState<"start" | "pro" | "max">("pro");
  const [roleModal, setRoleModal] = useState<string | null>(null); // tenantId
  const [roleChatId, setRoleChatId] = useState("");
  const [roleType, setRoleType] = useState<"tenant_owner" | "master">("master");
  const [botModal, setBotModal] = useState<string | null>(null); // tenantId
  const [botId, setBotId] = useState("");
  const [botUsername, setBotUsername] = useState("");

  // Quick Onboard state
  const [qoStep, setQoStep] = useState<0 | 1 | 2 | 3>(0); // 0=closed
  const [qoName, setQoName] = useState("");
  const [qoPlan, setQoPlan] = useState<"start" | "pro" | "max">("pro");
  const [qoToken, setQoToken] = useState("");
  const [qoEmail, setQoEmail] = useState("");
  const [qoResult, setQoResult] = useState<QuickOnboardResult | null>(null);

  const utils = api.useUtils();

  const { data: tenants = [], isLoading } = api.tenants.getAll.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: detail } = api.tenants.getById.useQuery(
    { id: expanded! },
    { enabled: !!expanded }
  );
  const { data: tenantRoles } = api.provisioning.listTenantRoles.useQuery(
    { tenantId: expanded! },
    { enabled: !!expanded }
  );

  const activateMut = api.tenants.activate.useMutation({ onSuccess: () => utils.tenants.getAll.invalidate() });
  const deactivateMut = api.tenants.deactivate.useMutation({ onSuccess: () => utils.tenants.getAll.invalidate() });
  const createMut = api.provisioning.createTenant.useMutation({
    onSuccess: () => { utils.tenants.getAll.invalidate(); setShowCreate(false); setCreateName(""); },
  });
  const confirmAllMut = api.provisioning.confirmAllPending.useMutation({
    onSuccess: () => utils.appointments.getAll.invalidate(),
  });
  const cancelAllMut = api.provisioning.cancelAllPending.useMutation({
    onSuccess: () => utils.appointments.getAll.invalidate(),
  });
  const setRoleMut = api.provisioning.setTenantRole.useMutation({
    onSuccess: () => { utils.tenants.getById.invalidate(); setRoleModal(null); setRoleChatId(""); },
  });
  const removeRoleMut = api.provisioning.removeTenantRole.useMutation({
    onSuccess: () => utils.tenants.getById.invalidate(),
  });
  const linkBotMut = api.provisioning.linkBot.useMutation({
    onSuccess: () => { utils.tenants.getAll.invalidate(); setBotModal(null); setBotId(""); setBotUsername(""); },
  });
  const quickOnboardMut = api.provisioning.quickOnboard.useMutation({
    onSuccess: (data) => {
      setQoResult(data);
      setQoStep(3);
      utils.tenants.getAll.invalidate();
    },
  });

  const closeQuickOnboard = () => {
    setQoStep(0);
    setQoName("");
    setQoPlan("pro");
    setQoToken("");
    setQoEmail("");
    setQoResult(null);
    quickOnboardMut.reset();
  };

  const ROLE_LABELS: Record<string, string> = {
    tenant_owner: t("gmTenants.roleOwner", lang),
    master: t("gmTenants.roleMaster", lang),
  };

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <PageHeader
            title={t("gmTenants.title", lang)}
            subtitle={isLoading ? t("gmTenants.loading", lang) : `${tenants.length} ${tenants.length === 1 ? t("gmTenants.salonSingular", lang) : t("gmTenants.salonsSuffix", lang)}`}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQoStep(1)}
              className="flex items-center gap-1.5 bg-emerald-600 active:bg-emerald-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl shadow-lg shadow-emerald-500/20 transition-all"
            >
              <Zap className="w-4 h-4" />
              Quick Onboard
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              {t("gmTenants.create", lang)}
            </button>
          </div>
        </div>

        {/* Tenants list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={3} />)}
          </div>
        ) : (
          <div className="space-y-3">
            {tenants.map((tenant) => (
              <div key={tenant.id} className="glass-card rounded-2xl overflow-hidden">
                {/* Tenant header */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 flex items-center justify-center text-base shrink-0">
                      {tenant.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{tenant.name}</h3>
                        {tenant.isTest ? <TestBadge /> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${STATUS_COLORS[tenant.billingStatus ?? "inactive"] ?? STATUS_COLORS.inactive}`}>
                          {tenant.billingStatus ?? "inactive"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded border border-brand-500/20 text-brand-400 text-[9px] font-bold uppercase">
                          {tenant.plan ?? "start"}
                        </span>
                        {!tenant.active && (
                          <span className="px-1.5 py-0.5 rounded border border-red-500/20 text-red-400 text-[9px] font-bold">{t("gmTenants.disabledShort", lang)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {tenant.active ? (
                        <button onClick={() => deactivateMut.mutate({ id: tenant.id })} disabled={deactivateMut.isPending}
                          className="p-2 rounded-xl bg-red-500/10 active:bg-red-500/20 text-red-400 disabled:opacity-50">
                          <PowerOff className="w-4 h-4" />
                        </button>
                      ) : (
                        <button onClick={() => activateMut.mutate({ id: tenant.id })} disabled={activateMut.isPending}
                          className="p-2 rounded-xl bg-emerald-500/10 active:bg-emerald-500/20 text-emerald-400 disabled:opacity-50">
                          <Power className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => setExpanded(expanded === tenant.id ? null : tenant.id)}
                        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {expanded === tenant.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30">
                    <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"><Users className="w-3 h-3" />{tenant.userCount}</span>
                    <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"><CalendarDays className="w-3 h-3" />{tenant.appointmentCount} {t("gmTenants.appointmentsShort", lang)}</span>
                    {tenant.bot && <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 truncate"><Bot className="w-3 h-3 shrink-0" />@{tenant.bot.botUsername}</span>}
                  </div>
                </div>

                {/* Expanded detail */}
                {expanded === tenant.id && (
                  <div className="border-t border-border/50 bg-slate-50 dark:bg-slate-900/40 space-y-4 p-4">
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: t("gmTenants.servicesLabel", lang), value: detail?.services.length ?? "…" },
                        { label: t("gmTenants.mastersLabel", lang), value: detail?.masters.length ?? "…" },
                        { label: t("gmTenants.usersLabel", lang), value: detail?.userCount ?? "…" },
                        { label: t("gmTenants.appointmentsLabel", lang), value: detail?.appointmentCount ?? "…" },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-slate-100/50 dark:bg-slate-800/50 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
                          <p className="text-lg font-bold text-slate-900 dark:text-white">{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Tenant info */}
                    <div className="space-y-1 text-xs">
                      {detail?.billingEmail && <p className="text-slate-500 dark:text-slate-400"><span className="text-slate-500">Email: </span>{detail.billingEmail}</p>}
                      {detail?.stripeCustomerId && <p className="text-slate-500 dark:text-slate-400 font-mono text-[10px]"><span className="text-slate-500">Stripe: </span>{detail.stripeCustomerId}</p>}
                      {detail?.trialEndsAt && <p className="text-slate-500 dark:text-slate-400"><span className="text-slate-500">{t("gmTenants.trialUntilLabel", lang)} </span>{new Date(detail.trialEndsAt * 1000).toLocaleDateString(locale)}</p>}
                      <p className="text-slate-600 font-mono text-[9px]">{tenant.id}</p>
                    </div>

                    {/* ── God Actions ── */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{t("gmTenants.godActions", lang)}</p>
                      <div className="flex flex-wrap gap-2">
                        <ConfirmButton
                          label={t("gmTenants.confirmAllApts", lang)}
                          onClick={() => confirmAllMut.mutate({ tenantId: tenant.id })}
                          color="green"
                          icon={CheckCircle}
                          disabled={confirmAllMut.isPending}
                        />
                        <ConfirmButton
                          label={t("gmTenants.cancelAllPending", lang)}
                          onClick={() => cancelAllMut.mutate({ tenantId: tenant.id })}
                          color="red"
                          icon={XCircle}
                          disabled={cancelAllMut.isPending}
                        />
                        <button
                          onClick={() => { setRoleModal(tenant.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-400 text-xs font-medium active:bg-brand-500/20"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          {t("gmTenants.grantRole", lang)}
                        </button>
                        <button
                          onClick={() => { setBotModal(tenant.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600/30 bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 text-xs font-medium active:bg-slate-100 dark:active:bg-slate-700/50"
                        >
                          <Bot className="w-3.5 h-3.5" />
                          {t("gmTenants.linkBot", lang)}
                        </button>
                      </div>
                    </div>

                    {/* Tenant roles */}
                    {tenantRoles && tenantRoles.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{t("gmTenants.rolesInTenant", lang)}</p>
                        <div className="space-y-1.5">
                          {tenantRoles.map((r) => (
                            <div key={`${r.tenantId}:${r.chatId}`} className="flex items-center justify-between bg-slate-100 dark:bg-slate-800/40 rounded-xl px-3 py-2">
                              <div>
                                <span className="text-xs font-mono text-slate-600 dark:text-slate-300">#{r.chatId}</span>
                                <span className="ml-2 text-[10px] text-brand-400 font-bold uppercase">{ROLE_LABELS[r.role] ?? r.role}</span>
                              </div>
                              <button
                                onClick={() => removeRoleMut.mutate({ tenantId: tenant.id, chatId: r.chatId })}
                                disabled={removeRoleMut.isPending}
                                className="p-1.5 rounded-lg bg-red-500/10 text-red-400 active:bg-red-500/20 disabled:opacity-50"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Services preview */}
                    {detail?.services && detail.services.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{t("gmTenants.servicesLabel", lang)}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {detail.services.map((s) => (
                            <span key={s.svcId} className={`px-2 py-0.5 rounded text-[10px] ${s.active ? "bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-300" : "bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 line-through"}`}>
                              {s.emoji} {s.svcId} · {`${s.price} zł`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {tenants.length === 0 && (
              <EmptyState
                icon={Building2}
                title={t("gmTenants.noTenantsTitle", lang)}
                description={t("gmTenants.noTenantsDesc", lang)}
                action={{ label: t("gmTenants.createFirst", lang), onClick: () => setShowCreate(true) }}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Create Tenant Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmTenants.newTenant", lang)}</h3>
              <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.salonName", lang)}</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder={t("gmTenants.salonNamePh", lang)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.tariffPlan", lang)}</label>
                <div className="flex gap-2">
                  {(["start", "pro", "max"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setCreatePlan(p)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase border transition-colors ${
                        createPlan === p ? "bg-brand-500/20 text-brand-400 border-brand-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/30"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => createMut.mutate({ name: createName, plan: createPlan })}
                disabled={!createName.trim() || createMut.isPending}
                className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-semibold text-sm active:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              >
                {createMut.isPending ? t("gmTenants.creatingDots", lang) : t("gmTenants.createTenantBtn", lang)}
              </button>
              {createMut.data && (
                <p className="text-center text-xs text-emerald-400">
                  {t("gmTenants.createdOk", lang)} <span className="font-mono">{createMut.data.tenantId}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Grant Tenant Role Modal ── */}
      {roleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setRoleModal(null)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmTenants.grantTenantRole", lang)}</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{roleModal}</p>
              </div>
              <button onClick={() => setRoleModal(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.tgChatId", lang)}</label>
                <input
                  type="number"
                  value={roleChatId}
                  onChange={(e) => setRoleChatId(e.target.value)}
                  placeholder="321706035"
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.role", lang)}</label>
                <div className="flex gap-2">
                  {([
                    { key: "master", label: t("gmTenants.roleMaster", lang) },
                    { key: "tenant_owner", label: t("gmTenants.roleOwner", lang) },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setRoleType(key)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                        roleType === key ? "bg-brand-500/20 text-brand-400 border-brand-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/30"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setRoleMut.mutate({ tenantId: roleModal, chatId: parseInt(roleChatId), role: roleType })}
                disabled={!roleChatId || setRoleMut.isPending}
                className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-semibold text-sm active:bg-brand-500 disabled:opacity-50 mt-2"
              >
                {setRoleMut.isPending ? "..." : t("gmTenants.grantRole", lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link Bot Modal ── */}
      {botModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setBotModal(null)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmTenants.linkBot", lang)}</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{botModal}</p>
              </div>
              <button onClick={() => setBotModal(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.botIdLabel", lang)}</label>
                <input
                  type="text"
                  value={botId}
                  onChange={(e) => setBotId(e.target.value)}
                  placeholder="8752028834"
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.botUsername", lang)}</label>
                <input
                  type="text"
                  value={botUsername}
                  onChange={(e) => setBotUsername(e.target.value)}
                  placeholder="manic_preview_bot"
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60"
                />
              </div>
              <button
                onClick={() => linkBotMut.mutate({ botId, botUsername, tenantId: botModal! })}
                disabled={!botId.trim() || linkBotMut.isPending}
                className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-semibold text-sm active:bg-brand-500 disabled:opacity-50 mt-2"
              >
                {linkBotMut.isPending ? "..." : t("gmTenants.linkBot", lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Onboard Wizard ── */}
      {qoStep > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={closeQuickOnboard}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>

            {/* Step 1: Salon + Plan */}
            {qoStep === 1 && (
              <>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">Quick Onboard</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{t("gmTenants.qoStep1", lang)}</p>
                  </div>
                  <button onClick={closeQuickOnboard} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.salonName", lang)}</label>
                    <input
                      type="text"
                      value={qoName}
                      onChange={(e) => setQoName(e.target.value)}
                      placeholder={t("gmTenants.salonNamePh", lang)}
                      className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.tariffPlan", lang)}</label>
                    <div className="flex gap-2">
                      {(["start", "pro", "max"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setQoPlan(p)}
                          className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase border transition-colors ${
                            qoPlan === p ? "bg-brand-500/20 text-brand-400 border-brand-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700/30"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setQoStep(2)}
                    disabled={!qoName.trim()}
                    className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-semibold text-sm active:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                  >
                    {t("common.next", lang)}
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Bot + Owner */}
            {qoStep === 2 && (
              <>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setQoStep(1)} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">Quick Onboard</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{t("gmTenants.qoStep2", lang)}</p>
                    </div>
                  </div>
                  <button onClick={closeQuickOnboard} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.qoBotToken", lang)}</label>
                    <input
                      type="text"
                      value={qoToken}
                      onChange={(e) => setQoToken(e.target.value)}
                      placeholder="123456789:ABCdefGHI..."
                      className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60 font-mono"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">{t("gmTenants.qoOwnerEmail", lang)}</label>
                    <input
                      type="email"
                      value={qoEmail}
                      onChange={(e) => setQoEmail(e.target.value)}
                      placeholder="owner@salon.com"
                      className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60"
                    />
                  </div>
                  {quickOnboardMut.error && (
                    <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                      {quickOnboardMut.error.message}
                    </p>
                  )}
                  <button
                    onClick={() => quickOnboardMut.mutate({ salonName: qoName, plan: qoPlan, botToken: qoToken, ownerEmail: qoEmail })}
                    disabled={!qoToken.includes(":") || !qoEmail.includes("@") || quickOnboardMut.isPending}
                    className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white font-semibold text-sm active:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                  >
                    {quickOnboardMut.isPending ? (
                      <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{t("gmTenants.qoCreating", lang)}</span>
                    ) : (
                      t("gmTenants.qoCreateAll", lang)
                    )}
                  </button>
                </div>
              </>
            )}

            {/* Step 3: Success / Credentials */}
            {qoStep === 3 && qoResult && (
              <>
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-base font-bold text-emerald-400">{t("gmTenants.qoSalonCreated", lang)}</h3>
                  <button onClick={closeQuickOnboard} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  {/* Credentials card */}
                  <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">{t("gmTenants.qoEmail", lang)}</p>
                        <p className="text-sm font-mono text-slate-900 dark:text-white">{qoResult.ownerEmail}</p>
                      </div>
                      <CopyBtn value={qoResult.ownerEmail} />
                    </div>
                    <div className="border-t border-slate-200 dark:border-slate-700/40" />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">{t("gmTenants.qoPassword", lang)}</p>
                        <p className="text-sm font-mono text-slate-900 dark:text-white select-all">{qoResult.tempPassword}</p>
                      </div>
                      <CopyBtn value={qoResult.tempPassword} />
                    </div>
                  </div>

                  <p className="text-[10px] text-amber-400 text-center font-medium">
                    {t("gmTenants.qoPasswordOnce", lang)}
                  </p>

                  {/* Details */}
                  <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center justify-between">
                      <span>{t("gmTenants.qoTenantId", lang)}</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">{qoResult.tenantId}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>{t("gmTenants.qoBotId", lang)}</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">{qoResult.botId}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>{t("gmTenants.qoWebhook", lang)}</span>
                      <span className={qoResult.webhookOk ? "text-emerald-400" : "text-red-400"}>
                        {qoResult.webhookOk ? "OK" : "Failed"}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={closeQuickOnboard}
                    className="w-full py-3.5 rounded-2xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-sm active:bg-slate-300 dark:active:bg-slate-700 mt-2"
                  >
                    {t("gmTenants.close", lang)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
