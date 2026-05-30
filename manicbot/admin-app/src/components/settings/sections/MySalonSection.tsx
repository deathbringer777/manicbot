"use client";

import {
  Loader2, Store, Clock, Images, Palette, Globe, CheckCircle2, Star, CalendarDays, ExternalLink,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SettingsHeaderStrip } from "~/components/settings/SettingsHeaderStrip";
import { CollapsibleSection } from "~/components/settings/CollapsibleSection";
import { Pill } from "~/components/ui/Pill";
import { SalonBasicInfoBody } from "~/components/salon/SalonBasicInfoBody";
import { SalonHoursBody } from "~/components/salon/SalonHoursBody";
import { SalonGalleryBody } from "~/components/salon/SalonGalleryBody";
import { SalonBrandingBody } from "~/components/salon/SalonBrandingBody";
import { SalonStorefrontBody } from "~/components/salon/SalonStorefrontBody";
import { AutoConfirmSettings } from "~/components/salon/AutoConfirmSettings";
import { AutoSuggestFavoriteSettings } from "~/components/salon/AutoSuggestFavoriteSettings";
import { SalonCalendarSection } from "~/components/salon/SalonCalendarSection";

/**
 * «Мой салон» — the salon's single OLX-style listing editor. A read-only
 * header strip (name + publish status) sits above a stack of collapsible
 * chips, each an independent sub-editor that saves only its own fields via the
 * all-optional `salon.updateSalonProfile`. Mirrors the «Аккаунт» tab pattern
 * (CollapsibleSection chips) so the whole Settings area feels consistent.
 */
export function MySalonSection() {
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

  const data = profile.data as any;
  const isPublic = !!data?.publicActive;
  const slug = data?.slug as string | null;

  return (
    <div className="space-y-3">
      <SettingsHeaderStrip
        icon={Store}
        title={data?.name || t("salon.salonProfile", lang)}
        subtitle={
          slug ? (
            <a
              href={`/salon/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-brand-500 dark:hover:text-brand-400"
            >
              manicbot.com/salon/{slug}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            t("salon.salonProfile", lang)
          )
        }
        rightSlot={
          <Pill tone={isPublic ? "emerald" : "slate"} variant="soft" size="sm">
            {isPublic ? t("salon.status.public", lang) : t("salon.status.hidden", lang)}
          </Pill>
        }
      />

      <CollapsibleSection
        icon={Store}
        iconClass="text-brand-400"
        title={t("salon.chip.basicInfo", lang)}
        desc={t("salon.chip.basicInfoDesc", lang)}
        defaultOpen
      >
        <SalonBasicInfoBody tenantId={effectiveTenantId} profile={data} />
      </CollapsibleSection>

      <CollapsibleSection
        icon={Clock}
        iconClass="text-sky-400"
        title={t("salon.publicProfile.scheduleSection", lang)}
        desc={t("salon.chip.hoursDesc", lang)}
      >
        <SalonHoursBody tenantId={effectiveTenantId} profile={data} />
      </CollapsibleSection>

      <CollapsibleSection
        icon={Images}
        iconClass="text-violet-400"
        title={t("salon.publicProfile.gallery", lang)}
        desc={t("salon.chip.galleryDesc", lang)}
      >
        <SalonGalleryBody tenantId={effectiveTenantId} profile={data} />
      </CollapsibleSection>

      <CollapsibleSection
        icon={Palette}
        iconClass="text-amber-400"
        title={t("salon.publicProfile.brandingSection", lang)}
        desc={t("salon.chip.brandingDesc", lang)}
      >
        <SalonBrandingBody tenantId={effectiveTenantId} profile={data} />
      </CollapsibleSection>

      <CollapsibleSection
        icon={Globe}
        iconClass="text-emerald-400"
        title={t("salon.chip.storefront", lang)}
        desc={t("salon.chip.storefrontDesc", lang)}
      >
        <SalonStorefrontBody tenantId={effectiveTenantId} profile={data} />
      </CollapsibleSection>

      <CollapsibleSection
        icon={CheckCircle2}
        iconClass="text-emerald-400"
        title={t("salon.autoConfirm.title", lang)}
        desc={t("salon.chip.autoConfirmDesc", lang)}
      >
        <AutoConfirmSettings tenantId={effectiveTenantId} bare />
      </CollapsibleSection>

      <CollapsibleSection
        icon={Star}
        iconClass="text-amber-400"
        title={t("salon.favoriteSuggest.title", lang)}
        desc={t("salon.chip.favoriteDesc", lang)}
      >
        <AutoSuggestFavoriteSettings tenantId={effectiveTenantId} bare />
      </CollapsibleSection>

      <CollapsibleSection
        icon={CalendarDays}
        iconClass="text-brand-400"
        title="Google Calendar"
        desc={t("salon.chip.calendarDesc", lang)}
      >
        <SalonCalendarSection tenantId={effectiveTenantId} bare />
      </CollapsibleSection>
    </div>
  );
}
