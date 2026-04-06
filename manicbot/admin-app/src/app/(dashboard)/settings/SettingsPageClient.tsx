"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Shell } from "~/components/layout/Shell";
import { useRole } from "~/components/RoleContext";
import { SettingsShell } from "~/components/settings/SettingsShell";
import { AccountSection } from "~/components/settings/sections/AccountSection";
import { AppearanceSection } from "~/components/settings/sections/AppearanceSection";
import { HelpSection } from "~/components/settings/sections/HelpSection";
import { PlatformSection } from "~/components/settings/sections/PlatformSection";
import { BotSection } from "~/components/settings/sections/BotSection";
import { BillingSection } from "~/components/settings/sections/BillingSection";

export default function SettingsPageClient() {
  const { role, previewRole, tenantId, previewTenantId } = useRole();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;

  const searchParams = useSearchParams();
  const router = useRouter();

  const initialSection = searchParams.get("section") ?? "account";
  const [activeSection, setActiveSection] = useState(initialSection);

  const handleSectionChange = (id: string) => {
    setActiveSection(id);
    const url = new URL(window.location.href);
    url.searchParams.set("section", id);
    router.replace(url.pathname + url.search, { scroll: false });
  };

  const renderSection = () => {
    switch (activeSection) {
      case "account":
        return <AccountSection />;
      case "bot":
        return effectiveTenantId ? <BotSection tenantId={effectiveTenantId} /> : null;
      case "billing":
        return effectiveTenantId ? <BillingSection tenantId={effectiveTenantId} /> : null;
      case "appearance":
        return <AppearanceSection />;
      case "help":
        return <HelpSection />;
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
