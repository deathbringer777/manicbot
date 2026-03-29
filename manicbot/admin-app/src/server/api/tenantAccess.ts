import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { platformRoles, tenantRoles } from "~/server/db/schema";
import { env } from "~/env";
import { isAdminProcedurePlatformRole } from "~/server/api/platformRoles";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

/** tRPC context shape used by salon / channels / conversations routers */
export type TenantAccessCtx = {
  user: { id: number } | null | undefined;
  webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null | undefined;
  db: DbInstance;
};

/**
 * Verify caller is tenant_owner for tenantId, or system admin (preview / platform).
 * Supports both Telegram user (ctx.user) and web session (ctx.webUser).
 */
export async function assertTenantOwner(ctx: TenantAccessCtx, tenantId: string): Promise<void> {
  // Web session path
  if (!ctx.user && ctx.webUser) {
    // system_admin / support / technical_support → full access
    if (isAdminProcedurePlatformRole(ctx.webUser.webRole)) return;
    // tenant_owner → check if they own THIS tenant
    if (ctx.webUser.webRole === "tenant_owner" && ctx.webUser.tenantId === tenantId) return;
    throw new TRPCError({ code: "FORBIDDEN", message: "Salon owner access required" });
  }

  // Telegram user path
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (env.ADMIN_CHAT_ID && String(ctx.user.id) === env.ADMIN_CHAT_ID) return;
  const platformRow = await ctx.db.select().from(platformRoles).where(eq(platformRoles.chatId, ctx.user.id)).limit(1);
  if (platformRow.length && platformRow[0]!.role === "system_admin") return;
  const row = await ctx.db
    .select()
    .from(tenantRoles)
    .where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.chatId, ctx.user.id)))
    .limit(1);
  if (!row.length || row[0]!.role !== "tenant_owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Salon owner access required" });
  }
}
