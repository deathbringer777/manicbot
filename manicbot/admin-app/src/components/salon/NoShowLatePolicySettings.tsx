"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";
import { SectionHeader } from "~/components/salon/SalonShared";
import {
  DEFAULT_NO_SHOW_POLICY,
  type NoShowPolicy,
} from "~/server/policy/noShowPolicy";

/**
 * Per-tenant "no-show & lateness policy" editor. The whole policy is one JSON
 * blob in `tenant_config` (key `no_show_policy`), read atomically by the
 * markNoShow grace gate and the Worker client-notification path. Neutral
 * defaults = flag + warning + notify the client, no auto-enforcement.
 *
 * NOTE: `prepayment` / `penaltyAmount` are SURFACED (staff instruction + client
 * message), not auto-charged — there is no client-facing payment integration yet.
 */
const LABEL =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50";
const NUM =
  "w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400";

export function NoShowLatePolicySettings({ tenantId, bare = false }: { tenantId: string; bare?: boolean }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const { data, isLoading } = api.salon.getNoShowPolicy.useQuery({ tenantId });
  const save = api.salon.setNoShowPolicy.useMutation({
    onSuccess: () => { void utils.salon.getNoShowPolicy.invalidate({ tenantId }); },
  });

  const [draft, setDraft] = useState<NoShowPolicy>(DEFAULT_NO_SHOW_POLICY);
  // Seed the editable draft once the server policy arrives (and on tenant switch).
  useEffect(() => {
    if (data) setDraft(data as NoShowPolicy);
  }, [data]);

  function set<K extends keyof NoShowPolicy>(key: K, value: NoShowPolicy[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const dirty = !!data && JSON.stringify(draft) !== JSON.stringify(data);

  const inner = (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("salon.noShowPolicy.body", lang)}
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Grace + notification ─────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <label className={LABEL}>{t("salon.noShowPolicy.graceMinutes", lang)}</label>
              <input
                type="number" min={0} max={240} value={draft.graceMinutes}
                onChange={(e) => set("graceMinutes", Math.max(0, Math.min(240, Number(e.target.value) || 0)))}
                className={NUM} data-testid="nsp-grace"
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{t("salon.noShowPolicy.graceHint", lang)}</p>
            </div>

            <ToggleRow
              label={t("salon.noShowPolicy.notifyClient", lang)}
              hint={t("salon.noShowPolicy.notifyClientHint", lang)}
              enabled={draft.notifyClient}
              onToggle={() => set("notifyClient", !draft.notifyClient)}
            />

            {draft.notifyClient && (
              <div>
                <label className={LABEL}>{t("salon.noShowPolicy.notifyTone", lang)}</label>
                <Select
                  value={draft.notifyTone}
                  onChange={(v) => set("notifyTone", v as NoShowPolicy["notifyTone"])}
                  options={[
                    { value: "neutral", label: t("salon.noShowPolicy.tone.neutral", lang) },
                    { value: "firm", label: t("salon.noShowPolicy.tone.firm", lang) },
                  ]}
                  testIdPrefix="nsp-tone"
                />
              </div>
            )}
          </div>

          {/* ── Escalation for repeat offenders ──────────────────────── */}
          <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-white/5">
            <SubHead text={t("salon.noShowPolicy.escalationTitle", lang)} />
            <div>
              <label className={LABEL}>{t("salon.noShowPolicy.afterCount", lang)}</label>
              <input
                type="number" min={0} max={50} value={draft.afterCount}
                onChange={(e) => set("afterCount", Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                className={NUM} data-testid="nsp-after"
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{t("salon.noShowPolicy.afterCountHint", lang)}</p>
            </div>

            <div className={draft.afterCount === 0 ? "opacity-50 pointer-events-none space-y-3" : "space-y-3"}>
              <div>
                <label className={LABEL}>{t("salon.noShowPolicy.prepayment", lang)}</label>
                <Select
                  value={draft.prepayment}
                  onChange={(v) => set("prepayment", v as NoShowPolicy["prepayment"])}
                  options={[
                    { value: "none", label: t("salon.noShowPolicy.prepay.none", lang) },
                    { value: "deposit50", label: t("salon.noShowPolicy.prepay.deposit50", lang) },
                    { value: "deposit100", label: t("salon.noShowPolicy.prepay.deposit100", lang) },
                    { value: "cash", label: t("salon.noShowPolicy.prepay.cash", lang) },
                  ]}
                  testIdPrefix="nsp-prepay"
                />
              </div>
              <div>
                <label className={LABEL}>{t("salon.noShowPolicy.penalty", lang)}</label>
                <input
                  type="number" min={0} value={draft.penaltyAmount}
                  onChange={(e) => set("penaltyAmount", Math.max(0, Number(e.target.value) || 0))}
                  className={NUM} data-testid="nsp-penalty"
                />
              </div>
              <div>
                <label className={LABEL}>{t("salon.noShowPolicy.autoAction", lang)}</label>
                <Select
                  value={draft.autoAction}
                  onChange={(v) => set("autoAction", v as NoShowPolicy["autoAction"])}
                  options={[
                    { value: "none", label: t("salon.noShowPolicy.auto.none", lang) },
                    { value: "require_confirm", label: t("salon.noShowPolicy.auto.requireConfirm", lang) },
                    { value: "auto_block", label: t("salon.noShowPolicy.auto.autoBlock", lang) },
                  ]}
                  testIdPrefix="nsp-auto"
                />
              </div>
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                {t("salon.noShowPolicy.prepayNote", lang)}
              </p>
            </div>
          </div>

          {/* ── Lateness + refunds ───────────────────────────────────── */}
          <div className="grid gap-3 border-t border-slate-200 pt-4 dark:border-white/5 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("salon.noShowPolicy.lateness", lang)}</label>
              <Select
                value={draft.lateness}
                onChange={(v) => set("lateness", v as NoShowPolicy["lateness"])}
                options={[
                  { value: "none", label: t("salon.noShowPolicy.preset.none", lang) },
                  { value: "neutral", label: t("salon.noShowPolicy.preset.neutral", lang) },
                  { value: "strict", label: t("salon.noShowPolicy.preset.strict", lang) },
                ]}
                testIdPrefix="nsp-lateness"
              />
            </div>
            <div>
              <label className={LABEL}>{t("salon.noShowPolicy.lateGrace", lang)}</label>
              <input
                type="number" min={0} max={240} value={draft.lateGraceMinutes}
                onChange={(e) => set("lateGraceMinutes", Math.max(0, Math.min(240, Number(e.target.value) || 0)))}
                className={NUM} data-testid="nsp-late-grace"
              />
            </div>
            <div>
              <label className={LABEL}>{t("salon.noShowPolicy.refund", lang)}</label>
              <Select
                value={draft.refund}
                onChange={(v) => set("refund", v as NoShowPolicy["refund"])}
                options={[
                  { value: "none", label: t("salon.noShowPolicy.preset.none", lang) },
                  { value: "neutral", label: t("salon.noShowPolicy.preset.neutral", lang) },
                  { value: "strict", label: t("salon.noShowPolicy.preset.strict", lang) },
                ]}
                testIdPrefix="nsp-refund"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-white/5">
            {save.isSuccess && !dirty && (
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{t("common.saved", lang)}</span>
            )}
            <button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate({ tenantId, policy: draft })}
              className={
                !dirty || save.isPending
                  ? "rounded-lg bg-slate-200 px-4 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500"
                  : "rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-600"
              }
              data-testid="nsp-save"
            >
              {save.isPending ? t("salon.day.panel.saving", lang) : t("common.save", lang)}
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (bare) return <div className="space-y-3">{inner}</div>;

  return (
    <div className="space-y-4">
      <SectionHeader title={t("salon.noShowPolicy.title", lang)} />
      <div className="glass-card rounded-2xl p-4 space-y-3">{inner}</div>
    </div>
  );
}

function SubHead({ text }: { text: string }) {
  return <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">{text}</p>;
}

function ToggleRow({ label, hint, enabled, onToggle }: { label: string; hint: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors mt-0.5 ${
          enabled ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
