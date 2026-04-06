"use client";

import { createContext, useContext } from "react";
import type { AppRole } from "~/server/api/routers/auth";

interface RoleContextValue {
  role: AppRole;
  tenantId: string | null;
  userId: number | null;
  createdAt: number | null;
  // Creator-only preview
  previewRole: AppRole;
  previewTenantId: string | null;
  setPreviewRole: (role: AppRole, tenantId?: string | null) => void;
}

export const RoleContext = createContext<RoleContextValue>({
  role: null,
  tenantId: null,
  userId: null,
  createdAt: null,
  previewRole: null,
  previewTenantId: null,
  setPreviewRole: () => {},
});

export function useRole() {
  return useContext(RoleContext);
}
