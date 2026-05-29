"use client";

import { createContext, useContext } from "react";
import type { AppRole } from "~/server/api/routers/auth";
import type { PermissionKey } from "~/server/api/permissions";

export interface RoleContextValue {
  role: AppRole;
  tenantId: string | null;
  tenantName: string | null;
  /** Salon-uploaded logo URL. Drives the brand tile in the sidebar/header. */
  tenantLogo: string | null;
  /** Per-master avatar photo URL (origin `masters.avatar_url`, 0075). */
  masterAvatarUrl: string | null;
  /** Per-master single-emoji avatar (origin `masters.avatar_emoji`, 0075). */
  masterAvatarEmoji: string | null;
  /** Telegram chat id. Always null in the web admin app — kept for legacy mini-app callers. */
  userId: number | null;
  /**
   * Internal `web_users.id` of the authenticated user (TEXT primary key).
   * Drives per-profile scoping for localStorage caches (plugin pins,
   * dashboard prefs). Null only while the auth query is in flight or for
   * unauthenticated views.
   */
  webUserId: string | null;
  createdAt: number | null;
  emailVerified: boolean;
  hasPassword: boolean;
  isPersonalTenant?: boolean;
  isTest?: boolean;
  /** Only populated when role === "tenant_manager". */
  permissions: PermissionKey[];
  // Billing state (effective, post lazy-flip). Null/false for platform staff.
  billingStatus: string | null;
  isTrialExpired: boolean;
}

export const RoleContext = createContext<RoleContextValue>({
  role: null,
  tenantId: null,
  tenantName: null,
  tenantLogo: null,
  masterAvatarUrl: null,
  masterAvatarEmoji: null,
  userId: null,
  webUserId: null,
  createdAt: null,
  emailVerified: true,
  hasPassword: true,
  isPersonalTenant: false,
  isTest: false,
  permissions: [],
  billingStatus: null,
  isTrialExpired: false,
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
