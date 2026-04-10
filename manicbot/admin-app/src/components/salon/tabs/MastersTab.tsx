"use client";

import { SalonDashboard } from "~/components/dashboards/SalonDashboard";

/** Thin wrapper: delegates to SalonDashboard with forced "masters" tab.
 *  Full extraction (own queries + AddMasterModal) planned for later iteration. */
export function MastersTab({ tenantId }: { tenantId: string }) {
  return <SalonDashboard tenantId={tenantId} forceTab="masters" />;
}
