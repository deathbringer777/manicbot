"use client";

import { useRole } from "~/components/RoleContext";

/**
 * Effective tenantId for the messenger.
 *
 * - tenant_owner / tenant_manager / master → their own tenantId
 * - system_admin previewing a tenant      → previewTenantId
 * - system_admin not previewing           → null (no global messenger surface)
 *
 * The page renders a "pick a tenant" hint when this returns null for sysadmin
 * (mirrors how /marketing handles the same case).
 */
export function useMessagesTenantId(): {
  tenantId: string | null;
  isSystemAdminNoPreview: boolean;
} {
  const { role, tenantId, previewRole, previewTenantId } = useRole();

  if (role === "system_admin" && !previewRole) {
    return { tenantId: null, isSystemAdminNoPreview: true };
  }

  const effective =
    role === "system_admin" && previewTenantId ? previewTenantId : tenantId;
  return { tenantId: effective ?? null, isSystemAdminNoPreview: false };
}
