"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { OverviewTab } from "~/components/salon/tabs/OverviewTab";

export default function SalonOverviewPage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;
  return <OverviewTab tenantId={effectiveTenantId} />;
}
