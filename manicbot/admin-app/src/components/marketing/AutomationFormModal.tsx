"use client";

/**
 * AutomationFormModal — create or edit a marketing automation.
 *
 * v1 step model: one `send_email` step pointing to a template + optional
 * segment. The trigger metadata (trigger_type, trigger_config_json) is
 * captured but the actual cron engine doesn't fire it yet — only the
 * manual "Run Now" path uses the saved automation.
 *
 * Presets pre-fill the form (welcome_series / re_engagement / birthday /
 * booking_reminder / abandoned_booking) — same metadata that the previous
 * Phase-1 placeholder grid hard-coded.
 */

import { useState, type FormEvent } from "react";
import { X, Plus, Sparkles } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";
import { TemplateFormModal, type TemplateSeed } from "./TemplateFormModal";
import { STARTER_TEMPLATES, getStarterForLocale } from "./templateStarterPack";

const FIELD_BASE =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";

const LABEL = "mb-1 block text-xs font-medium text-slate-600 dark:text-white/70";

export type TriggerType =
  | "welcome_series"
  | "re_engagement"
  | "birthday"
  | "booking_reminder"
  | "abandoned_booking"
  | "manual";

export interface AutomationInitial {
  id: string;
  name: string;
  triggerType: string;
  triggerConfigJson: string | null;
  stepsJson: string;
  enabled: number;
}

export interface AutomationPreset {
  triggerType: TriggerType;
  nameKey: string;
}

