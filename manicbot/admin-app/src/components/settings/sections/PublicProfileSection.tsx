"use client";

import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { PublicProfileEditor } from "~/components/salon/PublicProfileEditor";

export function PublicProfileSection() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const { lang } = useLang();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;

  if (!effectiveTenantId) {
    return (
      <div className="glass-card rounded-2xl p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("common.noTenant", lang)}</p>
      </div>
    );
  }

  // PublicProfileEditor renders its own glass-card tree internally. Keep the
  // settings outer grid for consistency with sibling sections — the editor
  // simply spans the full width (col-span-2 on md+).
  return (
    <div className="grid gap-4 md:grid-cols-2 items-start">
      <div className="md:col-span-2">
        <PublicProfileEditor tenantId={effectiveTenantId} />
      </div>
    </div>
  );
}
