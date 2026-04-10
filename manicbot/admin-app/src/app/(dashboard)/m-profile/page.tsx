"use client";
export const runtime = "edge";

import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { MasterDashboard } from "~/components/dashboards/MasterDashboard";

export default function MasterProfilePage() {
  const { tenantId, previewTenantId, role, previewRole, previewMasterId, isPersonalTenant } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  const roleQuery = api.auth.getMyRole.useQuery(undefined, { retry: false });
  const masterId = previewMasterId ?? roleQuery.data?.masterId;
  if (!effectiveTenantId || !masterId) return null;
  return <MasterDashboard tenantId={effectiveTenantId} masterId={masterId} isPersonal={isPersonalTenant} isDelegating={previewMasterId !== null} forceTab="profile" />;
}
