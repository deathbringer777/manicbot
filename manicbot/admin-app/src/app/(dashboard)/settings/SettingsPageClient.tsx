"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Shell } from "~/components/layout/Shell";
import { useRole } from "~/components/RoleContext";
import { SettingsShell, getDefaultSettingsSection } from "~/components/settings/SettingsShell";
import { AccountSection } from "~/components/settings/sections/AccountSection";
import { AppearanceSection } from "~/components/settings/sections/AppearanceSection";
import { HelpSection } from "~/components/settings/sections/HelpSection";
import { PlatformSection } from "~/components/settings/sections/PlatformSection";
import { BillingSection } from "~/components/settings/sections/BillingSection";
import { ReferralsSection } from "~/components/settings/sections/ReferralsSection";
import { PluginSettingsSection } from "~/components/settings/PluginSettingsSection";
import { MySalonSection } from "~/components/settings/sections/MySalonSection";
import { PublicProfileSection } from "~/components/settings/sections/PublicProfileSection";
import { TeamSection } from "~/components/settings/sections/TeamSection";
import { ChannelsSection } from "~/components/settings/sections/ChannelsSection";
import { MasterProfileSection } from "~/components/settings/sections/MasterProfileSection";
import { NotificationsSection } from "~/components/settings/sections/NotificationsSection";

export default function SettingsPageClient() {
  const { role, previewRole, tenantId, previewTenantId } = useRole();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;

  const searchParams = useSearchParams();
  const router = useRouter();

  const paramSection = searchParams.get("section");
  const [activeSection, setActiveSection] = useState(paramSection ?? "account");
  const [userNavigated, setUserNavigated] = useState(false);

  // Role-aware landing tab. `role` from useRole() hydrates after first paint,
  // so the default can't be chosen in the useState initializer. Once the role
  // is known — and only if the URL didn't pin a ?section= and the user hasn't
  // navigated yet — flip the still-default "account" to the role's landing tab
  // (salon for owner/manager, profile for master). Technical roles already
  // land on "account", so this is a no-op for them.
  useEffect(() => {
    if (paramSection || userNavigated || !effectiveRole) return;
    const landing = getDefaultSettingsSection(effectiveRole);
    setActiveSection((cur) => (cur === "account" ? landing : cur));
  }, [effectiveRole, paramSection, userNavigated]);

  const handleSectionChange = (id: string) => {
    setUserNavigated(true);
    setActiveSection(id);
    const url = new URL(window.location.href);
    url.searchParams.set("section", id);
    router.replace(url.pathname + url.search, { scroll: false });
  };

  const renderSection = () => {
    if (activeSection.startsWith("plugin:")) {
      const slug = activeSection.slice("plugin:".length);
      if (/^[a-z][a-z0-9-]{2,40}$/.test(slug)) {
        return <PluginSettingsSection slug={slug} />;
      }
    }
    switch (activeSection) {
      case "account":
        return <AccountSection />;
      case "salon":
        return <MySalonSection />;
      case "public":
        return <PublicProfileSection />;
      case "team":
        return <TeamSection />;
      case "channels":
        return <ChannelsSection />;
      case "billing":
        return effectiveTenantId ? <BillingSection tenantId={effectiveTenantId} /> : null;
      case "referrals":
        return <ReferralsSection />;
      case "notifications":
        return <NotificationsSection />;
      case "appearance":
        return <AppearanceSection />;
      case "help":
        return <HelpSection />;
      case "profile":
        return effectiveRole === "master" ? <MasterProfileSection /> : <AccountSection />;
      case "platform":
        return role === "system_admin" ? <PlatformSection /> : null;
      default:
        return <AccountSection />;
    }
  };

  return (
    <Shell>
      <SettingsShell activeSection={activeSection} onSectionChange={handleSectionChange}>
        {renderSection()}
      </SettingsShell>
    </Shell>
  );
}
