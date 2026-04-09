import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { platformRoles, tenantRoles, webUsers, masters, tenants } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { env } from "~/env";

export type AppRole =
  | "system_admin"
  | "support"
  | "technical_support"
  | "tenant_owner"
  | "master"
  | null;

type RoleResult = {
  role: AppRole;
  tenantId: string | null;
  masterId: number | null;
  isPersonalTenant: boolean;
  createdAt: number | null;
  emailVerified: boolean;
  email: string | null;
};

const EMPTY: RoleResult = {
  role: null,
  tenantId: null,
  masterId: null,
  isPersonalTenant: false,
  createdAt: null,
  emailVerified: true,
  email: null,
};

export const authRouter = createTRPCRouter({
  getMyRole: publicProcedure.query(async ({ ctx }): Promise<RoleResult> => {
    // Web session path (email/password login)
    if (!ctx.user && ctx.webUser) {
      const role = ctx.webUser.webRole as AppRole;
      const tenantId = ctx.webUser.tenantId ?? null;
      const email = ctx.webUser.email ?? null;
      // Fetch createdAt + emailVerified for UI
      let createdAt: number | null = null;
      let emailVerified = true;
      try {
        const rows = await ctx.db
          .select({ createdAt: webUsers.createdAt, emailVerified: webUsers.emailVerified })
          .from(webUsers)
          .where(eq(webUsers.id, ctx.webUser.id))
          .limit(1);
        createdAt = rows[0]?.createdAt ?? null;
        emailVerified = !!(rows[0]?.emailVerified);
      } catch { /* non-critical */ }

      // For web masters: look up their masterId and check if personal tenant
      let masterId: number | null = null;
      let isPersonalTenant = false;
      if (role === "master" && tenantId) {
        try {
          const [masterRow] = await ctx.db
            .select({ chatId: masters.chatId })
            .from(masters)
            .where(and(eq(masters.tenantId, tenantId), eq(masters.active, 1)))
            .limit(1);
          if (masterRow) masterId = masterRow.chatId;
          const [tenantRow] = await ctx.db
            .select({ isPersonal: tenants.isPersonal })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
          if (tenantRow?.isPersonal) isPersonalTenant = true;
        } catch { /* non-critical */ }
      }

      return { role, tenantId, masterId, isPersonalTenant, createdAt, emailVerified, email };
    }

    if (!ctx.user) return EMPTY;

    const userId = ctx.user.id;

    // Creator fallback (ADMIN_CHAT_ID secret)
    if (env.ADMIN_CHAT_ID && String(userId) === env.ADMIN_CHAT_ID) {
      return { ...EMPTY, role: "system_admin" };
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
          return { ...EMPTY, role: "system_admin" };
        }
        // Ignore illegitimate DB rows for non-creator.
      } else if (role === "support" || role === "technical_support") {
        return { ...EMPTY, role };
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
        return { ...EMPTY, role, tenantId, masterId: role === "master" ? userId : null };
      }
    }

    return EMPTY;
  }),
});
