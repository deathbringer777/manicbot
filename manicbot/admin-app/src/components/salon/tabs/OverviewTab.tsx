"use client";

import { SalonDashboard } from "~/components/dashboards/SalonDashboard";

/** Thin wrapper: delegates to SalonDashboard with forced "overview" tab.
 *  Full extraction (own queries + StatCards) planned for later iteration. */
export function OverviewTab({ tenantId }: { tenantId: string }) {
  return <SalonDashboard tenantId={tenantId} forceTab="overview" />;
}
