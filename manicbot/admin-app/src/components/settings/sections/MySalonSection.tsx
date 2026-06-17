"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Loader2, Store, Clock, Images, Palette, Globe, CheckCircle2, Star, CalendarDays, ExternalLink, FolderOpen, Users, Sparkles, ShieldAlert,
  type LucideIcon,
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
import { MasterSchedulePolicyBody } from "~/components/salon/MasterSchedulePolicyBody";
import { SalonGalleryBody } from "~/components/salon/SalonGalleryBody";
import { SalonBrandingBody } from "~/components/salon/SalonBrandingBody";
import { SalonAlbumsBody } from "~/components/salon/SalonAlbumsBody";
import { SalonStorefrontBody } from "~/components/salon/SalonStorefrontBody";
import { SalonPublishBody } from "~/components/salon/SalonPublishBody";
import { AutoConfirmSettings } from "~/components/salon/AutoConfirmSettings";
import { AutoSuggestFavoriteSettings } from "~/components/salon/AutoSuggestFavoriteSettings";
import { PostVisitFollowupSettings } from "~/components/salon/PostVisitFollowupSettings";
import { NoShowLatePolicySettings } from "~/components/salon/NoShowLatePolicySettings";
import { SalonCalendarSection } from "~/components/salon/SalonCalendarSection";

/**
 * «Мой салон» — the salon's single listing editor. A read-only header strip
 * (name + publish status) sits above a top tab strip of sub-categories
 * (Профиль · Оформление · Публикация · Бронирование · Интеграции). The strip
 * mirrors the client-card tabs (`ClientDetailTabs`); only the active category's
 * cards render below, each an independent sub-editor saving its own fields via
 * the all-optional `salon.updateSalonProfile`.
 *
 * The active category is mirrored to the `?sub=` query param so deep links
 * (e.g. the onboarding "activate public profile" step → `?sub=publishing`) open
 * straight on the right tab. The former standalone «Публичный профиль» tab is
 * folded into the «Публикация» category here via `SalonPublishBody`.
 */

const CATEGORY_IDS = ["profile", "appearance", "publishing", "booking", "integrations"] as const;
type CategoryId = (typeof CATEGORY_IDS)[number];

const CATEGORIES: { id: CategoryId; labelKey: Parameters<typeof t>[0]; icon: LucideIcon }[] = [
  { id: "profile", labelKey: "salon.cat.profile", icon: Store },
  { id: "appearance", labelKey: "salon.cat.appearance", icon: Palette },
  { id: "publishing", labelKey: "salon.cat.publishing", icon: Globe },
  { id: "booking", labelKey: "salon.cat.booking", icon: CheckCircle2 },
  { id: "integrations", labelKey: "salon.cat.integrations", icon: CalendarDays },
];

function isCategoryId(v: string | null): v is CategoryId {
  return v != null && (CATEGORY_IDS as readonly string[]).includes(v);
}

