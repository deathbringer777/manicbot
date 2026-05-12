"use client";

import { useState } from "react";
import { MarketingShell } from "../MarketingShell";
import { api } from "~/trpc/react";
import { Loader2, Activity, Zap, ZapOff } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

type HealthResult = {
  status: "ok" | "not_configured" | "degraded" | "down";
  detail?: string;
  account?: string;
  plan?: string;
};

function fmtDate(ts?: number | null) {
  if (!ts) return "never";
  return new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function ProvidersClient() {
  const { lang } = useLang();
  const utils = api.useUtils();
  const listQ = (api as any).marketing.providersList.useQuery();
  const [lastCheck, setLastCheck] = useState<Record<string, HealthResult>>({});

  const checkMut = (api as any).marketing.providerHealthCheck.useMutation({
    onSuccess: (data: any, variables: any) => {
      setLastCheck((p) => ({ ...p, [variables.name]: data }));
      (utils as any).marketing.providersList.invalidate();
    },
  });
  const toggleMut = (api as any).marketing.providerToggle.useMutation({
    onSuccess: () => (utils as any).marketing.providersList.invalidate(),
  });

  return (
    <MarketingShell title="Marketing • Providers" subtitle="Email/SMS транспорт: Brevo, Resend, Twilio">
      {listQ.isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {listQ.data?.map((p: any) => {
            const hc = lastCheck[p.name];
            const status = hc?.status ?? p.db?.healthStatus ?? "unknown";
            const badge =
              status === "ok" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
              : status === "not_configured" ? "bg-slate-200 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700"
              : status === "degraded" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
              : status === "down" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"
              : "bg-slate-200 dark:bg-slate-700/40 text-slate-600 dark:text-slate-500 border-slate-300 dark:border-slate-700";

            return (
              <div key={p.name} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 capitalize">{p.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${badge}`}>
                        {status}
                      </span>
                      {p.db?.enabled ? (
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">{t("marketing.provider.enabled", lang)}</span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">{t("marketing.provider.dormant", lang)}</span>
                      )}
                      {p.db?.isDefault && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">default</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      channels: {p.channels.join(", ")}
                      {" • "}email: {p.configured.email ? "✓" : "✗"}
                      {p.channels.includes("sms") && ` • sms: ${p.configured.sms ? "✓" : "✗"}`}
                    </div>
                    {hc?.detail && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{hc.detail}</div>
                    )}
                    {hc?.account && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                        account: <span className="font-mono text-slate-700 dark:text-slate-300">{hc.account}</span>
                        {hc.plan && <> · plan: <span className="text-slate-700 dark:text-slate-300">{hc.plan}</span></>}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500 dark:text-slate-600 mt-1">
                      last check: {fmtDate(p.db?.lastCheckAt)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => checkMut.mutate({ name: p.name })}
                      disabled={checkMut.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-50"
                    >
                      <Activity className="h-3.5 w-3.5" />
                      Проверить
                    </button>
                    <button
                      onClick={() => toggleMut.mutate({ name: p.name, enabled: !p.db?.enabled })}
                      disabled={toggleMut.isPending}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border transition-colors disabled:opacity-50 ${
                        p.db?.enabled
                          ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30"
                          : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                      }`}
                    >
                      {p.db?.enabled ? <ZapOff className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                      {p.db?.enabled ? "Отключить" : "Включить"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="text-[11px] text-slate-500 rounded-lg border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 p-3">
            <b>Env vars (Cloudflare Pages):</b><br/>
            <code className="text-slate-700 dark:text-slate-300">BREVO_API_KEY</code> — Brevo API ключ (xkeysib-…)<br/>
            <code className="text-slate-700 dark:text-slate-300">BREVO_FROM</code> — отправитель email (<code>ManicBot &lt;noreply@manicbot.com&gt;</code>)<br/>
            <code className="text-slate-700 dark:text-slate-300">BREVO_SMS_SENDER</code> — SMS sender ID (до 11 символов)<br/>
            <code className="text-slate-700 dark:text-slate-300">RESEND_API_KEY</code>, <code className="text-slate-700 dark:text-slate-300">RESEND_FROM</code> — активны для транзакционных писем
          </div>
        </div>
      )}
    </MarketingShell>
  );
}
