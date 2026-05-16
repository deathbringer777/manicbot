"use client";

import { useRole } from "~/components/RoleContext";

/**
 * Picks which marketing router to use based on the current role/preview state.
 *
 * - `mode: "admin"` — system_admin not currently previewing any tenant.
 *   Calls `api.marketing.*` (God Mode global view; unscoped data).
 * - `mode: "tenant"` — tenant_owner / tenant_manager / personal master,
 *   or system_admin previewing a tenant. Calls `api.marketingTenant.*`
 *   with the effective tenantId. All queries filter by `tenant_id = ?`.
 *
 * Each consumer should call BOTH api hooks with `enabled` flags derived from
 * the returned `mode`, then pick the active one. This satisfies React's
 * rules-of-hooks while letting the same component serve both surfaces.
 */
export function useMarketingScope(): { mode: "admin" | "tenant"; tenantId: string | null } {
  const { role, tenantId, previewRole, previewTenantId } = useRole();

  // System admin with no preview → unscoped God Mode view.
  if (role === "system_admin" && !previewRole) {
    return { mode: "admin", tenantId: null };
  }

  // Anyone else (or sysadmin previewing) → tenant-scoped view.
  // For sysadmin preview, `previewTenantId` is the chosen tenant.
  // For tenant_owner / tenant_manager / master, their own `tenantId`.
  const effective =
    role === "system_admin" && previewTenantId ? previewTenantId : tenantId;
  return { mode: "tenant", tenantId: effective ?? null };
}
