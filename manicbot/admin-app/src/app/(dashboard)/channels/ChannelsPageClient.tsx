"use client";

import { Shell } from "~/components/layout/Shell";
import { useRole } from "~/components/RoleContext";
import { BotSection } from "~/components/settings/sections/BotSection";
import { Radio } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

export default function ChannelsPageClient() {
  const { lang } = useLang();
  const { role, previewRole, tenantId, previewTenantId } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;

  return (
    <Shell>
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("gmChannels.title", lang)}</h1>

        {effectiveTenantId ? (
          <BotSection tenantId={effectiveTenantId} />
        ) : (
          <div className="glass-card rounded-2xl p-6 text-center space-y-3">
            <Radio className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("gmChannels.pickTenant", lang)}
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}
