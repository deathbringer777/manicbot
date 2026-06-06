"use client";

/**
 * Automations tab — replaces the Phase-1 placeholder grid.
 *
 * Two sections:
 *   1. "Quick Start" — 5 preset cards (Welcome / Re-engagement / Birthday /
 *      Booking Reminder / Abandoned Booking). Clicking a card pre-fills
 *      the Create form. These are the same 5 from the old PLANNED_AUTOMATIONS
 *      placeholder — just now actually clickable.
 *   2. Real automations list — toggle / Run Now / Edit / Delete.
 *
 * ⚠ PARKED — DO NOT DELETE. This surface is complete and works (manual
 * "Run Now" sends end-to-end), but it is hidden from users behind
 * MARKETING_AUTOMATIONS_ENABLED (see ~/lib/featureFlags). The tab is dropped
 * from the marketing sub-nav (~/lib/nav/marketingTabs) and the route's
 * page.tsx redirects direct hits to /marketing. It is parked — not dead —
 * because the cron engine that would auto-fire these triggers (birthday /
 * inactive_30d / new-contact / booking) isn't built yet, and pre-launch there
 * are ~0 consented contacts so a manual run resolves to "0 of 0". The full
 * unlock runbook lives in ~/lib/featureFlags.
 */

import { useState } from "react";
import { MarketingShell } from "../MarketingShell";
import { api } from "~/trpc/react";
import { Bell, RefreshCw, Gift, Clock, ShoppingCart, Sparkles, Play, Pencil, Trash2, AlertCircle } from "lucide-react";
import { useMarketingScope } from "../useMarketingScope";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { AutomationFormModal, type AutomationInitial, type AutomationPreset } from "~/components/marketing/AutomationFormModal";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";

const PRESETS: Array<{
  triggerType: AutomationPreset["triggerType"];
  icon: any;
  nameKey: string;
  descKey: string;
}> = [
  { triggerType: "welcome_series",    icon: Bell,         nameKey: "marketing.automation.preset.welcome_series.name",    descKey: "marketing.automation.preset.welcome_series.desc" },
  { triggerType: "re_engagement",     icon: RefreshCw,    nameKey: "marketing.automation.preset.re_engagement.name",     descKey: "marketing.automation.preset.re_engagement.desc" },
  { triggerType: "birthday",          icon: Gift,         nameKey: "marketing.automation.preset.birthday.name",          descKey: "marketing.automation.preset.birthday.desc" },
  { triggerType: "booking_reminder",  icon: Clock,        nameKey: "marketing.automation.preset.booking_reminder.name",  descKey: "marketing.automation.preset.booking_reminder.desc" },
  { triggerType: "abandoned_booking", icon: ShoppingCart, nameKey: "marketing.automation.preset.abandoned_booking.name", descKey: "marketing.automation.preset.abandoned_booking.desc" },
  { triggerType: "post_visit_24h",    icon: Sparkles,     nameKey: "marketing.automation.preset.post_visit_24h.name",    descKey: "marketing.automation.preset.post_visit_24h.desc" },
];

