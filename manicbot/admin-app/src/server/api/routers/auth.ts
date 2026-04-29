import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { webUsers, masters, tenants } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { listPermissions, type PermissionKey } from "~/server/api/permissions";

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
  /** Only populated for role === "tenant_manager". [] for other roles. */
  permissions: PermissionKey[];
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
  permissions: [],
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
          // Authoritative: bind via web_user_id (added in migration 0043).
          const [boundRow] = await ctx.db
            .select({ chatId: masters.chatId })
            .from(masters)
            .where(and(
              eq(masters.tenantId, tenantId),
              eq(masters.webUserId, ctx.webUser.id),
              eq(masters.active, 1),
            ))
            .limit(1);
          if (boundRow) {
            masterId = boundRow.chatId;
          } else if (isPersonalTenant) {
            // Legacy personal-tenant fallback: a personal tenant has exactly
            // one master, so it's safe to resolve without a binding column.
            // If multiple rows somehow exist we abstain rather than guess.
            const personalRows = await ctx.db
              .select({ chatId: masters.chatId })
              .from(masters)
              .where(and(eq(masters.tenantId, tenantId), eq(masters.active, 1)))
              .limit(2);
            if (personalRows.length === 1) masterId = personalRows[0]!.chatId;
          }
          // Multi-master tenants without a binding row: leave masterId=null.
          // The UI then forces re-onboarding instead of leaking another master's data.
        } catch { /* non-critical */ }
      }
    }

    let permissions: PermissionKey[] = [];
    if (role === "tenant_manager" && tenantId) {
      try {
        permissions = await listPermissions(ctx, tenantId, ctx.webUser.id);
      } catch { /* non-critical */ }
    }

    return { role, tenantId, tenantName, masterId, isPersonalTenant, isTest, createdAt, emailVerified, email, hasPassword, permissions };
  }),
});
