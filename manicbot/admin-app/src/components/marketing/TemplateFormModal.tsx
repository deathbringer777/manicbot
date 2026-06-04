"use client";

/**
 * TemplateFormModal — create or edit a marketing template.
 *
 * Channel select drives subject visibility (subject is email-only). Merge-
 * variable chip-set above the body is informational; clicking a chip inserts
 * the variable at the caret position. Submits through whichever scope
 * (admin / tenant) the caller picked.
 */

import { useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";

const FIELD_BASE =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";

const LABEL =
  "mb-1 block text-xs font-medium text-slate-600 dark:text-white/70";

const MERGE_VARS = ["{{name}}", "{{first_name}}", "{{email}}", "{{phone}}", "{{salon}}", "{{unsubscribe_url}}"];

export interface TemplateInitial {
  id: string;
  name: string;
  channel: "email" | "sms" | "whatsapp";
  subject?: string | null;
  body: string;
  locale?: string | null;
}

/**
 * `presetSeed` pre-fills the create form (e.g. from the starter pack) but
 * does NOT mark the modal as "edit". The user can tweak and Save creates a
 * fresh row.
 */
export interface TemplateSeed {
  name?: string;
  channel?: "email" | "sms" | "whatsapp";
  subject?: string;
  body?: string;
  locale?: string;
}

interface Props {
  scope: { mode: "admin" } | { mode: "tenant"; tenantId: string };
  initial?: TemplateInitial | null;
  presetSeed?: TemplateSeed | null;
  /**
   * If provided, the created row's id is handed back through this callback
   * before `onSaved` fires. The Automation modal uses this to auto-select
   * a freshly created template.
   */
  onCreated?: (id: string) => void;
  onClose: () => void;
  onSaved: () => void;
}

export function TemplateFormModal({ scope, initial, presetSeed, onCreated, onClose, onSaved }: Props) {
  const { lang } = useLang();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? presetSeed?.name ?? "");
  const [channel, setChannel] = useState<"email" | "sms" | "whatsapp">(
    initial?.channel ?? presetSeed?.channel ?? "email",
  );
  const [subject, setSubject] = useState(initial?.subject ?? presetSeed?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? presetSeed?.body ?? "");
  const [locale, setLocale] = useState(initial?.locale ?? presetSeed?.locale ?? "ru");
  const [err, setErr] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const utils = api.useUtils();
  function invalidate() {
    if (scope.mode === "admin") {
      void utils.marketing.templatesList.invalidate();
    } else {
      void utils.marketingTenant.templatesList.invalidate({ tenantId: scope.tenantId });
    }
  }

  const adminCreate = api.marketing.templateCreate.useMutation({
    onSuccess: (r) => { invalidate(); onCreated?.(r.id); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const adminUpdate = api.marketing.templateUpdate.useMutation({
    onSuccess: () => { invalidate(); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const tenantCreate = api.marketingTenant.templateCreate.useMutation({
    onSuccess: (r) => { invalidate(); onCreated?.(r.id); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });
  const tenantUpdate = api.marketingTenant.templateUpdate.useMutation({
    onSuccess: () => { invalidate(); onSaved(); onClose(); },
    onError: (e) => setErr(e.message),
  });

  const pending =
    adminCreate.isPending || adminUpdate.isPending ||
    tenantCreate.isPending || tenantUpdate.isPending;

  const valid = name.trim().length > 0 && body.trim().length > 0;

  function insertVar(v: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody((prev) => prev + v);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + v + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + v.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!valid) {
      setErr(t("marketing.template.form.missingFields", lang));
      return;
    }
    if (isEdit) {
      const patch = {
        id: initial!.id,
        name: name.trim(),
        subject: channel === "email" ? (subject.trim() || null) : null,
        body: body.trim(),
        locale: locale.trim() || null,
      };
      if (scope.mode === "admin") adminUpdate.mutate(patch);
      else tenantUpdate.mutate({ ...patch, tenantId: scope.tenantId });
    } else {
      const payload = {
        name: name.trim(),
        channel,
        subject: channel === "email" ? (subject.trim() || undefined) : undefined,
        body: body.trim(),
        locale: locale.trim() || undefined,
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
        className="w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isEdit
              ? t("marketing.template.form.title.edit", lang)
              : t("marketing.template.form.title.create", lang)}
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
            <label className={LABEL}>{t("marketing.template.form.name", lang)} *</label>
            <input
              type="text"
              autoFocus
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD_BASE}
              data-testid="tpl-name"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("marketing.template.form.channel", lang)}</label>
              <Select
                value={channel}
                disabled={isEdit}
                onChange={(v) => setChannel(v as "email" | "sms" | "whatsapp")}
                options={[
                  { value: "email", label: "Email" },
                  { value: "sms", label: "SMS" },
                  { value: "whatsapp", label: "WhatsApp" },
                ]}
                testIdPrefix="tpl-channel"
              />
              {isEdit && (
                <p className="mt-1 text-[10px] text-slate-500">
                  {t("marketing.template.form.channelLocked", lang)}
                </p>
              )}
            </div>
            <div>
              <label className={LABEL}>{t("marketing.template.form.locale", lang)}</label>
              <Select
                value={locale}
                onChange={setLocale}
                options={[
                  { value: "ru", label: "Русский" },
                  { value: "ua", label: "Українська" },
                  { value: "en", label: "English" },
                  { value: "pl", label: "Polski" },
                ]}
                testIdPrefix="tpl-locale"
              />
            </div>
          </div>

          {channel === "email" && (
            <div>
              <label className={LABEL}>{t("marketing.template.form.subject", lang)} *</label>
              <input
                type="text"
                maxLength={300}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("marketing.template.form.subjectPlaceholder", lang)}
                className={FIELD_BASE}
                data-testid="tpl-subject"
              />
            </div>
          )}

          <div>
            <label className={LABEL}>{t("marketing.template.form.body", lang)} *</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <span className="text-[10px] text-slate-500 mr-1 self-center">
                {t("marketing.template.form.mergeHint", lang)}:
              </span>
              {MERGE_VARS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-700 transition hover:bg-slate-100 hover:border-violet-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                >
                  {v}
                </button>
              ))}
            </div>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              maxLength={20000}
              placeholder={channel === "email"
                ? t("marketing.template.form.bodyPlaceholderEmail", lang)
                : t("marketing.template.form.bodyPlaceholderSms", lang)}
              className={`${FIELD_BASE} font-mono text-[13px] leading-relaxed`}
              data-testid="tpl-body"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              {channel === "email"
                ? t("marketing.template.form.bodyHintEmail", lang)
                : t("marketing.template.form.bodyHintSms", lang)}
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
              data-testid="tpl-submit"
            >
              {pending
                ? "…"
                : isEdit
                  ? t("common.save", lang)
                  : t("marketing.template.form.create", lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