export default function AutomationsClient() {
  const { lang } = useLang();
  const { mode, tenantId } = useMarketingScope();

  const adminListQ = api.marketing.automationsList.useQuery(undefined, { enabled: mode === "admin" });
  const tenantListQ = api.marketingTenant.automationsList.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: mode === "tenant" && !!tenantId },
  );
  const listQ = mode === "admin" ? adminListQ : tenantListQ;

  const utils = api.useUtils();
  function invalidate() {
    if (mode === "admin") void utils.marketing.automationsList.invalidate();
    else if (tenantId) void utils.marketingTenant.automationsList.invalidate({ tenantId });
  }

  const adminToggle = api.marketing.automationToggle.useMutation({ onSuccess: invalidate });
  const tenantToggle = api.marketingTenant.automationToggle.useMutation({ onSuccess: invalidate });
  const adminDelete = api.marketing.automationDelete.useMutation({ onSuccess: invalidate });
  const tenantDelete = api.marketingTenant.automationDelete.useMutation({ onSuccess: invalidate });
  const adminRun = api.marketing.automationRunNow.useMutation({ onSuccess: invalidate });
  const tenantRun = api.marketingTenant.automationRunNow.useMutation({ onSuccess: invalidate });

  const [presetForCreate, setPresetForCreate] = useState<AutomationPreset | null>(null);
  const [showBlankCreate, setShowBlankCreate] = useState(false);
  const [editing, setEditing] = useState<AutomationInitial | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [running, setRunning] = useState<{ id: string; name: string } | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  const scope = mode === "admin"
    ? ({ mode: "admin" } as const)
    : tenantId
      ? ({ mode: "tenant", tenantId } as const)
      : null;

  function startPreset(p: typeof PRESETS[number]) {
    setPresetForCreate({ triggerType: p.triggerType, nameKey: p.nameKey });
  }

  function doToggle(id: string, enabled: boolean) {
    if (mode === "admin") adminToggle.mutate({ id, enabled });
    else if (tenantId) tenantToggle.mutate({ tenantId, id, enabled });
  }

  function doDelete() {
    if (!deleting) return;
    if (mode === "admin") adminDelete.mutate({ id: deleting.id });
    else if (tenantId) tenantDelete.mutate({ tenantId, id: deleting.id });
    setDeleting(null);
  }

  async function doRun() {
    if (!running) return;
    setRunResult(null);
    try {
      const out = mode === "admin"
        ? await adminRun.mutateAsync({ id: running.id })
        : tenantId
          ? await tenantRun.mutateAsync({ tenantId, id: running.id })
          : null;
      if (out) {
        if (out.ok) {
          setRunResult(t("marketing.automation.run.success", lang)
            .replace("{name}", running.name)
            .replace("{sent}", String(out.sent ?? 0))
            .replace("{total}", String(out.total ?? 0)));
        } else {
          setRunResult(t("marketing.automation.run.failed", lang)
            .replace("{error}", out.error ?? "unknown_error"));
        }
      }
    } catch (e: any) {
      setRunResult(e?.message ?? "run failed");
    } finally {
      setRunning(null);
    }
  }

  const runPending = adminRun.isPending || tenantRun.isPending;

  return (
    <MarketingShell title="Marketing • Automations" subtitle={t("marketing.automation.subtitle", lang)}>
      {/* Trigger-engine disclaimer */}
      <div className="mb-4 rounded-lg border border-violet-200 dark:border-violet-900/40 bg-violet-50 dark:bg-violet-950/30 p-3 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
        <div className="text-xs text-violet-900 dark:text-violet-200 leading-relaxed">
          {t("marketing.automation.engineDisclaimer", lang)}
        </div>
      </div>

      {/* Quick-start presets */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t("marketing.automation.quickStart.title", lang)}
          </h3>
          {scope && (
            <button
              type="button"
              onClick={() => setShowBlankCreate(true)}
              className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline"
              data-testid="auto-new-blank"
            >
              {t("marketing.automation.createBlank", lang)} →
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.triggerType}
              type="button"
              onClick={() => startPreset(p)}
              disabled={!scope}
              className="text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-3 transition hover:border-violet-300 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`auto-preset-${p.triggerType}`}
            >
              <div className="flex items-start gap-2">
                <p.icon className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t(p.nameKey as never, lang)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                    {t(p.descKey as never, lang)}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Live automations list */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
          {t("marketing.automation.live.title", lang)}
        </h3>

        {runResult && (
          <div className="mb-3 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-200">
            {runResult}
            <button
              type="button"
              onClick={() => setRunResult(null)}
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
            {listQ.data.map((row: any) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{row.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                    <span className="px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800/60 font-mono">
                      {row.triggerType}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${
                      row.enabled
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                        : "bg-slate-200 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400"
                    }`}>
                      {row.enabled
                        ? t("marketing.automation.enabled", lang)
                        : t("marketing.automation.disabled", lang)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setRunning({ id: row.id, name: row.name })}
                    disabled={runPending}
                    className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
                    data-testid={`auto-run-${row.id}`}
                  >
                    <Play className="h-3 w-3" />
                    {t("marketing.automation.runNow", lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => doToggle(row.id, !row.enabled)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label={row.enabled ? t("marketing.automation.disable", lang) : t("marketing.automation.enable", lang)}
                    title={row.enabled ? t("marketing.automation.disable", lang) : t("marketing.automation.enable", lang)}
                    data-testid={`auto-toggle-${row.id}`}
                  >
                    {row.enabled
                      ? <span className="text-[10px] font-bold">OFF</span>
                      : <span className="text-[10px] font-bold">ON</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing({
                      id: row.id,
                      name: row.name,
                      triggerType: row.triggerType,
                      triggerConfigJson: row.triggerConfigJson ?? null,
                      stepsJson: row.stepsJson ?? "[]",
                      enabled: row.enabled,
                    })}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label={t("common.edit", lang)}
                    title={t("common.edit", lang)}
                    data-testid={`auto-edit-${row.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting({ id: row.id, name: row.name })}
                    className="rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    aria-label={t("common.delete", lang)}
                    title={t("common.delete", lang)}
                    data-testid={`auto-delete-${row.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-sm text-slate-700 dark:text-slate-400 font-medium mb-1">
              {t("marketing.automation.empty.title", lang)}
            </div>
            <div className="text-xs text-slate-500">
              {t("marketing.automation.empty.subtitle", lang)}
            </div>
          </div>
        )}
      </div>

      {(showBlankCreate || presetForCreate) && scope && (
        <AutomationFormModal
          scope={scope}
          preset={presetForCreate}
          onClose={() => { setShowBlankCreate(false); setPresetForCreate(null); }}
          onSaved={() => { setShowBlankCreate(false); setPresetForCreate(null); }}
        />
      )}
      {editing && scope && (
        <AutomationFormModal
          scope={scope}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        tone="danger"
        title={t("marketing.automation.delete.title", lang)}
        description={deleting
          ? t("marketing.automation.delete.description", lang).replace("{name}", deleting.name)
          : ""}
        confirmLabel={t("common.delete", lang)}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={!!running}
        tone="warning"
        busy={runPending}
        title={t("marketing.automation.run.confirmTitle", lang)}
        description={running
          ? t("marketing.automation.run.confirmDescription", lang).replace("{name}", running.name)
          : ""}
        confirmLabel={t("marketing.automation.runNow", lang)}
        onConfirm={doRun}
        onCancel={() => setRunning(null)}
      />
    </MarketingShell>
  );
}
