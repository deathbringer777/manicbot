"use client";

import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { ReviewsTab } from "~/components/salon/tabs/ReviewsTab";

export function ReviewsSection() {
  const { tenantId } = useRole();
  const { lang } = useLang();
  const effectiveTenantId = tenantId;

  if (!effectiveTenantId) {
    return (
      <div className="glass-card rounded-2xl p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("common.noTenant", lang)}</p>
      </div>
    );
  }

  return <ReviewsTab tenantId={effectiveTenantId} />;
}
