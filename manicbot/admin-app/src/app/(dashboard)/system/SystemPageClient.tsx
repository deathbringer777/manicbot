"use client";

import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  Activity, Database, ShieldCheck, AlertTriangle, RefreshCw,
  ScrollText, CheckCircle2, XCircle, Globe, Headphones,
  CreditCard, Mail, Bot, MessageSquare,
} from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

function EnvBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5 last:border-b-0">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      {ok ? (
        <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
          <CheckCircle2 className="w-3 h-3" /> OK
        </span>
      ) : (
        <span className="flex items-center gap-1 text-red-400 text-xs font-medium">
          <XCircle className="w-3 h-3" /> Missing
        </span>
      )}
    </div>
  );
}

export default function SystemPageClient() {
  const { lang } = useLang();
  const {
    data: health,
    isLoading: hLoading,
    refetch: refetchHealth,
    isFetching: hFetching,
  } = api.system.getHealth.useQuery(undefined, { refetchInterval: 30_000 });
  const {
    data: tableStats,
    isLoading: tLoading,
    refetch: refetchTables,
    isFetching: tFetching,
  } = api.system.getTableStats.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: consentLog, isLoading: cLoading } = api.system.getConsentLog.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: envStatus, isLoading: eLoading } = api.system.getEnvStatus.useQuery(undefined, { refetchInterval: 120_000 });

  const isOk = health?.status === "ok";
  const isFetching = hFetching || tFetching;

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{t("gmSystem.title", lang)}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("gmSystem.subtitleFull", lang)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void refetchHealth(); void refetchTables(); }}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
            <div
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border ${
                isOk
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              }`}
            >
              {isOk ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              {isOk ? "OK" : "Error"}
            </div>
          </div>
        </div>

        {/* Health + Totals */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass-card rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-4 h-4 text-brand-400" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">D1 Database</p>
            </div>
            {hLoading ? (
              <div className="h-7 animate-pulse bg-slate-200 dark:bg-slate-800/30 rounded" />
            ) : (
              <>
                <div className={`text-xl font-bold ${health?.dbConnected ? "text-emerald-400" : "text-red-400"}`}>
                  {health?.dbConnected ? "Connected" : "Error"}
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Latency: {health?.dbLatencyMs ?? "—"}ms
                </p>
              </>
            )}
          </div>

          <div className="glass-card rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("gmSystem.totalRows", lang)}</p>
            </div>
            {tLoading ? (
              <div className="h-7 animate-pulse bg-slate-200 dark:bg-slate-800/30 rounded" />
            ) : (
              <div className="text-xl font-bold text-slate-900 dark:text-white">
                {(tableStats?.totalRows ?? 0).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* Environment Status + Connected Services */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Env vars */}
          <div className="glass-card rounded-2xl p-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{t("gmSystem.envVars", lang)}</h2>
            {eLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-6 animate-pulse bg-slate-200 dark:bg-slate-800/30 rounded" />
                ))}
              </div>
            ) : (
              <div>
                <EnvBadge ok={envStatus?.hasAdminChatId ?? false} label="ADMIN_CHAT_ID" />
                <EnvBadge ok={envStatus?.hasTelegramToken ?? false} label="TELEGRAM_BOT_TOKEN" />
                <EnvBadge ok={envStatus?.hasStripeKey ?? false} label="STRIPE_SECRET_KEY" />
                <EnvBadge ok={envStatus?.hasResendKey ?? false} label="RESEND_API_KEY" />
                <EnvBadge ok={envStatus?.hasWorkerUrl ?? false} label="WORKER_PUBLIC_URL" />
                <EnvBadge ok={envStatus?.hasAdminKey ?? false} label="ADMIN_KEY" />
              </div>
            )}
          </div>

          {/* Connected services */}
          <div className="glass-card rounded-2xl p-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{t("gmSystem.connectedServices", lang)}</h2>
            {eLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-6 animate-pulse bg-slate-200 dark:bg-slate-800/30 rounded" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Bot className="w-3.5 h-3.5 text-sky-400" /> {t("gmSystem.telegramBots", lang)}
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{envStatus?.channelCounts?.telegram ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-400" /> WhatsApp
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{envStatus?.channelCounts?.whatsapp ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Globe className="w-3.5 h-3.5 text-pink-400" /> Instagram
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{envStatus?.channelCounts?.instagram ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Headphones className="w-3.5 h-3.5 text-blue-400" /> {t("gmSystem.supportAgents", lang)}
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{envStatus?.agentCount ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <CreditCard className="w-3.5 h-3.5 text-amber-400" /> {t("gmSystem.webUsers", lang)}
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{envStatus?.webUserCount ?? 0}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Table stats */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-white/5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("gmSystem.d1Tables", lang)}</h2>
          </div>
          {tLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse bg-slate-200 dark:bg-slate-800/30 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {(tableStats?.tables ?? []).map((row) => {
                const pct =
                  tableStats && tableStats.totalRows > 0
                    ? Math.round((row.rows / tableStats.totalRows) * 100)
                    : 0;
                return (
                  <div key={row.table} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 w-36 shrink-0 truncate">
                      {row.table}
                    </span>
                    <div className="flex-1">
                      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5">
                        <div
                          className="bg-brand-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${Math.max(pct, 1)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white w-14 text-right shrink-0">
                      {row.rows === -1 ? (
                        <span className="text-red-400 text-xs">err</span>
                      ) : (
                        row.rows.toLocaleString()
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ToS Consent Log */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-white/5 flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">ToS Consent Log</h2>
            {consentLog && (
              <span className="ml-auto text-[10px] text-slate-500">{consentLog.length} records</span>
            )}
          </div>
          {cLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse bg-slate-200 dark:bg-slate-800/30 rounded-lg" />
              ))}
            </div>
          ) : !consentLog?.length ? (
            <div className="p-4 text-xs text-slate-500 text-center">No consent records yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/5">
                    <th className="px-4 py-2 text-left font-medium text-slate-500">Time</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-500">Actor</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-500">Channel</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-500">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {consentLog.map((row) => {
                    let channel = "—";
                    try {
                      const d = JSON.parse(row.detail ?? "{}");
                      channel = d.channel ?? "—";
                    } catch { /* ignore */ }
                    return (
                      <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-300 font-mono">
                          {row.createdAt ? new Date(row.createdAt * 1000).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{row.actor ?? "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            channel === "web"
                              ? "bg-cyan-500/10 text-cyan-400"
                              : channel === "telegram"
                                ? "bg-blue-500/10 text-blue-400"
                                : "bg-slate-500/10 text-slate-400"
                          }`}>
                            {channel}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-500 font-mono">{row.ip ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
