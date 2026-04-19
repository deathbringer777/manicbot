/**
 * Phase 2: per-(tenant, web-user) permission gates for the `tenant_manager` role.
 *
 * tenant_owner and system_admin bypass all gates. tenant_manager is checked
 * against `tenant_member_permissions`. master is allowed only for read-level
 * permissions on their personal tenant (same scoping rule as before).
 *
 * Sensitive permissions require email-verified elevation to grant (see
 * routers/tenantStaff.ts `updatePermissions` + `confirmElevation`).
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { tenantMemberPermissions, tenants } from "~/server/db/schema";

export const TENANT_PERMISSION_KEYS = [
  // Default (granted on invite)
  "appointments.view",
  "appointments.manage",
  "chat.inbox",
  "clients.view",
  "services.view",
  "masters.view",
  "reviews.view",
  // Sensitive (require email-verified elevation)
  "services.manage",
  "masters.manage",
  "branding.manage",
  "billing.manage",
  "settings.manage",
  "staff.manage",
] as const;

export type PermissionKey = (typeof TENANT_PERMISSION_KEYS)[number];

export const TENANT_MANAGER_DEFAULT: PermissionKey[] = [
  "appointments.view",
  "appointments.manage",
  "chat.inbox",
  "clients.view",
  "services.view",
  "masters.view",
  "reviews.view",
];

export const SENSITIVE_PERMISSIONS: PermissionKey[] = [
  "services.manage",
  "masters.manage",
  "branding.manage",
  "billing.manage",
  "settings.manage",
  "staff.manage",
];

export function isSensitive(p: PermissionKey): boolean {
  return SENSITIVE_PERMISSIONS.includes(p);
}

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;
type Ctx = {
  webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null | undefined;
  db: DbInstance;
};

/**
 * Throws FORBIDDEN when the caller lacks the named permission on `tenantId`.
 * Passes silently for tenant_owner / system_admin / masters on personal tenants.
 */
export async function assertPermission(
  ctx: Ctx,
  tenantId: string,
  permission: PermissionKey,
): Promise<void> {
  if (!tenantId) throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant ID is required" });
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });

  const role = ctx.webUser.webRole;
  if (role === "system_admin") return;
  if (role === "tenant_owner" && ctx.webUser.tenantId === tenantId) return;

  // Masters on their personal tenant bypass (they own it)
  if (role === "master" && ctx.webUser.tenantId === tenantId) {
    const [t] = await ctx.db
      .select({ isPersonal: tenants.isPersonal })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (t?.isPersonal) return;
    throw new TRPCError({ code: "FORBIDDEN", message: "Master has no permission on this tenant" });
  }

  if (role === "tenant_manager" && ctx.webUser.tenantId === tenantId) {
    const rows = await ctx.db
      .select({ permission: tenantMemberPermissions.permission })
      .from(tenantMemberPermissions)
      .where(
        and(
          eq(tenantMemberPermissions.tenantId, tenantId),
          eq(tenantMemberPermissions.webUserId, ctx.webUser.id),
          eq(tenantMemberPermissions.permission, permission),
        ),
      )
      .limit(1);
    if (rows.length > 0) return;
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Missing permission: ${permission}. Request owner approval.`,
    });
  }

  throw new TRPCError({ code: "FORBIDDEN", message: "Tenant scope mismatch" });
}

/** List all permissions granted to `webUserId` on `tenantId`. */
export async function listPermissions(
  ctx: Ctx,
  tenantId: string,
  webUserId: string,
): Promise<PermissionKey[]> {
  if (!ctx.db) return [];
  const rows = await ctx.db
    .select({ permission: tenantMemberPermissions.permission })
    .from(tenantMemberPermissions)
    .where(
      and(
        eq(tenantMemberPermissions.tenantId, tenantId),
        eq(tenantMemberPermissions.webUserId, webUserId),
      ),
    );
  return rows
    .map((r) => r.permission as PermissionKey)
    .filter((p): p is PermissionKey => TENANT_PERMISSION_KEYS.includes(p));
}
