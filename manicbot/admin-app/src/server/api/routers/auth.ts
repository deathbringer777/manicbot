import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";
import { webUsers, masters, tenants } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { listPermissions, type PermissionKey } from "~/server/api/permissions";
import { evaluateTrialState } from "~/lib/billing/trialState";
import { backfillPendingInviteNotifications } from "~/server/auth/backfillPendingInvites";
import { listMembershipsForWebUser } from "~/server/auth/memberships";

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
   * Drives per-profile scoping (plugin pins, dashboard prefs). `null` only
   * when unauthenticated.
   */
  webUserId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  /** Salon-uploaded logo URL (`tenants.logo`). Drives the brand tile in the
   *  sidebar/header when role is `tenant_owner` / `tenant_manager` (and as a
   *  fallback for masters without their own avatar). */
  tenantLogo: string | null;
  masterId: number | null;
  /** Per-master avatar URL (`masters.avatar_url`, migration 0075). Wins over
   *  emoji + tenant logo when role === "master". */
  masterAvatarUrl: string | null;
  /** Per-master single-glyph avatar (`masters.avatar_emoji`, migration 0075).
   *  Renders as a centered emoji in the brand tile when no photo is set. */
  masterAvatarEmoji: string | null;
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
  tenantLogo: null,
  masterId: null,
  masterAvatarUrl: null,
  masterAvatarEmoji: null,
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
    let masterAvatarUrl: string | null = null;
    let masterAvatarEmoji: string | null = null;
    let isPersonalTenant = false;
    let isTest = false;
    let tenantName: string | null = null;
    let tenantLogo: string | null = null;
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
            logo: tenants.logo,
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
          tenantLogo = tenantRow.logo ?? null;
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
          // Also pull avatar fields so the brand tile in the shell can render
          // this master's photo/emoji instead of the platform 💅 fallback.
          const [boundRow] = await ctx.db
            .select({
              chatId: masters.chatId,
              avatarUrl: masters.avatarUrl,
              avatarEmoji: masters.avatarEmoji,
            })
            .from(masters)
            .where(and(
              eq(masters.tenantId, tenantId),
              eq(masters.webUserId, ctx.webUser.id),
              eq(masters.active, 1),
            ))
            .limit(1);
          if (boundRow) {
            masterId = boundRow.chatId;
            masterAvatarUrl = boundRow.avatarUrl ?? null;
            masterAvatarEmoji = boundRow.avatarEmoji ?? null;
          } else if (isPersonalTenant) {
            // Legacy personal-tenant fallback: a personal tenant has exactly
            // one master, so it's safe to resolve without a binding column.
            // If multiple rows somehow exist we abstain rather than guess.
            const personalRows = await ctx.db
              .select({
                chatId: masters.chatId,
                avatarUrl: masters.avatarUrl,
                avatarEmoji: masters.avatarEmoji,
              })
              .from(masters)
              .where(and(eq(masters.tenantId, tenantId), eq(masters.active, 1)))
              .limit(2);
            if (personalRows.length === 1) {
              masterId = personalRows[0]!.chatId;
              masterAvatarUrl = personalRows[0]!.avatarUrl ?? null;
              masterAvatarEmoji = personalRows[0]!.avatarEmoji ?? null;
            }
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

    // Awaited backfill: surface any pending master invitations for
    // this user's email in the bell. Idempotent on the partial UNIQUE
    // `(web_user_id, source_slug, source_id, kind)` so re-runs are
    // no-ops. Recovers the pre-PR-#151 invites that never got their
    // send-time `notifyWebUser` row, and acts as the safety net for any
    // race where the send-time write was lost (Resend hiccup, request
    // abort, the pre-PR-B fire-and-forget D1-binding-tear-down trap).
    //
    // PR-B: was `void` — that pattern silently dropped on Cloudflare
    // Pages because the underlying D1 binding is invalidated with the
    // request context. We now await: one SELECT + at most a handful of
    // INSERT OR IGNORE per call, ~50ms p50. Worth the latency on the
    // hot path because this is the difference between the bell showing
    // a pending invite immediately or never.
    if (email) {
      await backfillPendingInviteNotifications(ctx.db, ctx.webUser.id, email).catch(
        (e) => {
          // backfill is internally swallow-everything, but defense in depth:
          // a thrown error here must never break `getMyRole`.
          void e;
        },
      );
    }

    return {
      role,
      webUserId: ctx.webUser.id,
      tenantId,
      tenantName,
      tenantLogo,
      masterId,
      masterAvatarUrl,
      masterAvatarEmoji,
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

  // ------------------------------------------------------------------
  // listMyTenants — every salon the caller can act in: their home tenant
  // (web_users.tenant_id) plus any salon where they hold an authoritative
  // master role (masters.web_user_id). Drives the header salon switcher,
  // which hides itself when the list has 0–1 entries.
  //
  // Home is read straight from web_users (NOT ctx.webUser, whose tenantId is
  // the *active* salon and would be wrong after a switch).
  // ------------------------------------------------------------------
  listMyTenants: protectedProcedure.query(async ({ ctx }) => {
    const u = ctx.webUser!;
    const [home] = await ctx.db
      .select({ tenantId: webUsers.tenantId, role: webUsers.role })
      .from(webUsers)
      .where(eq(webUsers.id, u.id))
      .limit(1);
    return listMembershipsForWebUser(ctx.db, {
      webUserId: u.id,
      homeTenantId: home?.tenantId ?? null,
      homeRole: home?.role ?? "tenant_owner",
    });
  }),

  // ------------------------------------------------------------------
  // switchTenant — set the caller's active salon. Validates membership
  // (home OR an authoritative master role) BEFORE writing the pointer, so a
  // user can never switch into a salon they don't belong to. Switching back to
  // home stores NULL so the resolver short-circuits. The session picks up the
  // new (tenantId, role) on its next refresh — the client calls
  // useSession().update() + invalidates queries.
  // ------------------------------------------------------------------
  switchTenant: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const u = ctx.webUser!;
      const [home] = await ctx.db
        .select({ tenantId: webUsers.tenantId, role: webUsers.role })
        .from(webUsers)
        .where(eq(webUsers.id, u.id))
        .limit(1);
      const memberships = await listMembershipsForWebUser(ctx.db, {
        webUserId: u.id,
        homeTenantId: home?.tenantId ?? null,
        homeRole: home?.role ?? "tenant_owner",
      });
      const target = memberships.find((m) => m.tenantId === input.tenantId);
      if (!target) {
        throw new TRPCError({ code: "FORBIDDEN", message: "not_a_member" });
      }
      await ctx.db
        .update(webUsers)
        .set({ activeTenantId: target.isHome ? null : input.tenantId })
        .where(eq(webUsers.id, u.id));
      return { ok: true, tenantId: input.tenantId, role: target.role };
    }),
});
