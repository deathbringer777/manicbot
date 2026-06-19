"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { PageHeader } from "~/components/ui/PageHeader";
import { EmptyState } from "~/components/ui/EmptyState";
import { SkeletonCard } from "~/components/ui/Skeleton";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import {
  Bot,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

const ALL = "__all__";

/**
 * God Mode "Bots" page — see every connected bot + live Telegram webhook
 * status, and re-register a broken webhook in one click. Backed by
 * api.adminBots (which proxies to the Worker; tokens never reach the browser).
 */
export default function BotsPageClient() {
  const { lang } = useLang();
  const utils = api.useUtils();
  const { data: bots = [], isLoading, error } = api.adminBots.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const resetMut = api.adminBots.resetWebhook.useMutation({
    onSettled: () => {
      setBusyId(null);
      void utils.adminBots.list.invalidate();
    },
  });

  const fixOne = (botId: string) => { setBusyId(botId); resetMut.mutate({ botId }); };
  const fixAll = () => { setBusyId(ALL); resetMut.mutate({}); };

  const broken = bots.filter((b) => !b.webhook.set).length;

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <PageHeader
            title={t("bots.title", lang)}
            subtitle={
              isLoading
                ? t("bots.loading", lang)
                : `${bots.length} ботов${broken ? ` · ${broken} без webhook` : ""}`
            }
          />
          <button
            onClick={fixAll}
            disabled={resetMut.isPending || bots.length === 0}
            className="flex items-center gap-1.5 bg-brand-600 active:bg-brand-500 disabled:opacity-50 text-white px-4 py-2.5 text-sm font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all"
          >
            {busyId === ALL && resetMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {t("bots.fixAll", lang)}
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
            {error.message}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
          </div>
        ) : bots.length === 0 ? (
          <EmptyState
            icon={Bot}
            title={t("bots.emptyTitle", lang)}
            description={t("bots.emptyDesc", lang)}
          />
        ) : (
          <div className="space-y-3">
            {bots.map((b) => {
              const ok = b.webhook.set;
              const busy = busyId === b.botId && resetMut.isPending;
              return (
                <div key={b.botId} className="glass-card rounded-2xl p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">
                        {b.username ? `@${b.username}` : b.botId}
                      </span>
                      {!b.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400">
                          выкл
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {b.tenantId ?? "—"} · id {b.botId}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs">
                      {ok ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-emerald-500">webhook активен</span>
                          {!!b.webhook.pending && (
                            <span className="text-slate-500">· очередь {b.webhook.pending}</span>
                          )}
                        </>
                      ) : b.webhook.error ? (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-amber-500">{b.webhook.error}</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5 text-red-500" />
                          <span className="text-red-500">webhook не установлен</span>
                        </>
                      )}
                    </div>
                    {b.webhook.lastErrorMessage && (
                      <div className="text-[11px] text-red-400/80 truncate mt-0.5">
                        {b.webhook.lastErrorMessage}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => fixOne(b.botId)}
                    disabled={resetMut.isPending}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-400 text-xs font-medium active:bg-brand-500/20 disabled:opacity-50 transition-colors"
                  >
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Переустановить
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
