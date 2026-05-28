"use client";

import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SalonChannelsTab } from "~/components/salon/SalonChannelsTab";

export function ChannelsSection() {
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

  return <SalonChannelsTab tenantId={effectiveTenantId} />;
}
