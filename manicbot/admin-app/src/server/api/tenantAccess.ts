import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { tenants } from "~/server/db/schema";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

/** tRPC context shape used by salon / channels / conversations routers */
export type TenantAccessCtx = {
  webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null | undefined;
  db: DbInstance;
};

/**
 * Verify caller is tenant_owner for tenantId, or system admin.
 * Independent masters (web role "master" on a personal tenant) also pass this check.
 */
export async function assertTenantOwner(ctx: TenantAccessCtx, tenantId: string): Promise<void> {
  // Reject null/empty tenantId — prevents null===null bypass
  if (!tenantId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant ID is required" });
  }

  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (ctx.webUser.webRole === "system_admin") return;
  if (ctx.webUser.webRole === "tenant_owner" && ctx.webUser.tenantId === tenantId) return;
  // Independent master on their own personal tenant gets owner-level access
  if (ctx.webUser.webRole === "master" && ctx.webUser.tenantId === tenantId) {
    const [t] = await ctx.db.select({ isPersonal: tenants.isPersonal }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (t?.isPersonal) return;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Salon owner access required" });
}

/**
 * Verify caller is a tenant member (owner OR tenant_manager) for tenantId, or system_admin.
 * Use this where read access is shared across roles; write access is then gated per-permission
 * via assertPermission().
 */
export async function assertTenantMember(ctx: TenantAccessCtx, tenantId: string): Promise<void> {
  if (!tenantId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant ID is required" });
  }
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (ctx.webUser.webRole === "system_admin") return;
  if (ctx.webUser.tenantId !== tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Tenant scope mismatch" });
  }
  const role = ctx.webUser.webRole;
  if (role === "tenant_owner" || role === "tenant_manager") return;
  if (role === "master") {
    const [t] = await ctx.db.select({ isPersonal: tenants.isPersonal }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (t?.isPersonal) return;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Tenant member access required" });
}
