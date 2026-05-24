"use client";

/**
 * PlatformCustomerDetailModal — read-only detail view for a salon owner.
 *
 * Mounted by `SystemCustomersClient` when the operator clicks a row in
 * the Accounts tab. Follows the 0062 modal stacking contract:
 *   - Overlay: `fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-md`
 *   - Card:    `bg-white dark:bg-slate-900 ring-1 ring-black/5`
 *
 * No mutations live here — Stripe Dashboard handles subscription
 * mutations. The Stripe link is computed server-side off
 * `tenants.stripe_customer_id`.
 */

import { useEffect } from "react";
import { X, ExternalLink, Mail, User, CreditCard, CalendarDays, Activity, AlertTriangle } from "lucide-react";
import { api } from "~/trpc/react";

interface Props {
  webUserId: string;
  onClose: () => void;
}

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

function fmtRel(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 0) {
    const future = -diff;
    if (future < 86400) return `через ${Math.round(future / 3600)} ч`;
    return `через ${Math.round(future / 86400)} дн`;
  }
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.round(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ч назад`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} дн назад`;
  return new Date(ts * 1000).toLocaleDateString();
}

function statusTone(status: string | null | undefined): { cls: string; label: string } {
  switch (status) {
    case "active":
      return { cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-emerald-500/20", label: "active" };
    case "grace":
      return { cls: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-amber-500/20", label: "grace" };
    case "trialing":
    case "trial":
      return { cls: "bg-blue-500/10 text-blue-600 dark:text-blue-300 ring-blue-500/20", label: "trialing" };
    case "past_due":
      return { cls: "bg-orange-500/10 text-orange-600 dark:text-orange-300 ring-orange-500/20", label: "past_due" };
    case "expired":
    case "cancelled":
    case "canceled":
      return { cls: "bg-red-500/10 text-red-600 dark:text-red-300 ring-red-500/20", label: status ?? "expired" };
    default:
      return { cls: "bg-slate-500/10 text-slate-500 ring-slate-500/20", label: status ?? "—" };
  }
}

export function PlatformCustomerDetailModal({ webUserId, onClose }: Props) {
  const detailQ = api.platformCustomers.accountDetail.useQuery(
    { webUserId },
    { enabled: !!webUserId, staleTime: 60_000 },
  );

  // Escape closes — same pattern as the Clients tab detail modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = detailQ.data;
  const tone = statusTone(d?.billingStatus ?? null);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="platform-customer-detail-overlay"
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-white/5 dark:bg-slate-900/95">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">
              {d?.name || d?.email || "Аккаунт салона"}
            </h2>
            {d?.email && d?.name && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{d.email}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-white/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {detailQ.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-6 animate-pulse rounded bg-slate-100 dark:bg-slate-800/40" />
              ))}
            </div>
          )}

          {detailQ.isError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>Не удалось загрузить детали. Попробуйте обновить страницу.</span>
            </div>
          )}

          {d && (
            <>
              {/* Identity */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <User className="h-3.5 w-3.5" /> Профиль
                </h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Имя</dt>
                    <dd className="text-slate-900 dark:text-slate-100">{d.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Email</dt>
                    <dd className="break-all text-slate-900 dark:text-slate-100">{d.email}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Язык</dt>
                    <dd className="text-slate-900 dark:text-slate-100">{d.lang ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Email verified</dt>
                    <dd className="text-slate-900 dark:text-slate-100">
                      {d.emailVerified ? "да" : "нет"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Регистрация</dt>
                    <dd className="text-slate-900 dark:text-slate-100">{fmtTs(d.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Последний вход</dt>
                    <dd className="text-slate-900 dark:text-slate-100">
                      {fmtRel(d.lastLoginAt)} {d.lastLoginIp && <span className="text-slate-400">({d.lastLoginIp})</span>}
                    </dd>
                  </div>
                  {d.referralSource && (
                    <div className="col-span-2">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">Реферал</dt>
                      <dd className="text-slate-900 dark:text-slate-100">{d.referralSource}</dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* Tenant + plan */}
              {d.tenantId ? (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <CreditCard className="h-3.5 w-3.5" /> Тариф и биллинг
                  </h3>
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/5 dark:bg-white/[0.02]">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {d.tenantName ?? d.tenantId}
                      </span>
                      {d.isTest === 1 && (
                        <span className="inline-flex items-center rounded-md bg-yellow-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-yellow-700 ring-1 ring-yellow-500/30 dark:text-yellow-300">
                          TEST
                        </span>
                      )}
                      {d.isPersonal === 1 && (
                        <span className="inline-flex items-center rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700 ring-1 ring-violet-500/30 dark:text-violet-300">
                          PERSONAL
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[10px] text-slate-400">{d.tenantId}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-slate-400">План</dt>
                        <dd className="text-slate-900 dark:text-slate-100">{d.plan ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-slate-400">Статус</dt>
                        <dd>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone.cls}`}>
                            {tone.label}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-slate-400">MRR</dt>
                        <dd className="text-slate-900 dark:text-slate-100">
                          {d.mrrPln > 0 ? `${d.mrrPln} PLN/мес` : <span className="text-slate-400">—</span>}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-slate-400">Конец триала</dt>
                        <dd className="text-slate-900 dark:text-slate-100">{fmtRel(d.trialEndsAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-slate-400">Конец периода</dt>
                        <dd className="text-slate-900 dark:text-slate-100">{fmtRel(d.currentPeriodEnd)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-slate-400">Отмена в конце периода</dt>
                        <dd className="text-slate-900 dark:text-slate-100">
                          {d.cancelAtPeriodEnd ? "да" : "нет"}
                        </dd>
                      </div>
                    </dl>

                    {d.stripeDashboardUrl && (
                      <a
                        href={d.stripeDashboardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-700 ring-1 ring-violet-500/20 transition hover:bg-violet-500/20 dark:text-violet-300"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Открыть в Stripe
                      </a>
                    )}
                  </div>
                </section>
              ) : (
                <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Этот аккаунт зарегистрирован, но салон не создан — onboarding застрял.
                </section>
              )}

              {/* Activity rollup */}
              {d.tenantId && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <Activity className="h-3.5 w-3.5" /> Активность
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-white/5 dark:bg-white/[0.02]">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">Мастеров</div>
                      <div className="text-2xl font-bold text-slate-900 dark:text-white">{d.mastersCount}</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-white/5 dark:bg-white/[0.02]">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">Всего записей</div>
                      <div className="text-2xl font-bold text-slate-900 dark:text-white">{d.appointmentsTotal}</div>
                    </div>
                  </div>
                </section>
              )}

              {/* Recent appointments */}
              {d.tenantId && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <CalendarDays className="h-3.5 w-3.5" /> Последние записи
                  </h3>
                  {d.recentAppointments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-white/10">
                      Записей пока нет.
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-white/5 dark:border-white/5">
                      {d.recentAppointments.map((apt) => (
                        <li
                          key={apt.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-slate-900 dark:text-slate-100">
                              {apt.userName ?? <span className="italic text-slate-400">без имени</span>}
                            </div>
                            <div className="font-mono text-[10px] text-slate-400">
                              {apt.date} {apt.time}
                            </div>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-white/5 dark:text-slate-300">
                            {apt.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section className="border-t border-slate-100 pt-3 dark:border-white/5">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Mail className="h-3 w-3" />
                  <span>Это представление только для чтения. Действия с подпиской — через Stripe Dashboard.</span>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
