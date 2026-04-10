"use client";
export const runtime = "edge";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { MasterDashboard } from "~/components/dashboards/MasterDashboard";

export default function MasterServicesPage() {
  const router = useRouter();
  const { tenantId, previewTenantId, role, previewRole, previewMasterId, isPersonalTenant } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  const roleQuery = api.auth.getMyRole.useQuery(undefined, { retry: false });
  const masterId = previewMasterId ?? roleQuery.data?.masterId;

  // Gate: services only for personal tenant masters
  useEffect(() => {
    if (!isPersonalTenant && role !== "system_admin") {
      router.replace("/master");
    }
  }, [isPersonalTenant, role, router]);

  if (!effectiveTenantId || !masterId || !isPersonalTenant) return null;
  return <MasterDashboard tenantId={effectiveTenantId} masterId={masterId} isPersonal={true} isDelegating={previewMasterId !== null} forceTab="services" />;
}
