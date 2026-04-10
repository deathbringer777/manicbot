"use client";

import { SalonDashboard } from "~/components/dashboards/SalonDashboard";

/** Thin wrapper: delegates to SalonDashboard with forced "services" tab.
 *  Full extraction (own queries + ServiceModal) planned for later iteration. */
export function ServicesTab({ tenantId }: { tenantId: string }) {
  return <SalonDashboard tenantId={tenantId} forceTab="services" />;
}
