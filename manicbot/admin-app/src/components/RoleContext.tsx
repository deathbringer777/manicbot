"use client";

import { createContext, useContext } from "react";
import type { AppRole } from "~/server/api/routers/auth";
import type { PermissionKey } from "~/server/api/permissions";

export interface RoleContextValue {
  role: AppRole;
  tenantId: string | null;
  tenantName: string | null;
  userId: number | null;
  createdAt: number | null;
  emailVerified: boolean;
  hasPassword: boolean;
  isPersonalTenant?: boolean;
  isTest?: boolean;
  /** Only populated when role === "tenant_manager". */
  permissions: PermissionKey[];
  // Creator-only preview
  previewRole: AppRole;
  previewTenantId: string | null;
  setPreviewRole: (role: AppRole, tenantId?: string | null) => void;
  // Master impersonation (tenant_owner viewing a master; also system_admin 3rd step)
  previewMasterId: number | null;
  setPreviewMaster: (masterId: number | null) => void;
}

export const RoleContext = createContext<RoleContextValue>({
  role: null,
  tenantId: null,
  tenantName: null,
  userId: null,
  createdAt: null,
  emailVerified: true,
  hasPassword: true,
  isPersonalTenant: false,
  isTest: false,
  permissions: [],
  previewRole: null,
  previewTenantId: null,
  setPreviewRole: () => {},
  previewMasterId: null,
  setPreviewMaster: () => {},
});

export function useRole() {
  return useContext(RoleContext);
}

/**
 * Convenience hook: true if the current user has the named permission.
 * tenant_owner and system_admin always return true. Masters on their personal
 * tenant always return true.
 */
export function useHasPermission(permission: PermissionKey): boolean {
  const { role, permissions, isPersonalTenant } = useRole();
  if (role === "system_admin" || role === "tenant_owner") return true;
  if (role === "master" && isPersonalTenant) return true;
  if (role === "tenant_manager") return permissions.includes(permission);
  return false;
}
