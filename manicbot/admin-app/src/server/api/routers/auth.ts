import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { platformRoles, tenantRoles } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { env } from "~/env";

export type AppRole =
  | "system_admin"
  | "support"
  | "technical_support"
  | "tenant_owner"
  | "master"
  | null;

export const authRouter = createTRPCRouter({
  getMyRole: publicProcedure.query(async ({ ctx }) => {
    // Web session path (email/password login)
    if (!ctx.user && ctx.webUser) {
      const role = ctx.webUser.webRole as AppRole;
      const tenantId = ctx.webUser.tenantId ?? null;
      return { role, tenantId };
    }

    if (!ctx.user) {
      return { role: null as AppRole, tenantId: null };
    }

    const userId = ctx.user.id;

    // Creator fallback (ADMIN_CHAT_ID secret)
    if (env.ADMIN_CHAT_ID && String(userId) === env.ADMIN_CHAT_ID) {
      return { role: "system_admin" as AppRole, tenantId: null };
    }

    // Check platform roles
    const platformRow = await ctx.db
      .select()
      .from(platformRoles)
      .where(eq(platformRoles.chatId, userId))
      .limit(1);

    if (platformRow.length > 0) {
      const role = platformRow[0]!.role as AppRole;
      if (role === "system_admin") {
        if (env.ADMIN_CHAT_ID && String(userId) === env.ADMIN_CHAT_ID) {
          return { role: "system_admin" as AppRole, tenantId: null };
        }
        // Ignore illegitimate DB rows for non-creator.
      } else if (role === "support" || role === "technical_support") {
        return { role, tenantId: null };
      }
    }

    // Check tenant roles
    const tenantRow = await ctx.db
      .select()
      .from(tenantRoles)
      .where(eq(tenantRoles.chatId, userId))
      .limit(1);

    if (tenantRow.length > 0) {
      const role = tenantRow[0]!.role as AppRole;
      const tenantId = tenantRow[0]!.tenantId;
      if (role === "tenant_owner" || role === "master") {
        return { role, tenantId };
      }
    }

    return { role: null as AppRole, tenantId: null };
  }),
});
