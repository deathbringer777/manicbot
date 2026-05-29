"use client";

import { useRole } from "~/components/RoleContext";

/**
 * Picks which marketing router to use based on the current role.
 *
 * - `mode: "admin"` — system_admin. Calls `api.marketing.*` (God Mode
 *   global view; unscoped data).
 * - `mode: "tenant"` — tenant_owner / tenant_manager / personal master.
 *   Calls `api.marketingTenant.*` with their tenantId. All queries filter
 *   by `tenant_id = ?`.
 *
 * Each consumer should call BOTH api hooks with `enabled` flags derived from
 * the returned `mode`, then pick the active one. This satisfies React's
 * rules-of-hooks while letting the same component serve both surfaces.
 */
export function useMarketingScope(): { mode: "admin" | "tenant"; tenantId: string | null } {
  const { role, tenantId } = useRole();

  // System admin → unscoped God Mode view (no per-tenant impersonation).
  if (role === "system_admin") {
    return { mode: "admin", tenantId: null };
  }

  // tenant_owner / tenant_manager / master → their own tenant-scoped view.
  return { mode: "tenant", tenantId: tenantId ?? null };
}
