import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { tenantRoles, tenants } from "~/server/db/schema";
import { env } from "~/env";
import { timingSafeEqualStr } from "~/server/auth/telegram";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

/** tRPC context shape used by salon / channels / conversations routers */
export type TenantAccessCtx = {
  user: { id: number } | null | undefined;
  webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null | undefined;
  db: DbInstance;
};

/**
 * Verify caller is tenant_owner for tenantId, or system admin (preview / platform).
 * Independent masters (web role "master" on a personal tenant) also pass this check.
 * Supports both Telegram user (ctx.user) and web session (ctx.webUser).
 */
export async function assertTenantOwner(ctx: TenantAccessCtx, tenantId: string): Promise<void> {
  // Reject null/empty tenantId — prevents null===null bypass
  if (!tenantId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant ID is required" });
  }

  // Web session path
  if (!ctx.user && ctx.webUser) {
    if (ctx.webUser.webRole === "system_admin") return;
    if (ctx.webUser.webRole === "tenant_owner" && ctx.webUser.tenantId === tenantId) return;
    // Independent master on their own personal tenant gets owner-level access
    if (ctx.webUser.webRole === "master" && ctx.webUser.tenantId === tenantId) {
      const [t] = await ctx.db.select({ isPersonal: tenants.isPersonal }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      if (t?.isPersonal) return;
    }
    throw new TRPCError({ code: "FORBIDDEN", message: "Salon owner access required" });
  }

  // Telegram user path
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (env.ADMIN_CHAT_ID && timingSafeEqualStr(String(ctx.user.id), env.ADMIN_CHAT_ID)) return;
  const row = await ctx.db
    .select()
    .from(tenantRoles)
    .where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.chatId, ctx.user.id)))
    .limit(1);
  if (!row.length || row[0]!.role !== "tenant_owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Salon owner access required" });
  }
}
