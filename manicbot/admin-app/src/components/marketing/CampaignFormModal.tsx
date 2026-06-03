"use client";

/**
 * CampaignFormModal — create a marketing campaign.
 *
 * Audience preview fires live whenever segment/channel change so the user
 * sees the count before they save. Scheduled-at is optional — leaving it
 * blank stores the campaign as `draft` which can then be sent with the
 * "Отправить" button on the row.
 *
 * The form does NOT trigger a send — it just creates the row. The send is
 * the explicit Send-now button on the row (which goes through ConfirmDialog).
 *
 * `forcedChannel` locks the channel select (used by the SMS tab in PR-B).
 */

import { useState, type FormEvent } from "react";
import { X, Users as UsersIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";

const FIELD_BASE =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-brand-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";

const LABEL =
  "mb-1 block text-xs font-medium text-slate-600 dark:text-white/70";

type Channel = "email" | "sms" | "whatsapp";

interface Props {
  scope: { mode: "admin" } | { mode: "tenant"; tenantId: string };
  forcedChannel?: Channel;
  onClose: () => void;
  onSaved: () => void;
}

export function CampaignFormModal({ scope, forcedChannel, onClose, onSaved }: Props) {
  const { lang } = useLang();

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>(forcedChannel ?? "email");
  const [templateId, setTemplateId] = useState<string>("");
  const [segmentId, setSegmentId] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  // Data sources for the two selects.
  const adminTemplatesQ = api.marketing.templatesList.useQuery(
    { channel },
    { enabled: scope.mode === "admin" },
  );
  const tenantTemplatesQ = api.marketingTenant.templatesList.useQuery(
    scope.mode === "tenant" ? { tenantId: scope.tenantId, channel } : { tenantId: "", channel },
    { enabled: scope.mode === "tenant" },
  );
  const adminSegmentsQ = api.marketing.segmentsList.useQuery(undefined, { enabled: scope.mode === "admin" });
  const tenantSegmentsQ = api.marketingTenant.segmentsList.useQuery(
    scope.mode === "tenant" ? { tenantId: scope.tenantId } : { tenantId: "" },
    { enabled: scope.mode === "tenant" },
  );
  const templates = (scope.mode === "admin" ? adminTemplatesQ.data : tenantTemplatesQ.data) ?? [];
  const segments = (scope.mode === "admin" ? adminSegmentsQ.data : tenantSegmentsQ.data) ?? [];

  // Audience preview — tenant-scoped only (god mode runs the same proc with
  // tenantId in admin path; segmentless preview at god-mode requires picking
  // a tenant; we surface a hint instead).
  const audienceTenantQ = api.marketingTenant.campaignAudiencePreview.useQuery(
    scope.mode === "tenant"
      ? { tenantId: scope.tenantId, segmentId: segmentId || null, channel }
      : { tenantId: "", segmentId: null, channel },
    { enabled: scope.mode === "tenant" },
  );

  const utils = api.useUtils();
  function invalidate() {
    if (scope.mode === "admin") {
      void utils.marketing.campaignsList.invalidate();
    } else {
      void utils.marketingTenant.campaignsList.invalidate({ tenantId: scope.tenantId });
    }
  }

  const adminCreate = api.marketing.campaignCreate.useMutation({
    onSuccess: () => { invalidate(); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const tenantCreate = api.marketingTenant.campaignCreate.useMutation({
    onSuccess: () => { invalidate(); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const pending = adminCreate.isPending || tenantCreate.isPending;

  const valid = name.trim().length > 0 && templateId.length > 0;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!valid) {
      setErr(t("marketing.campaign.form.missingFields", lang));
      return;
    }
    const scheduledSec = scheduledAt ? Math.floor(new Date(scheduledAt).getTime() / 1000) : undefined;
    const base = {
      name: name.trim(),
      channel,
      templateId,
      segmentId: segmentId || undefined,
      scheduledAt: scheduledSec,
    };
    if (scope.mode === "admin") adminCreate.mutate(base);
    else tenantCreate.mutate({ ...base, tenantId: scope.tenantId });
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
            {t("marketing.campaign.form.title.create", lang)}
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
            <label className={LABEL}>{t("marketing.campaign.form.name", lang)} *</label>
            <input
              type="text"
              autoFocus
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD_BASE}
              data-testid="cmp-name"
            />
          </div>

          {!forcedChannel && (
            <div>
              <label className={LABEL}>{t("marketing.campaign.form.channel", lang)}</label>
              <Select
                value={channel}
                onChange={(v) => {
                  setChannel(v as Channel);
                  setTemplateId("");
                }}
                options={[
                  { value: "email", label: "Email" },
                  { value: "sms", label: "SMS" },
                  { value: "whatsapp", label: "WhatsApp" },
                ]}
                testIdPrefix="cmp-channel"
              />
            </div>
          )}

          <div>
            <label className={LABEL}>{t("marketing.campaign.form.template", lang)} *</label>
            <Select
              value={templateId}
              onChange={setTemplateId}
              placeholder={t("marketing.campaign.form.templatePlaceholder", lang)}
              options={templates.map((tpl: any) => ({ value: tpl.id, label: tpl.name }))}
              testIdPrefix="cmp-template"
            />
            {templates.length === 0 && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                {t("marketing.campaign.form.noTemplates", lang)}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL}>{t("marketing.campaign.form.segment", lang)}</label>
            <Select
              value={segmentId}
              onChange={setSegmentId}
              placeholder={t("marketing.campaign.form.segmentAll", lang)}
              options={[
                { value: "", label: t("marketing.campaign.form.segmentAll", lang) },
                ...segments.map((s: any) => ({ value: s.id, label: s.name })),
              ]}
              testIdPrefix="cmp-segment"
            />
            {scope.mode === "tenant" && (
              <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/40 px-2 py-1 text-[11px] text-violet-700 dark:text-violet-300">
                <UsersIcon className="h-3 w-3" />
                <span>
                  {audienceTenantQ.isLoading
                    ? t("marketing.campaign.form.audienceLoading", lang)
                    : t("marketing.campaign.form.audienceCount", lang).replace(
                        "{count}",
                        String(audienceTenantQ.data?.count ?? 0),
                      )}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className={LABEL}>{t("marketing.campaign.form.scheduledAt", lang)}</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className={FIELD_BASE}
              data-testid="cmp-scheduled"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              {t("marketing.campaign.form.scheduledHint", lang)}
            </p>
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
              data-testid="cmp-submit"
            >
              {pending ? "…" : t("marketing.campaign.form.save", lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
