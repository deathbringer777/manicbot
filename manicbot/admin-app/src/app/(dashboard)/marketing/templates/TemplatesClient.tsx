"use client";

import { useState } from "react";
import { MarketingShell } from "../MarketingShell";
import { api } from "~/trpc/react";
import { FileText, Pencil, Trash2, Plus, Mail, Gift, Star, Calendar, Sparkles, MessageSquare, Bell, HeartHandshake } from "lucide-react";
import { useMarketingScope } from "../useMarketingScope";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { TemplateFormModal, type TemplateInitial, type TemplateSeed } from "~/components/marketing/TemplateFormModal";
import { getExampleTemplates } from "~/components/marketing/templateStarterPack";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";

/** Lucide icons referenced by the starter pack, keyed by StarterTemplate.icon name. */
const EXAMPLE_ICONS: Record<string, typeof FileText> = {
  Mail, Gift, Star, Calendar, Sparkles, MessageSquare, Bell, HeartHandshake,
};

export default function TemplatesClient() {
  const { lang } = useLang();
  const { mode, tenantId } = useMarketingScope();

  const adminListQ = api.marketing.templatesList.useQuery({}, { enabled: mode === "admin" });
  const tenantListQ = api.marketingTenant.templatesList.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: mode === "tenant" && !!tenantId },
  );
  const listQ = mode === "admin" ? adminListQ : tenantListQ;

  // Default example tiles are a Pro/Max nicety. getBillingStatus shares the
  // same assertTenantOwner guard as the templates list above, so it adds no
  // new authorization surface; on any failure plan falls back to "start".
  const billingQ = api.salon.getBillingStatus.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: mode === "tenant" && !!tenantId },
  );
  const plan = billingQ.data?.plan ?? "start";
  const showExamples = mode === "tenant" && (plan === "pro" || plan === "max");

  const utils = api.useUtils();
  function invalidate() {
    if (mode === "admin") void utils.marketing.templatesList.invalidate();
    else if (tenantId) void utils.marketingTenant.templatesList.invalidate({ tenantId });
  }

  const adminDelete = api.marketing.templateDelete.useMutation({ onSuccess: invalidate });
  const tenantDelete = api.marketingTenant.templateDelete.useMutation({ onSuccess: invalidate });

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<TemplateInitial | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [seed, setSeed] = useState<TemplateSeed | null>(null);

  const scope = mode === "admin"
    ? ({ mode: "admin" } as const)
    : tenantId
      ? ({ mode: "tenant", tenantId } as const)
      : null;

  function doDelete() {
    if (!deleting) return;
    if (mode === "admin") {
      adminDelete.mutate({ id: deleting.id });
    } else if (tenantId) {
      tenantDelete.mutate({ tenantId, id: deleting.id });
    }
    setDeleting(null);
  }

  return (
    <MarketingShell title="Marketing • Templates" subtitle={t("marketing.template.subtitle", lang)}>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("marketing.template.cardTitle", lang)}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t("marketing.template.cardDescription", lang)}
            </p>
          </div>
          {scope && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
              data-testid="tpl-new"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("marketing.template.create", lang)}
            </button>
          )}
        </div>

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
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {row.name}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    <span className="inline-block px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800/60 mr-1.5">
                      {row.channel}
                    </span>
                    {row.locale ?? "multi"} • <span className="font-mono">{row.id}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing({
                      id: row.id,
                      name: row.name,
                      channel: row.channel,
                      subject: row.subject ?? null,
                      body: row.body ?? "",
                      locale: row.locale ?? null,
                    })}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label={t("common.edit", lang)}
                    title={t("common.edit", lang)}
                    data-testid={`tpl-edit-${row.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting({ id: row.id, name: row.name })}
                    className="rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    aria-label={t("common.delete", lang)}
                    title={t("common.delete", lang)}
                    data-testid={`tpl-delete-${row.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-sm text-slate-700 dark:text-slate-400 font-medium mb-1">
              {t("marketing.template.empty.title", lang)}
            </div>
            <div className="text-xs text-slate-500">
              {t("marketing.template.empty.subtitle", lang)}
            </div>
          </div>
        )}
      </div>

      {showExamples && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("marketing.template.examples.title", lang)}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t("marketing.template.examples.subtitle", lang)}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {getExampleTemplates(lang).map((ex) => {
              const Icon = EXAMPLE_ICONS[ex.icon] ?? FileText;
              return (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() =>
                    setSeed({
                      name: ex.name,
                      channel: ex.channel,
                      subject: ex.subject,
                      body: ex.body,
                      locale: lang,
                    })
                  }
                  className="group flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50/40 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-violet-400/40 dark:hover:bg-violet-500/5"
                  data-testid={`tpl-example-${ex.id}`}
                >
                  <span className="mt-0.5 shrink-0 rounded-md bg-violet-100 p-1.5 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {ex.title}
                      </span>
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        {t("marketing.template.examples.badge", lang)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                      {ex.blurb}
                    </span>
                    <span className="mt-1 inline-block rounded bg-slate-200/60 px-1.5 py-0.5 text-[9px] uppercase text-slate-500 dark:bg-slate-800/60">
                      {ex.channel}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showCreate && scope && (
        <TemplateFormModal
          scope={scope}
          onClose={() => setShowCreate(false)}
          onSaved={() => setShowCreate(false)}
        />
      )}
      {seed && scope && (
        <TemplateFormModal
          scope={scope}
          presetSeed={seed}
          onClose={() => setSeed(null)}
          onSaved={() => setSeed(null)}
        />
      )}
      {editing && scope && (
        <TemplateFormModal
          scope={scope}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        tone="danger"
        title={t("marketing.template.delete.title", lang)}
        description={deleting
          ? t("marketing.template.delete.description", lang).replace("{name}", deleting.name)
          : ""}
        confirmLabel={t("common.delete", lang)}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </MarketingShell>
  );
}
