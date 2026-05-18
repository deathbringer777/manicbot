"use client";

import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

type State = "healthy" | "warning" | "needs_attention" | "broken" | "not_configured";

const STATE_STYLES: Record<State, { wrap: string; icon: string; label: string; Icon: typeof CheckCircle2 }> = {
  healthy: {
    wrap: "bg-emerald-500/10 border-emerald-500/20",
    icon: "text-emerald-400",
    label: "text-emerald-400",
    Icon: CheckCircle2,
  },
  warning: {
    wrap: "bg-amber-500/10 border-amber-500/20",
    icon: "text-amber-400",
    label: "text-amber-400",
    Icon: Clock,
  },
  needs_attention: {
    wrap: "bg-orange-500/10 border-orange-500/20",
    icon: "text-orange-400",
    label: "text-orange-400",
    Icon: AlertTriangle,
  },
  broken: {
    wrap: "bg-red-500/10 border-red-500/20",
    icon: "text-red-400",
    label: "text-red-400",
    Icon: ShieldAlert,
  },
  not_configured: {
    wrap: "bg-slate-500/10 border-slate-500/20",
    icon: "text-slate-400",
    label: "text-slate-400",
    Icon: Activity,
  },
};

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

function formatRelative(hoursSince: number | null, lang: "ru" | "ua" | "en" | "pl"): string {
  if (hoursSince == null) return t("channels.igHealth.never", lang);
  if (hoursSince < 48) return fill(t("channels.igHealth.hoursAgo", lang), { n: hoursSince });
  return fill(t("channels.igHealth.daysAgo", lang), { n: Math.floor(hoursSince / 24) });
}

/**
 * Map a structured `error_type` slug to the localized human-readable message
 * keyed in i18n. Falls back to the `unknown` slug for anything we haven't
 * surfaced an explicit message for yet, so a future Worker slug doesn't
 * crash the UI.
 */
function translateChannelErrorSlug(
  slug: string | null | undefined,
  lang: "ru" | "ua" | "en" | "pl",
): string {
  const key = (slug || "").startsWith("channel.ig.")
    ? (`channels.ig.errorType.${slug!.slice("channel.ig.".length)}` as const)
    : slug === "channel.meta.signature_mismatch"
    ? ("channels.ig.errorType.signature_mismatch" as const)
    : ("channels.ig.errorType.unknown" as const);
  try {
    return t(key as Parameters<typeof t>[0], lang);
  } catch {
    return t("channels.ig.errorType.unknown", lang);
  }
}

