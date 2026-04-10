"use client";
export const runtime = "edge";

import { useRole } from "~/components/RoleContext";
import { ReviewsTab } from "~/components/salon/tabs/ReviewsTab";

export default function SalonReviewsPage() {
  const { tenantId, previewTenantId, role, previewRole } = useRole();
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;
  if (!effectiveTenantId) return null;
  return <ReviewsTab tenantId={effectiveTenantId} />;
}
