"use client";

import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SalonSettingsEditor } from "~/components/salon/SalonSettingsEditor";
import { AutoConfirmSettings } from "~/components/salon/AutoConfirmSettings";
import { AutoSuggestFavoriteSettings } from "~/components/salon/AutoSuggestFavoriteSettings";
import { SalonCalendarSection } from "~/components/salon/SalonCalendarSection";

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
    <div className="grid gap-4 md:grid-cols-2 items-start">
      {/* Each child renders its own glass-card. Salon settings + AutoConfirm pair
          on md+. AutoSuggestFavorite sits in the next slot. Calendar takes full
          width because its internal layout (sync state + accounts list) is wide. */}
      <div><SalonSettingsEditor tenantId={effectiveTenantId} profile={profile.data} /></div>
      <div><AutoConfirmSettings tenantId={effectiveTenantId} /></div>
      <div><AutoSuggestFavoriteSettings tenantId={effectiveTenantId} /></div>
      <div className="md:col-span-2"><SalonCalendarSection tenantId={effectiveTenantId} /></div>
    </div>
  );
}
