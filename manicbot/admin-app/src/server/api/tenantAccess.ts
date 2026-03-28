import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { platformRoles, tenantRoles } from "~/server/db/schema";
import { env } from "~/env";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

/** tRPC context shape used by salon / channels / conversations routers */
export type TenantAccessCtx = {
  user: { id: number } | null | undefined;
  db: DbInstance;
};

/**
 * Verify caller is tenant_owner for tenantId, or system admin (preview / platform).
 */
export async function assertTenantOwner(ctx: TenantAccessCtx, tenantId: string): Promise<void> {
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
