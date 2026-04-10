"use client";

import { useRole } from "~/components/RoleContext";
import { ClientsTab } from "~/components/salon/tabs/ClientsTab";

export default function SalonClientsClient() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;
  return <ClientsTab tenantId={effectiveTenantId} />;
}
