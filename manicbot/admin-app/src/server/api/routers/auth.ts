import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { webUsers, masters, tenants } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";

export type AppRole =
  | "system_admin"
  | "support"
  | "technical_support"
  | "tenant_owner"
  | "tenant_manager"
  | "master"
  | null;

type RoleResult = {
  role: AppRole;
  tenantId: string | null;
  tenantName: string | null;
  masterId: number | null;
  isPersonalTenant: boolean;
  isTest: boolean;
  createdAt: number | null;
  emailVerified: boolean;
  email: string | null;
  hasPassword: boolean;
};

const EMPTY: RoleResult = {
  role: null,
  tenantId: null,
  tenantName: null,
  masterId: null,
  isPersonalTenant: false,
  isTest: false,
  createdAt: null,
  emailVerified: true,
  email: null,
  hasPassword: true,
};

export const authRouter = createTRPCRouter({
  getMyRole: publicProcedure.query(async ({ ctx }): Promise<RoleResult> => {
    if (!ctx.webUser) return EMPTY;

    const role = ctx.webUser.webRole as AppRole;
    const tenantId = ctx.webUser.tenantId ?? null;
    const email = ctx.webUser.email ?? null;

    let createdAt: number | null = null;
    let emailVerified = true;
    let hasPassword = true;
    try {
      const rows = await ctx.db
        .select({
          createdAt: webUsers.createdAt,
          emailVerified: webUsers.emailVerified,
          passwordHash: webUsers.passwordHash,
        })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);
      createdAt = rows[0]?.createdAt ?? null;
      emailVerified = !!(rows[0]?.emailVerified);
      hasPassword = !!(rows[0]?.passwordHash && rows[0].passwordHash !== "");
    } catch { /* non-critical */ }

    let masterId: number | null = null;
    let isPersonalTenant = false;
    let isTest = false;
    let tenantName: string | null = null;
    if (tenantId) {
      try {
        const [tenantRow] = await ctx.db
          .select({
            name: tenants.name,
            displayName: tenants.displayName,
            isPersonal: tenants.isPersonal,
            isTest: tenants.isTest,
          })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        if (tenantRow) {
          tenantName = tenantRow.displayName || tenantRow.name || null;
          if (tenantRow.isPersonal) isPersonalTenant = true;
          if (tenantRow.isTest) isTest = true;
        }
      } catch { /* non-critical */ }
      if (role === "master") {
        try {
          const [masterRow] = await ctx.db
            .select({ chatId: masters.chatId })
            .from(masters)
            .where(and(eq(masters.tenantId, tenantId), eq(masters.active, 1)))
            .limit(1);
          if (masterRow) masterId = masterRow.chatId;
        } catch { /* non-critical */ }
      }
    }

    return { role, tenantId, tenantName, masterId, isPersonalTenant, isTest, createdAt, emailVerified, email, hasPassword };
  }),
});
