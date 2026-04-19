"use client";

import { createContext, useContext } from "react";
import type { AppRole } from "~/server/api/routers/auth";

interface RoleContextValue {
  role: AppRole;
  tenantId: string | null;
  tenantName: string | null;
  userId: number | null;
  createdAt: number | null;
  emailVerified: boolean;
  hasPassword: boolean;
  isPersonalTenant?: boolean;
  isTest?: boolean;
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
  previewRole: null,
  previewTenantId: null,
  setPreviewRole: () => {},
  previewMasterId: null,
  setPreviewMaster: () => {},
});

export function useRole() {
  return useContext(RoleContext);
}