export function MySalonSection() {
  const { tenantId } = useRole();
  const { lang } = useLang();
  const searchParams = useSearchParams();
  const router = useRouter();
  const effectiveTenantId = tenantId;

  const subParam = searchParams.get("sub");
  const [activeCat, setActiveCat] = useState<CategoryId>(isCategoryId(subParam) ? subParam : "profile");

  // Keep the active tab in sync if the `?sub=` param changes while mounted
  // (e.g. an in-app link to a specific category fires without a remount).
  useEffect(() => {
    if (isCategoryId(subParam)) setActiveCat(subParam);
  }, [subParam]);

  const onTabChange = (id: CategoryId) => {
    setActiveCat(id);
    const url = new URL(window.location.href);
    url.searchParams.set("sub", id);
    router.replace(url.pathname + url.search, { scroll: false });
  };

  const profile = api.salon.getSalonProfile.useQuery(
    { tenantId: effectiveTenantId ?? "" },
    { enabled: !!effectiveTenantId },
  );

  if (!effectiveTenantId) {
    return (
      <div className="glass-card rounded-2xl p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("common.noTenant", lang)}</p>
      </div>
    );
  }

  if (profile.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
      </div>
    );
  }

  // Guard null/undefined explicitly (previously masked by an `as any` cast that
  // let undefined flow into child components typed as non-optional SalonProfile).
  if (profile.isError || !profile.data) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center">
        <p className="text-red-400">{t("common.errorLoading", lang)}</p>
      </div>
    );
  }

  const data = profile.data;
  const isPublic = !!data?.publicActive;
  const slug = data?.slug ?? null;

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

      {/* Top sub-category tabs — mirrors the client-card tabs (ClientDetailTabs) */}
      <div
        role="tablist"
        aria-label={t("salon.salonProfile", lang)}
        className="flex gap-1 border-b border-slate-200 dark:border-white/10 overflow-x-auto scrollbar-hide"
      >
        {CATEGORIES.map((cat) => {
          const active = activeCat === cat.id;
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(cat.id)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-t ${
                active
                  ? "border-brand-500 text-brand-600 dark:text-brand-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-white/20"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {t(cat.labelKey, lang)}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="space-y-3 pt-1">
        {activeCat === "profile" && (
          <>
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
              defaultOpen
            >
              <SalonHoursBody tenantId={effectiveTenantId} profile={data} />
            </CollapsibleSection>

            <CollapsibleSection
              icon={Users}
              iconClass="text-emerald-400"
              title={t("salon.masterSchedulePolicy.title", lang)}
              desc={t("salon.masterSchedulePolicy.hint", lang)}
            >
              <MasterSchedulePolicyBody tenantId={effectiveTenantId} profile={data} />
            </CollapsibleSection>
          </>
        )}

        {activeCat === "appearance" && (
          <>
            <CollapsibleSection
              icon={Images}
              iconClass="text-violet-400"
              title={t("salon.publicProfile.gallery", lang)}
              desc={t("salon.chip.galleryDesc", lang)}
              defaultOpen
            >
              <SalonGalleryBody tenantId={effectiveTenantId} profile={data} />
            </CollapsibleSection>

            <CollapsibleSection
              icon={Palette}
              iconClass="text-amber-400"
              title={t("salon.publicProfile.brandingSection", lang)}
              desc={t("salon.chip.brandingDesc", lang)}
              defaultOpen
            >
              <SalonBrandingBody tenantId={effectiveTenantId} profile={data} />
            </CollapsibleSection>

            <CollapsibleSection
              icon={FolderOpen}
              iconClass="text-sky-400"
              title={t("salon.albums.title", lang)}
              desc={t("salon.albums.desc", lang)}
            >
              <SalonAlbumsBody tenantId={effectiveTenantId} />
            </CollapsibleSection>
          </>
        )}

        {activeCat === "publishing" && (
          <>
            <SalonPublishBody tenantId={effectiveTenantId} profile={data} onEditFields={onTabChange} />

            <CollapsibleSection
              icon={Globe}
              iconClass="text-emerald-400"
              title={t("salon.chip.storefront", lang)}
              desc={t("salon.chip.storefrontDesc", lang)}
              defaultOpen
            >
              <SalonStorefrontBody tenantId={effectiveTenantId} profile={data} />
            </CollapsibleSection>
          </>
        )}

        {activeCat === "booking" && (
          <>
            <CollapsibleSection
              icon={CheckCircle2}
              iconClass="text-emerald-400"
              title={t("salon.autoConfirm.title", lang)}
              desc={t("salon.chip.autoConfirmDesc", lang)}
              defaultOpen
            >
              <AutoConfirmSettings tenantId={effectiveTenantId} bare />
            </CollapsibleSection>

            <CollapsibleSection
              icon={Star}
              iconClass="text-amber-400"
              title={t("salon.favoriteSuggest.title", lang)}
              desc={t("salon.chip.favoriteDesc", lang)}
              defaultOpen
            >
              <AutoSuggestFavoriteSettings tenantId={effectiveTenantId} bare />
            </CollapsibleSection>

            <CollapsibleSection
              icon={Sparkles}
              iconClass="text-violet-400"
              title={t("salon.postVisitFollowup.title", lang)}
              desc={t("salon.postVisitFollowup.desc", lang)}
            >
              <PostVisitFollowupSettings tenantId={effectiveTenantId} bare />
            </CollapsibleSection>

            <CollapsibleSection
              icon={ShieldAlert}
              iconClass="text-orange-400"
              title={t("salon.noShowPolicy.title", lang)}
              desc={t("salon.noShowPolicy.desc", lang)}
            >
              <NoShowLatePolicySettings tenantId={effectiveTenantId} bare />
            </CollapsibleSection>
          </>
        )}

        {activeCat === "integrations" && (
          <CollapsibleSection
            icon={CalendarDays}
            iconClass="text-brand-400"
            title="Google Calendar"
            desc={t("salon.chip.calendarDesc", lang)}
            defaultOpen
          >
            <SalonCalendarSection tenantId={effectiveTenantId} bare />
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}