export function IGHealthCard({
  tenantId,
  onRequestReauth,
}: {
  tenantId: string;
  /**
   * Invoked when the operator confirms the "Reconnect" CTA on a broken /
   * needs_attention card. Caller is expected to hard-disconnect the existing
   * channel and refetch — which unmounts this card and surfaces the OAuth
   * picker via `InstagramConnect`.
   */
  onRequestReauth?: () => void;
}) {
  const { lang } = useLang();
  const [confirmReauth, setConfirmReauth] = useState(false);
  const q = api.salon.getInstagramHealth.useQuery({ tenantId }, { refetchOnWindowFocus: false });

  if (q.isLoading) {
    return (
      <section className="glass-card rounded-2xl p-5 space-y-3 animate-pulse">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("channels.igHealth.title", lang)}
        </div>
        <div className="h-16 rounded-xl bg-slate-200/30 dark:bg-slate-700/30" />
      </section>
    );
  }
  if (q.error || !q.data) return null;
  const h = q.data;
  if (!h.configured) return null;

  const style = STATE_STYLES[h.state];
  const stateLabelKey = {
    healthy: "channels.igHealth.state.healthy",
    warning: "channels.igHealth.state.warning",
    needs_attention: "channels.igHealth.state.needsAttention",
    broken: "channels.igHealth.state.broken",
  }[h.state] as
    | "channels.igHealth.state.healthy"
    | "channels.igHealth.state.warning"
    | "channels.igHealth.state.needsAttention"
    | "channels.igHealth.state.broken";

  return (
    <section className={`rounded-2xl border p-5 space-y-3 ${style.wrap}`}>
      <div className="flex items-center gap-2">
        <style.Icon className={`h-4 w-4 ${style.icon}`} />
        <h4 className={`text-xs font-bold ${style.label}`}>{t(stateLabelKey, lang)}</h4>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <div className="flex flex-col gap-0.5 rounded-xl bg-white/[0.04] dark:bg-black/20 px-3 py-2">
          <dt className="text-slate-500 dark:text-slate-400">{t("channels.igHealth.lastInbound", lang)}</dt>
          <dd className="font-mono text-slate-900 dark:text-slate-100">{formatRelative(h.hoursSinceLastInbound, lang)}</dd>
        </div>

        <div className="flex flex-col gap-0.5 rounded-xl bg-white/[0.04] dark:bg-black/20 px-3 py-2">
          <dt className="text-slate-500 dark:text-slate-400">{t("channels.igHealth.tokenAge", lang)}</dt>
          <dd className="font-mono text-slate-900 dark:text-slate-100">
            {h.tokenAgeDays == null
              ? "—"
              : fill(t("channels.igHealth.tokenAgeDays", lang), { n: h.tokenAgeDays })}
            {h.tokenAgeDays != null && h.tokenAgeDays > 50 && (
              <span className="ml-2 text-[10px] text-amber-400">{t("channels.igHealth.tokenExpiringSoon", lang)}</span>
            )}
          </dd>
        </div>

        <div className="sm:col-span-2 flex items-center gap-2 rounded-xl bg-white/[0.04] dark:bg-black/20 px-3 py-2">
          <span className={`h-1.5 w-1.5 rounded-full ${h.active ? "bg-emerald-400" : "bg-red-400"}`} />
          <span className="text-slate-700 dark:text-slate-300">
            {h.active ? t("channels.igHealth.activeFlag", lang) : t("channels.igHealth.inactiveFlag", lang)}
          </span>
        </div>

        {h.lastError && (
          <div className="sm:col-span-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 space-y-1">
            <dt className="text-red-400 font-medium">{t("channels.igHealth.openError", lang)} (×{h.lastError.count})</dt>
            {/* PR 3: prefer the localized error_type slug over the raw English
                message. The raw message stays available in the title attribute
                so an operator can still grab it for support escalation. */}
            <dd
              className="text-[11px] text-red-300/90 leading-snug"
              title={h.lastError.message}
            >
              {translateChannelErrorSlug(h.lastError.errorType, lang)}
            </dd>
            {h.lastError.errorType && (
              <code className="block font-mono text-[10px] text-red-400/60 truncate">
                {h.lastError.errorType}
              </code>
            )}
          </div>
        )}
      </dl>

      {(h.state === "needs_attention" || h.state === "broken") && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            {t("channels.igHealth.relinkHint", lang)}
          </p>
          {onRequestReauth && !confirmReauth && (
            <button
              type="button"
              data-testid="ig-reauth-cta"
              onClick={() => setConfirmReauth(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white px-4 py-2.5 text-xs font-semibold shadow-lg shadow-pink-500/20 transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("channels.ig.reauth.button", lang)}
            </button>
          )}
          {onRequestReauth && confirmReauth && (
            <div className="rounded-xl border border-red-500/20 p-3 space-y-2 bg-red-500/5">
              <p className="text-[11px] font-semibold text-red-400">{t("channels.ig.reauth.confirmTitle", lang)}</p>
              <p className="text-[11px] text-red-300/90">{t("channels.ig.reauth.confirmBody", lang)}</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  data-testid="ig-reauth-confirm-btn"
                  onClick={() => { setConfirmReauth(false); onRequestReauth(); }}
                  className="flex-1 py-2 rounded-lg bg-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/25 transition-colors"
                >
                  {t("channels.ig.reauth.button", lang)}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReauth(false)}
                  className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                >
                  {t("common.cancel", lang)}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {h.state === "warning" && (
        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
          {t("channels.igHealth.warningHint", lang)}
        </p>
      )}
    </section>
  );
}
