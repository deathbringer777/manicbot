"use client";

import { SalonDashboard } from "~/components/dashboards/SalonDashboard";

/** Thin wrapper: delegates to SalonDashboard with forced "public_profile" tab.
 *  Full extraction (own queries + PublicProfileEditor) planned for later iteration. */
export function PublicProfileTab({ tenantId }: { tenantId: string }) {
  return <SalonDashboard tenantId={tenantId} forceTab="public_profile" />;
}
