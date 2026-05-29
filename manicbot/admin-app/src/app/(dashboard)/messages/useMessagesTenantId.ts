"use client";

import { useRole } from "~/components/RoleContext";

/**
 * Effective tenantId for the messenger.
 *
 * - tenant_owner / tenant_manager / master → their own tenantId
 * - system_admin                           → null (no global messenger surface)
 *
 * The page renders a "pick a tenant" hint when this returns null for sysadmin
 * (mirrors how /marketing handles the same case).
 */
export function useMessagesTenantId(): {
  tenantId: string | null;
  isSystemAdminNoPreview: boolean;
} {
  const { role, tenantId } = useRole();

  if (role === "system_admin") {
    return { tenantId: null, isSystemAdminNoPreview: true };
  }

  return { tenantId: tenantId ?? null, isSystemAdminNoPreview: false };
}
