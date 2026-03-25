"use client";

import { createContext, useContext } from "react";
import type { AppRole } from "~/server/api/routers/auth";

interface RoleContextValue {
  role: AppRole;
  tenantId: string | null;
  userId: number | null;
}

export const RoleContext = createContext<RoleContextValue>({
  role: null,
  tenantId: null,
  userId: null,
});

export function useRole() {
  return useContext(RoleContext);
}
