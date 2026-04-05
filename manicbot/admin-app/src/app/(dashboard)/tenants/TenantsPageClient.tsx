"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
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
} from "lucide-react";

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
          Да, точно
        </button>
        <button onClick={() => setStep(0)} className="px-2.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 text-xs">
          Нет
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

export default function TenantsPageClient() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPlan, setCreatePlan] = useState<"start" | "pro" | "studio">("pro");
  const [roleModal, setRoleModal] = useState<string | null>(null); // tenantId
  const [roleChatId, setRoleChatId] = useState("");
  const [roleType, setRoleType] = useState<"tenant_owner" | "master" | "admin">("master");
  const [botModal, setBotModal] = useState<string | null>(null); // tenantId
  const [botId, setBotId] = useState("");
  const [botUsername, setBotUsername] = useState("");

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

  const ROLE_LABELS: Record<string, string> = {
    tenant_owner: "Владелец", master: "Мастер", admin: "Администратор",
  };

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Tenants</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{tenants.length} салонов</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            Создать
          </button>
        </div>

        {/* Tenants list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {tenants.map((t) => (
              <div key={t.id} className="glass-card rounded-2xl overflow-hidden">
                {/* Tenant header */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 flex items-center justify-center text-base shrink-0">
                      {t.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{t.name}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${STATUS_COLORS[t.billingStatus ?? "inactive"] ?? STATUS_COLORS.inactive}`}>
                          {t.billingStatus ?? "inactive"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded border border-brand-500/20 text-brand-400 text-[9px] font-bold uppercase">
                          {t.plan ?? "start"}
                        </span>
                        {!t.active && (
                          <span className="px-1.5 py-0.5 rounded border border-red-500/20 text-red-400 text-[9px] font-bold">ОТКЛ</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {t.active ? (
                        <button onClick={() => deactivateMut.mutate({ id: t.id })} disabled={deactivateMut.isPending}
                          className="p-2 rounded-xl bg-red-500/10 active:bg-red-500/20 text-red-400 disabled:opacity-50">
                          <PowerOff className="w-4 h-4" />
                        </button>
                      ) : (
                        <button onClick={() => activateMut.mutate({ id: t.id })} disabled={activateMut.isPending}
                          className="p-2 rounded-xl bg-emerald-500/10 active:bg-emerald-500/20 text-emerald-400 disabled:opacity-50">
                          <Power className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {expanded === t.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30">
                    <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"><Users className="w-3 h-3" />{t.userCount}</span>
                    <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"><CalendarDays className="w-3 h-3" />{t.appointmentCount} записей</span>
                    {t.bot && <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 truncate"><Bot className="w-3 h-3 shrink-0" />@{t.bot.botUsername}</span>}
                  </div>
                </div>

                {/* Expanded detail */}
                {expanded === t.id && (
                  <div className="border-t border-border/50 bg-slate-50 dark:bg-slate-900/40 space-y-4 p-4">
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Услуги", value: detail?.services.length ?? "…" },
                        { label: "Мастера", value: detail?.masters.length ?? "…" },
                        { label: "Пользователи", value: detail?.userCount ?? "…" },
                        { label: "Записи", value: detail?.appointmentCount ?? "…" },
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
                      {detail?.trialEndsAt && <p className="text-slate-500 dark:text-slate-400"><span className="text-slate-500">Триал до: </span>{new Date(detail.trialEndsAt * 1000).toLocaleDateString("ru-RU")}</p>}
                      <p className="text-slate-600 font-mono text-[9px]">{t.id}</p>
                    </div>

                    {/* ── God Actions ── */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">God Actions</p>
                      <div className="flex flex-wrap gap-2">
                        <ConfirmButton
                          label="Подтвердить все записи"
                          onClick={() => confirmAllMut.mutate({ tenantId: t.id })}
                          color="green"
                          icon={CheckCircle}
                          disabled={confirmAllMut.isPending}
                        />
                        <ConfirmButton
                          label="Отменить все pending"
                          onClick={() => cancelAllMut.mutate({ tenantId: t.id })}
                          color="red"
                          icon={XCircle}
                          disabled={cancelAllMut.isPending}
                        />
                        <button
                          onClick={() => { setRoleModal(t.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-400 text-xs font-medium active:bg-brand-500/20"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          Выдать роль
                        </button>
                        <button
                          onClick={() => { setBotModal(t.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600/30 bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 text-xs font-medium active:bg-slate-100 dark:active:bg-slate-700/50"
                        >
                          <Bot className="w-3.5 h-3.5" />
                          Привязать бота
                        </button>
                      </div>
                    </div>

                    {/* Tenant roles */}
                    {tenantRoles && tenantRoles.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Роли в тенанте</p>
                        <div className="space-y-1.5">
                          {tenantRoles.map((r) => (
                            <div key={`${r.tenantId}:${r.chatId}`} className="flex items-center justify-between bg-slate-100 dark:bg-slate-800/40 rounded-xl px-3 py-2">
                              <div>
                                <span className="text-xs font-mono text-slate-600 dark:text-slate-300">#{r.chatId}</span>
                                <span className="ml-2 text-[10px] text-brand-400 font-bold uppercase">{ROLE_LABELS[r.role] ?? r.role}</span>
                              </div>
                              <button
                                onClick={() => removeRoleMut.mutate({ tenantId: t.id, chatId: r.chatId })}
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
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Услуги</p>
                        <div className="flex flex-wrap gap-1.5">
                          {detail.services.map((s) => (
                            <span key={s.svcId} className={`px-2 py-0.5 rounded text-[10px] ${s.active ? "bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-300" : "bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 line-through"}`}>
                              {s.emoji} {s.svcId} · {s.price}\u00a0zł
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
              <div className="glass-card rounded-2xl py-16 text-center">
                <p className="text-slate-500 text-sm">Нет тенантов</p>
                <button onClick={() => setShowCreate(true)} className="mt-4 flex items-center gap-2 mx-auto px-4 py-2 bg-brand-500/20 text-brand-400 rounded-xl text-sm font-medium">
                  <Plus className="w-4 h-4" />Создать первый
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Create Tenant Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-t-3xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-5" />
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Новый тенант</h3>
              <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Название салона</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Например: Nails Studio"
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Тарифный план</label>
                <div className="flex gap-2">
                  {(["start", "pro", "studio"] as const).map((p) => (
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
                {createMut.isPending ? "Создание..." : "✦ Создать тенант"}
              </button>
              {createMut.data && (
                <p className="text-center text-xs text-emerald-400">
                  ✓ Создан: <span className="font-mono">{createMut.data.tenantId}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Grant Tenant Role Modal ── */}
      {roleModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setRoleModal(null)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-t-3xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-5" />
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Выдать роль в тенанте</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{roleModal}</p>
              </div>
              <button onClick={() => setRoleModal(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Telegram Chat ID</label>
                <input
                  type="number"
                  value={roleChatId}
                  onChange={(e) => setRoleChatId(e.target.value)}
                  placeholder="321706035"
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Роль</label>
                <div className="flex gap-2">
                  {([
                    { key: "master", label: "Мастер" },
                    { key: "tenant_owner", label: "Владелец" },
                    { key: "admin", label: "Админ" },
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
                {setRoleMut.isPending ? "..." : "Выдать роль"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link Bot Modal ── */}
      {botModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setBotModal(null)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-t-3xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-5" />
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Привязать бота</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{botModal}</p>
              </div>
              <button onClick={() => setBotModal(null)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Bot ID (числовой, из токена)</label>
                <input
                  type="text"
                  value={botId}
                  onChange={(e) => setBotId(e.target.value)}
                  placeholder="8752028834"
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Bot Username (без @)</label>
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
                {linkBotMut.isPending ? "..." : "Привязать бота"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
