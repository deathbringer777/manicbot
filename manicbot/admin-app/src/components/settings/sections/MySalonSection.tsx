"use client";

import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SalonSettingsEditor } from "~/components/salon/SalonSettingsEditor";
import { AutoConfirmSettings } from "~/components/salon/AutoConfirmSettings";

export function MySalonSection() {
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

  const profile = api.salon.getSalonProfile.useQuery({ tenantId: effectiveTenantId });

  if (profile.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center">
        <p className="text-red-400">{t("common.errorLoading", lang)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SalonSettingsEditor tenantId={effectiveTenantId} profile={profile.data} />
      <AutoConfirmSettings tenantId={effectiveTenantId} />
    </div>
  );
}
