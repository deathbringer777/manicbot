"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { MastersTab } from "~/components/salon/tabs/MastersTab";

export default function SalonMastersPage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;
  return <MastersTab tenantId={effectiveTenantId} />;
}
