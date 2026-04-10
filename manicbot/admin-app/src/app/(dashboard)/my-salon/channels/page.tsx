"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { SalonChannelsTab } from "~/components/salon/SalonChannelsTab";
import { api } from "~/trpc/react";

export default function SalonChannelsPage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;

  const profile = api.salon.getSalonProfile.useQuery({ tenantId: effectiveTenantId });

  return (
    <SalonChannelsTab
      tenantId={effectiveTenantId}
      slug={(profile.data as any)?.slug}
      publicActive={(profile.data as any)?.publicActive}
    />
  );
}
