"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { BillingTab } from "~/components/salon/tabs/BillingTab";

export default function SalonBillingPage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;
  return <BillingTab tenantId={effectiveTenantId} />;
}
