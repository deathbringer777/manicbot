/**
 * Phase 2 + Permission unification (migration 0068, originally 0063 in PR-A):
 *   Per-(tenant, web-user) permission gates for both `tenant_manager` and
 *   non-personal `master` roles.
 *
 *   - tenant_owner and system_admin bypass all gates.
 *   - tenant_manager is checked against `tenant_member_permissions`.
 *   - master on a PERSONAL tenant bypasses (they own it).
 *   - master on a NON-personal tenant is checked against
 *     `tenant_member_permissions` — same flow as tenant_manager. This is the
 *     PR-A change: salon-invited masters can now be granted scoped admin
 *     permissions (view_peers, create_for_peer, etc.) instead of being
 *     hard-FORBIDDEN.
 *
 *   Sensitive permissions require email-verified elevation to grant (see
 *   routers/tenantStaff.ts `updatePermissions` + `confirmElevation`).
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { tenantMemberPermissions, tenants } from "~/server/db/schema";

export const TENANT_PERMISSION_KEYS = [
  // ── tenant_manager defaults (granted on invite) ─────────────────────────
  "appointments.view",
  "appointments.manage",
  "chat.inbox",
  "clients.view",
  "services.view",
  "masters.view",
  "reviews.view",
  // ── master defaults (granted on master-invite via salon.createMasterAccount) ─
  "appointments.view_own",
  "appointments.manage_own",
  "clients.view_own",
  "earnings.view_own",
  // ── cross-master (NOT default; owner grants explicitly) ────────────────
  "appointments.view_peers",
  "appointments.create_for_peer",
  "clients.view_peers",
  // ── tenant_manager extensions (NOT default) ────────────────────────────
  "analytics.view",
  "reviews.manage",
  "plugins.view",
  // ── Sensitive (require email-verified elevation) ───────────────────────
  "services.manage",
  "masters.manage",
  "branding.manage",
  "billing.manage",
  "settings.manage",
  "staff.manage",
  "earnings.view_peers",
  "plugins.manage",
  "referrals.view_tenant",
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

export const MASTER_DEFAULT: PermissionKey[] = [
  "appointments.view_own",
  "appointments.manage_own",
  "clients.view_own",
  "services.view",
  "earnings.view_own",
];

export const SENSITIVE_PERMISSIONS: PermissionKey[] = [
  "services.manage",
  "masters.manage",
  "branding.manage",
  "billing.manage",
  "settings.manage",
  "staff.manage",
  "earnings.view_peers",
  "plugins.manage",
  "referrals.view_tenant",
];

/**
 * Named permission bundles for fast assignment via the unified Staff UI.
 * Owner can apply a template and then fine-tune individual keys.
 *
 *   - front_desk    — receptionist-style: read all + manage appointments + chat
 *   - manager       — full tenant_manager default + reviews.manage + analytics.view
 *   - stylist_plus  — master defaults + cross-master read perms
 *   - read_only     — every `.view*` key, no `.manage` keys
 */
export const PERMISSION_TEMPLATES: Record<
  "front_desk" | "manager" | "stylist_plus" | "read_only",
  PermissionKey[]
> = {
  front_desk: [
    "appointments.view",
    "appointments.manage",
    "chat.inbox",
    "clients.view",
    "services.view",
    "masters.view",
    "reviews.view",
  ],
  manager: [
    ...TENANT_MANAGER_DEFAULT,
    "analytics.view",
    "reviews.manage",
  ],
  stylist_plus: [
    ...MASTER_DEFAULT,
    "appointments.view_peers",
    "clients.view_peers",
  ],
  read_only: [
    "appointments.view",
    "appointments.view_own",
    "chat.inbox",
    "clients.view",
    "clients.view_own",
    "services.view",
    "masters.view",
    "reviews.view",
    "earnings.view_own",
    "analytics.view",
    "plugins.view",
  ],
};

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

  // Masters: personal tenant bypasses; non-personal falls through to the
  // permission-row check (same path as tenant_manager). This is the PR-A
  // change — previously non-personal masters hit a hard FORBIDDEN.
  if (role === "master" && ctx.webUser.tenantId === tenantId) {
    const [t] = await ctx.db
      .select({ isPersonal: tenants.isPersonal })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (t?.isPersonal) return;
    // Non-personal master → fall through to permission-row check below.
  } else if (role === "master") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Tenant scope mismatch" });
  }

  if (
    (role === "tenant_manager" || role === "master") &&
    ctx.webUser.tenantId === tenantId
  ) {
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
    .filter((p): p is PermissionKey => (TENANT_PERMISSION_KEYS as readonly string[]).includes(p));
}