interface Props {
  scope: { mode: "admin" } | { mode: "tenant"; tenantId: string };
  initial?: AutomationInitial | null;
  /** Optional preset that pre-fills name + triggerType before the user types. */
  preset?: AutomationPreset | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AutomationFormModal({ scope, initial, preset, onClose, onSaved }: Props) {
  const { lang } = useLang();
  const isEdit = !!initial;

  const presetName = preset ? t(preset.nameKey as never, lang) : "";

  const [name, setName] = useState(initial?.name ?? presetName);
  const [triggerType, setTriggerType] = useState<TriggerType>(
    (initial?.triggerType as TriggerType) ?? preset?.triggerType ?? "manual",
  );
  // v1 step state — we only support one send_email step in the UI; advanced
  // multi-step sequences can be entered as raw JSON below if anyone needs
  // it during PR-B (the textarea is shown only in advanced mode).
  const initialStep = (() => {
    try {
      const v = JSON.parse(initial?.stepsJson ?? "[]");
      if (Array.isArray(v) && v[0]) return v[0];
    } catch { /* ignore */ }
    return { type: "send_email", templateId: "", segmentId: null };
  })();
  const [templateId, setTemplateId] = useState<string>(initialStep.templateId ?? "");
  const [segmentId, setSegmentId] = useState<string>(initialStep.segmentId ?? "");
  const [err, setErr] = useState<string | null>(null);
  /**
   * Inline template-creation flow. When the user clicks "+ Создать шаблон"
   * (or picks a starter card), we open TemplateFormModal layered on top —
   * its onCreated callback auto-selects the new template here so the user
   * doesn't have to come back through a dropdown.
   */
  const [tplModal, setTplModal] = useState<{ seed: TemplateSeed | null } | null>(null);
  const [showStarterPack, setShowStarterPack] = useState(false);

  const adminTemplatesQ = api.marketing.templatesList.useQuery(
    { channel: "email" },
    { enabled: scope.mode === "admin" },
  );
  const tenantTemplatesQ = api.marketingTenant.templatesList.useQuery(
    scope.mode === "tenant" ? { tenantId: scope.tenantId, channel: "email" } : { tenantId: "", channel: "email" },
    { enabled: scope.mode === "tenant" },
  );
  const adminSegmentsQ = api.marketing.segmentsList.useQuery(undefined, { enabled: scope.mode === "admin" });
  const tenantSegmentsQ = api.marketingTenant.segmentsList.useQuery(
    scope.mode === "tenant" ? { tenantId: scope.tenantId } : { tenantId: "" },
    { enabled: scope.mode === "tenant" },
  );
  const templates = (scope.mode === "admin" ? adminTemplatesQ.data : tenantTemplatesQ.data) ?? [];
  const segments = (scope.mode === "admin" ? adminSegmentsQ.data : tenantSegmentsQ.data) ?? [];

  const utils = api.useUtils();
  function invalidate() {
    if (scope.mode === "admin") void utils.marketing.automationsList.invalidate();
    else void utils.marketingTenant.automationsList.invalidate({ tenantId: scope.tenantId });
  }

  const adminCreate = api.marketing.automationCreate.useMutation({
    onSuccess: () => { invalidate(); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const adminUpdate = api.marketing.automationUpdate.useMutation({
    onSuccess: () => { invalidate(); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const tenantCreate = api.marketingTenant.automationCreate.useMutation({
    onSuccess: () => { invalidate(); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const tenantUpdate = api.marketingTenant.automationUpdate.useMutation({
    onSuccess: () => { invalidate(); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const pending = adminCreate.isPending || adminUpdate.isPending || tenantCreate.isPending || tenantUpdate.isPending;
  const valid = name.trim().length > 0 && templateId.length > 0;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!valid) {
      setErr(t("marketing.automation.form.missingFields", lang));
      return;
    }
    const stepsJson = JSON.stringify([
      { type: "send_email", templateId, segmentId: segmentId || null, channel: "email" },
    ]);
    if (isEdit) {
      const patch = {
        id: initial!.id,
        name: name.trim(),
        triggerType,
        stepsJson,
      };
      if (scope.mode === "admin") adminUpdate.mutate(patch);
      else tenantUpdate.mutate({ ...patch, tenantId: scope.tenantId });
    } else {
      const payload = {
        name: name.trim(),
        triggerType,
        stepsJson,
        enabled: false,
      };
      if (scope.mode === "admin") adminCreate.mutate(payload);
      else tenantCreate.mutate({ ...payload, tenantId: scope.tenantId });
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isEdit
              ? t("marketing.automation.form.title.edit", lang)
              : t("marketing.automation.form.title.create", lang)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 text-sm">
          <div>
            <label className={LABEL}>{t("marketing.automation.form.name", lang)} *</label>
            <input
              type="text"
              autoFocus
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD_BASE}
              data-testid="auto-name"
            />
          </div>

          <div>
            <label className={LABEL}>{t("marketing.automation.form.trigger", lang)}</label>
            <Select
              value={triggerType}
              onChange={(v) => setTriggerType(v as TriggerType)}
              options={[
                { value: "manual", label: t("marketing.automation.trigger.manual", lang) },
                { value: "welcome_series", label: t("marketing.automation.trigger.welcome_series", lang) },
                { value: "re_engagement", label: t("marketing.automation.trigger.re_engagement", lang) },
                { value: "birthday", label: t("marketing.automation.trigger.birthday", lang) },
                { value: "booking_reminder", label: t("marketing.automation.trigger.booking_reminder", lang) },
                { value: "abandoned_booking", label: t("marketing.automation.trigger.abandoned_booking", lang) },
              ]}
              testIdPrefix="auto-trigger"
            />
            {triggerType !== "manual" && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                {t("marketing.automation.form.triggerNotice", lang)}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL}>{t("marketing.automation.form.template", lang)} *</label>
            <Select
              value={templateId}
              onChange={setTemplateId}
              placeholder={t("marketing.campaign.form.templatePlaceholder", lang)}
              options={templates.map((tpl: any) => ({ value: tpl.id, label: tpl.name }))}
              testIdPrefix="auto-template"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTplModal({ seed: null })}
                className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
                data-testid="auto-new-template"
              >
                <Plus className="h-3 w-3" />
                {t("marketing.automation.form.newTemplate", lang)}
              </button>
              <button
                type="button"
                onClick={() => setShowStarterPack((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                data-testid="auto-show-starter"
              >
                <Sparkles className="h-3 w-3" />
                {t("marketing.automation.form.pickStarter", lang)}
              </button>
            </div>
            {showStarterPack && (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {STARTER_TEMPLATES.filter((s) => s.channel === "email").map((card) => {
                  const c = getStarterForLocale(card, lang);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => {
                        setTplModal({
                          seed: {
                            name: c.name,
                            channel: "email",
                            subject: c.subject,
                            body: c.body,
                            locale: lang,
                          },
                        });
                        setShowStarterPack(false);
                      }}
                      className="flex flex-col items-start gap-0.5 rounded-md border border-slate-200 bg-white p-2 text-left transition hover:border-violet-300 hover:bg-violet-50/40 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-violet-400/40 dark:hover:bg-violet-500/5"
                    >
                      <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                        {c.title}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {c.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {templates.length === 0 && !showStarterPack && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                {t("marketing.campaign.form.noTemplates", lang)}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL}>{t("marketing.automation.form.segment", lang)}</label>
            <Select
              value={segmentId}
              onChange={setSegmentId}
              placeholder={t("marketing.campaign.form.segmentAll", lang)}
              options={[
                { value: "", label: t("marketing.campaign.form.segmentAll", lang) },
                ...segments.map((s: any) => ({ value: s.id, label: s.name })),
              ]}
              testIdPrefix="auto-segment"
            />
          </div>

          {err && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/[0.05]"
            >
              {t("common.cancel", lang)}
            </button>
            <button
              type="submit"
              disabled={pending || !valid}
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
              data-testid="auto-submit"
            >
              {pending ? "…" : isEdit ? t("common.save", lang) : t("marketing.automation.form.create", lang)}
            </button>
          </div>
        </form>
      </div>
      {tplModal && (
        <TemplateFormModal
          scope={scope}
          presetSeed={tplModal.seed}
          onCreated={(id) => {
            // Auto-select the freshly created template + refresh the
            // dropdown options. The mutation already invalidated the
            // templates query inside TemplateFormModal.
            setTemplateId(id);
          }}
          onClose={() => setTplModal(null)}
          onSaved={() => setTplModal(null)}
        />
      )}
    </div>
  );
}
