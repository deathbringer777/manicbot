"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { AnalyticsTab } from "~/components/salon/AnalyticsTab";
import { api } from "~/trpc/react";

export default function SalonAnalyticsPage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;

  const botStatus = api.salon.getBotStatus.useQuery({ tenantId: effectiveTenantId });
  const profile = api.salon.getSalonProfile.useQuery({ tenantId: effectiveTenantId });

  return (
    <AnalyticsTab
      tenantId={effectiveTenantId}
      botUsername={(botStatus.data as any)?.botUsername}
      slug={(profile.data as any)?.slug}
    />
  );
}
