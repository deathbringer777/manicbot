"use client";

/**
 * SMS Campaigns tab — same UX as Email Campaigns but channel locked to `sms`.
 *
 * Gating: if Brevo SMS is not configured (`BREVO_API_KEY` + `BREVO_SMS_SENDER`
 * env vars), the Create CTA is disabled and we show env-var snippets. The
 * existing-row list still renders so an operator can review past sends.
 */

import { useState } from "react";
import { MarketingShell } from "../MarketingShell";
import { api } from "~/trpc/react";
import { MessageSquare, Plus, Send, Trash2, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useMarketingScope } from "../useMarketingScope";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { CampaignFormModal } from "~/components/marketing/CampaignFormModal";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";

type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  status: string;
  segmentId: string | null;
  provider: string | null;
  scheduledAt: number | null;
  statsJson: string | null;
};

function StatusBadge({ status, lang }: { status: string; lang: any }) {
  const map: Record<string, { cls: string; key: string; Icon: any }> = {
    draft:     { cls: "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300", key: "marketing.campaign.status.draft", Icon: Clock },
    scheduled: { cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", key: "marketing.campaign.status.scheduled", Icon: Clock },
    sending:   { cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300", key: "marketing.campaign.status.sending", Icon: Send },
    sent:      { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", key: "marketing.campaign.status.sent", Icon: CheckCircle2 },
    failed:    { cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", key: "marketing.campaign.status.failed", Icon: XCircle },
    paused:    { cls: "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300", key: "marketing.campaign.status.paused", Icon: Clock },
  };
  const m = map[status] ?? map.draft!;
  const { Icon } = m;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${m.cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {t(m.key as any, lang)}
    </span>
  );
}

function parseStats(json: string | null | undefined): { sent: number; total: number; failed: number } | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (v && typeof v === "object") {
      return { sent: Number(v.sent ?? 0), total: Number(v.total ?? 0), failed: Number(v.failed ?? 0) };
    }
  } catch { /* ignore */ }
  return null;
}

export default function SmsClient() {
  const { lang } = useLang();
  const { mode, tenantId } = useMarketingScope();

  // Provider config — drives the "not configured" gate.
  const adminProvidersQ = api.marketing.providersList.useQuery(undefined, { enabled: mode === "admin" });
  const tenantProvidersQ = api.marketingTenant.providersList.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: mode === "tenant" && !!tenantId },
  );
  const providersQ = mode === "admin" ? adminProvidersQ : tenantProvidersQ;
  const brevo = providersQ.data?.find((p: any) => p.name === "brevo");
  const smsConfigured = !!brevo?.configured?.sms;

  const adminListQ = api.marketing.campaignsList.useQuery(
    { channel: "sms" },
    { enabled: mode === "admin" },
  );
  const tenantListQ = api.marketingTenant.campaignsList.useQuery(
    { tenantId: tenantId ?? "", channel: "sms" },
    { enabled: mode === "tenant" && !!tenantId },
  );
  const listQ = mode === "admin" ? adminListQ : tenantListQ;

  const utils = api.useUtils();
  function invalidate() {
    if (mode === "admin") void utils.marketing.campaignsList.invalidate();
    else if (tenantId) void utils.marketingTenant.campaignsList.invalidate({ tenantId });
  }

  const adminDelete = api.marketing.campaignDelete.useMutation({ onSuccess: invalidate });
  const tenantDelete = api.marketingTenant.campaignDelete.useMutation({ onSuccess: invalidate });
  const adminSend = api.marketing.campaignSendNow.useMutation({ onSuccess: invalidate });
  const tenantSend = api.marketingTenant.campaignSendNow.useMutation({ onSuccess: invalidate });

  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<CampaignRow | null>(null);
  const [sending, setSending] = useState<CampaignRow | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const scope = mode === "admin"
    ? ({ mode: "admin" } as const)
    : tenantId
      ? ({ mode: "tenant", tenantId } as const)
      : null;

  function doDelete() {
    if (!deleting) return;
    if (mode === "admin") adminDelete.mutate({ id: deleting.id });
    else if (tenantId) tenantDelete.mutate({ tenantId, id: deleting.id });
    setDeleting(null);
  }

  async function doSend() {
    if (!sending) return;
    setSendResult(null);
    try {
      const out = mode === "admin"
        ? await adminSend.mutateAsync({ id: sending.id })
        : tenantId
          ? await tenantSend.mutateAsync({ tenantId, id: sending.id })
          : null;
      if (out) {
        if (out.ok) {
          setSendResult(t("marketing.campaign.send.success", lang)
            .replace("{sent}", String(out.sent ?? 0))
            .replace("{total}", String(out.total ?? 0)));
        } else {
          setSendResult(t("marketing.campaign.send.failed", lang)
            .replace("{error}", out.error ?? "unknown_error"));
        }
      }
    } catch (e: any) {
      setSendResult(e?.message ?? "send failed");
    } finally {
      setSending(null);
    }
  }

  const sendPending = adminSend.isPending || tenantSend.isPending;

  return (
    <MarketingShell title="Marketing • SMS" subtitle={t("marketing.sms.subtitle", lang)}>
      {/* Brevo SMS status gate */}
      {!smsConfigured && (
        <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {t("marketing.sms.notConfigured.title", lang)}
              </div>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                {t("marketing.sms.notConfigured.description", lang)}
              </p>
              <div className="mt-2 space-y-1 text-[11px] font-mono">
                <div>
                  <code className="bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 rounded text-amber-900 dark:text-amber-200">
                    BREVO_API_KEY
                  </code>
                  <span className="text-amber-700 dark:text-amber-400 ml-1.5">— xkeysib-…</span>
                </div>
                <div>
                  <code className="bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 rounded text-amber-900 dark:text-amber-200">
                    BREVO_SMS_SENDER
                  </code>
                  <span className="text-amber-700 dark:text-amber-400 ml-1.5">— {t("marketing.sms.notConfigured.senderHint", lang)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("marketing.sms.cardTitle", lang)}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t("marketing.sms.cardDescription", lang)}
            </p>
          </div>
          {scope && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              disabled={!smsConfigured}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title={smsConfigured ? undefined : t("marketing.sms.notConfigured.cta", lang)}
              data-testid="sms-new"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("marketing.sms.create", lang)}
            </button>
          )}
        </div>

        {sendResult && (
          <div className="mb-3 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-200">
            {sendResult}
            <button
              type="button"
              onClick={() => setSendResult(null)}
              className="ml-2 text-violet-700 dark:text-violet-400 underline"
            >
              {t("common.dismiss", lang)}
            </button>
          </div>
        )}

        {listQ.isLoading ? (
          <div className="text-xs text-slate-500 py-4 text-center">{t("common.loading", lang)}…</div>
        ) : listQ.data?.length ? (
          <ul className="space-y-1.5">
            {listQ.data.map((row: CampaignRow) => {
              const stats = parseStats(row.statsJson);
              const canSend = (row.status === "draft" || row.status === "scheduled") && smsConfigured;
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {row.name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                      <StatusBadge status={row.status} lang={lang} />
                      <span className="px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800/60">{row.channel}</span>
                      {row.segmentId
                        ? <span>seg: <span className="font-mono">{row.segmentId}</span></span>
                        : <span>{t("marketing.campaign.list.allSubscribers", lang)}</span>}
                      {stats && (
                        <span className="font-mono">
                          {stats.sent}/{stats.total}
                          {stats.failed > 0 && <span className="text-red-500"> · {stats.failed} ✗</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canSend && (
                      <button
                        type="button"
                        onClick={() => setSending(row)}
                        disabled={sendPending}
                        className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                        data-testid={`sms-send-${row.id}`}
                      >
                        <Send className="h-3 w-3" />
                        {t("marketing.campaign.send", lang)}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleting(row)}
                      className="rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                      aria-label={t("common.delete", lang)}
                      title={t("common.delete", lang)}
                      data-testid={`sms-delete-${row.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-sm text-slate-700 dark:text-slate-400 font-medium mb-1">
              {t("marketing.sms.empty.title", lang)}
            </div>
            <div className="text-xs text-slate-500">
              {smsConfigured
                ? t("marketing.sms.empty.subtitle", lang)
                : t("marketing.sms.notConfigured.cta", lang)}
            </div>
          </div>
        )}
      </div>

      {showCreate && scope && smsConfigured && (
        <CampaignFormModal
          scope={scope}
          forcedChannel="sms"
          onClose={() => setShowCreate(false)}
          onSaved={() => setShowCreate(false)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        tone="danger"
        title={t("marketing.campaign.delete.title", lang)}
        description={deleting
          ? t("marketing.campaign.delete.description", lang).replace("{name}", deleting.name)
          : ""}
        confirmLabel={t("common.delete", lang)}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={!!sending}
        tone="warning"
        busy={sendPending}
        title={t("marketing.campaign.send.confirmTitle", lang)}
        description={sending
          ? t("marketing.campaign.send.confirmDescription", lang).replace("{name}", sending.name)
          : ""}
        confirmLabel={t("marketing.campaign.send", lang)}
        onConfirm={doSend}
        onCancel={() => setSending(null)}
      />
    </MarketingShell>
  );
}
