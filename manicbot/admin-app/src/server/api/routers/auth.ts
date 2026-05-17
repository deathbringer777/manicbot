import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { webUsers, masters, tenants } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { listPermissions, type PermissionKey } from "~/server/api/permissions";
import { evaluateTrialState } from "~/lib/billing/trialState";
import { backfillPendingInviteNotifications } from "~/server/auth/backfillPendingInvites";

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
  /**
   * Internal `web_users.id` of the authenticated user (TEXT primary key).
   * Drives per-profile scoping (plugin pins, dashboard prefs) and the
   * preview-as-master permission guard. `null` only when unauthenticated.
   */
  webUserId: string | null;
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
  // Billing state — populated for tenant-scoped roles only. Drives the BillingGate.
  // Effective status (post lazy-flip of expired trials). Null for platform staff.
  billingStatus: string | null;
  trialEndsAt: number | null;
  graceEndsAt: number | null;
  /**
   * True when the tenant's trial has expired AND no Stripe customer exists yet.
   * Mirrors BillingSection.tsx's "hard block" rule. The UI gates dashboard access on this.
   */
  isTrialExpired: boolean;
};

const EMPTY: RoleResult = {
  role: null,
  webUserId: null,
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
  billingStatus: null,
  trialEndsAt: null,
  graceEndsAt: null,
  isTrialExpired: false,
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
    let billingStatus: string | null = null;
    let trialEndsAt: number | null = null;
    let graceEndsAt: number | null = null;
    let isTrialExpired = false;
    if (tenantId) {
      try {
        const [tenantRow] = await ctx.db
          .select({
            name: tenants.name,
            displayName: tenants.displayName,
            isPersonal: tenants.isPersonal,
            isTest: tenants.isTest,
            billingStatus: tenants.billingStatus,
            trialEndsAt: tenants.trialEndsAt,
            graceEndsAt: tenants.graceEndsAt,
            stripeCustomerId: tenants.stripeCustomerId,
          })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        if (tenantRow) {
          tenantName = tenantRow.displayName || tenantRow.name || null;
          if (tenantRow.isPersonal) isPersonalTenant = true;
          if (tenantRow.isTest) isTest = true;

          // Real-time expiry bridge: cron runs every 15 min but the user is here NOW.
          // Mirror of salon.getBillingStatus so the BillingGate triggers immediately
          // on auth, not only when the user opens the Billing tab.
          const nowUnix = Math.floor(Date.now() / 1000);
          const evalResult = evaluateTrialState(
            {
              billingStatus: tenantRow.billingStatus ?? null,
              trialEndsAt: tenantRow.trialEndsAt ?? null,
              stripeCustomerId: tenantRow.stripeCustomerId ?? null,
            },
            nowUnix,
          );
          billingStatus = evalResult.effectiveBillingStatus;
          trialEndsAt = tenantRow.trialEndsAt ?? null;
          graceEndsAt = tenantRow.graceEndsAt ?? null;
          isTrialExpired = evalResult.isTrialExpired;

          if (evalResult.shouldPersistFlip) {
            // Fire-and-forget: do not block the auth response on the UPDATE.
            void ctx.db
              .update(tenants)
              .set({ billingStatus: "inactive", updatedAt: nowUnix })
              .where(eq(tenants.id, tenantId));
          }
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

    // Fire-and-forget backfill: surface any pending master invitations
    // for this user's email in the bell. Idempotent on the partial
    // UNIQUE `(web_user_id, source_slug, source_id, kind)` so re-runs are
    // no-ops. Recovers the pre-PR-#151 invites that never got their
    // send-time `notifyWebUser` row, and acts as a safety net for any
    // future race where the send-time write is lost.
    if (email) {
      void backfillPendingInviteNotifications(ctx.db, ctx.webUser.id, email);
    }

    return {
      role,
      webUserId: ctx.webUser.id,
      tenantId,
      tenantName,
      masterId,
      isPersonalTenant,
      isTest,
      createdAt,
      emailVerified,
      email,
      hasPassword,
      permissions,
      billingStatus,
      trialEndsAt,
      graceEndsAt,
      isTrialExpired,
    };
  }),
});
