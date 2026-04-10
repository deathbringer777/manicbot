"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { ServicesTab } from "~/components/salon/tabs/ServicesTab";

export default function SalonServicesPage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;
  return <ServicesTab tenantId={effectiveTenantId} />;
}
