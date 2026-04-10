"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { PublicProfileTab } from "~/components/salon/tabs/PublicProfileTab";

export default function SalonPublicProfilePage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;
  return <PublicProfileTab tenantId={effectiveTenantId} />;
}
