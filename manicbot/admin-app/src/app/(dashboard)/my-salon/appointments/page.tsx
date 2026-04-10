"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { AppointmentsTab } from "~/components/salon/tabs/AppointmentsTab";

export default function SalonAppointmentsPage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;
  return <AppointmentsTab tenantId={effectiveTenantId} />;
}
