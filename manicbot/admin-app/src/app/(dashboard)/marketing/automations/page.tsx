import { redirect } from "next/navigation";
import AutomationsClient from "./AutomationsClient";
import { MARKETING_AUTOMATIONS_ENABLED } from "~/lib/featureFlags";

export const runtime = "edge";

/**
 * Route guard for the PARKED Automations tab. While
 * MARKETING_AUTOMATIONS_ENABLED is false the tab is hidden from the marketing
 * sub-nav (see ~/lib/nav/marketingTabs); this guard also blocks direct URL
 * access, so /marketing/automations can't be reached by bookmark or typed URL.
 *
 * The static AutomationsClient import is intentional: it keeps the (complete,
 * production-ready) client code referenced so it is NOT tree-shaken or flagged
 * as dead code. To unlock, flip the flag — see ~/lib/featureFlags.
 */
export default function AutomationsPage() {
  if (!MARKETING_AUTOMATIONS_ENABLED) redirect("/marketing");
  return <AutomationsClient />;
}
