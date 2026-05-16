/**
 * Referral program tRPC router (PR-B / migration 0064).
 *
 * Eligibility — only self-registered customer accounts can generate codes:
 *   - tenant_owner of any tenant (personal or salon)
 *   - master on their PERSONAL tenant (= self-registered independent master)
 *   - system_admin (support / debugging override)
 * Denied:
 *   - tenant_manager (staff, not the customer)
 *   - master on a NON-personal tenant (salon-invited; salon owner pays for them)
 *
 * Reward economics (CFO-locked, see plan):
 *   Invitee  → 20% off first monthly invoice OR 10% off first yearly (one-shot)
 *   Referrer → 1 free month of their current plan per confirmed referral,
 *              cap 6 per rolling 12mo, NO 5-threshold bonus
 *   Trigger  → invitee's FIRST paid invoice (user override of CFO's
 *              2nd-invoice recommendation; fraud defenses compensate)
 *   Mechanism→ Stripe customer_balance PLN credits (works for monthly + yearly)
 *
 * Code redemption + reward issuance + fraud detection all happen in the
 * Worker on invoice.paid webhook — this router is read + code generation
 * + the bridging `recordRedemption` called by webUsers.register.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import {
  referralCodes,
  referrals,
  referralRewards,
  referralEvents,
  tenants,
  webUsers,
} from "~/server/db/schema";
import { checkRateLimit } from "~/server/auth/rateLimit";

// Local clientIp helper — copied from webUsers.ts / publicSalon.ts (no
// central module exists; each router defines its own to avoid an import cycle
// with the auth layer).
function clientIp(ctx: { headers?: Headers | null }): string {
  const h = ctx.headers;
  if (!h?.get) return "unknown";
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || h.get("cf-connecting-ip") || "unknown";
}

// ── Eligibility ────────────────────────────────────────────────────────────

type ReferralCtx = {
  webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null | undefined;
  db: ReturnType<typeof import("~/server/db").getDb>;
};

/**
 * Throws FORBIDDEN unless the caller is allowed to generate a referral code.
 * Allowed roles:
 *   - system_admin
 *   - tenant_owner (any tenant the user owns)
 *   - master ONLY on a personal tenant (self-registered independent master)
 */
export async function assertReferralEligible(ctx: ReferralCtx): Promise<{
  webUserId: string;
  tenantId: string;
}> {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  const { webRole, tenantId, id } = ctx.webUser;

  if (webRole === "system_admin") {
    // System admin without a tenantId can't generate a real code; reject so
    // the call surfaces. Sysadmin should impersonate a tenant first.
    if (!tenantId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "system_admin must impersonate a tenant to generate a referral code",
      });
    }
    return { webUserId: id, tenantId };
  }

  if (!tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Referral program is for tenant-bound accounts only" });
  }

  if (webRole === "tenant_owner") return { webUserId: id, tenantId };

  if (webRole === "master") {
    const [t] = await ctx.db
      .select({ isPersonal: tenants.isPersonal })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (t?.isPersonal) return { webUserId: id, tenantId };
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Salon-invited masters cannot generate referral codes — the salon owner pays",
    });
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Referral program is only for self-registered owners and independent masters",
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

const REFERRAL_CODE_REGEX = /^[A-Z0-9-]{6,16}$/;

/**
 * Code shape: <slug>-<token>, 10 chars total.
 *   slug  = up to 4 letters derived from owner name/email (uppercase, A-Z only)
 *   token = 5 chars from a no-look-alike alphabet (no 0/O/1/I)
 * Total visual length: 4 + 1 (hyphen) + 5 = 10. Avoids confusion with promo
 * codes used inside salons (`promo_codes` table is a different namespace).
 */
function generateReferralCode(seed: string): string {
  const slugChars = seed.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "USER";
  const slug = slugChars.padEnd(4, "X").slice(0, 4);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const buf = new Uint8Array(5);
  crypto.getRandomValues(buf);
  const token = Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
  return `${slug}-${token}`;
}

/** Mask a display name for the invited-friends list: "Anna K." or fallback. */
function maskName(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return `${parts[0]!.slice(0, 1)}.`;
    return `${parts[0]} ${parts[1]!.slice(0, 1)}.`;
  }
  const local = email.split("@")[0] ?? "";
  if (!local) return "—";
  return `${local.slice(0, 2)}…`;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function buildShareUrl(code: string): string {
  // Public URL is environment-derived. Falls back to localhost for tests.
  const base =
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}/register?ref=${encodeURIComponent(code)}`;
}

// ── Router ─────────────────────────────────────────────────────────────────

const ROLLING_12_MO_SEC = 365 * 24 * 3600;

export const referralsRouter = createTRPCRouter({
  /**
   * Get (or auto-create) the caller's active referral code. Idempotent.
   * Returns `{ code, shareUrl }`.
   */
  getMyCode: protectedProcedure.query(async ({ ctx }) => {
    const { webUserId, tenantId } = await assertReferralEligible(ctx);

    const existing = await ctx.db
      .select({ code: referralCodes.code })
      .from(referralCodes)
      .where(and(eq(referralCodes.ownerWebUserId, webUserId), eq(referralCodes.isActive, 1)))
      .limit(1);
    if (existing.length > 0) {
      const code = existing[0]!.code;
      return { code, shareUrl: buildShareUrl(code) };
    }

    // Generate a fresh code; retry on rare collision.
    const seed = ctx.webUser!.email;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateReferralCode(seed);
      try {
        await ctx.db.insert(referralCodes).values({
          code,
          ownerWebUserId: webUserId,
          ownerTenantId: tenantId,
          isActive: 1,
          createdAt: nowSec(),
        });
        return { code, shareUrl: buildShareUrl(code) };
      } catch {
        // PRIMARY KEY / partial-unique collision — retry with new randomness.
      }
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not generate a unique referral code" });
  }),

  /**
   * Full referrer dashboard: code, share URL, invited friends list (with
   * masked names + status), rewards history, counters. Eligibility gate
   * applies — staff accounts get FORBIDDEN.
   */
  getMyDashboard: protectedProcedure.query(async ({ ctx }) => {
    const { webUserId } = await assertReferralEligible(ctx);

    const [codeRow] = await ctx.db
      .select({ code: referralCodes.code })
      .from(referralCodes)
      .where(and(eq(referralCodes.ownerWebUserId, webUserId), eq(referralCodes.isActive, 1)))
      .limit(1);

    const invitedRows = await ctx.db
      .select({
        id: referrals.id,
        status: referrals.status,
        createdAt: referrals.createdAt,
        rewardId: referrals.rewardId,
        inviteeName: webUsers.name,
        inviteeEmail: webUsers.email,
      })
      .from(referrals)
      .leftJoin(webUsers, eq(webUsers.id, referrals.inviteeWebUserId))
      .where(eq(referrals.referrerWebUserId, webUserId))
      .orderBy(desc(referrals.createdAt))
      .limit(50);

    const invited = invitedRows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      rewardId: r.rewardId,
      // Mask display name unless owner — prevent enumerating other users'
      // emails from a stolen referrer session.
      inviteeMaskedName: maskName(r.inviteeName, r.inviteeEmail ?? ""),
    }));

    const rewardsRows = await ctx.db
      .select({
        id: referralRewards.id,
        kind: referralRewards.kind,
        amountGrosz: referralRewards.amountGrosz,
        status: referralRewards.status,
        appliedAt: referralRewards.appliedAt,
        expiresAt: referralRewards.expiresAt,
        createdAt: referralRewards.createdAt,
      })
      .from(referralRewards)
      .where(eq(referralRewards.referrerWebUserId, webUserId))
      .orderBy(desc(referralRewards.createdAt))
      .limit(50);

    const now = nowSec();
    const cutoff = now - ROLLING_12_MO_SEC;

    // Counters
    let pending = 0;
    let firstPaid = 0;
    let rewarded = 0;
    let invalidated = 0;
    for (const r of invited) {
      if (r.status === "pending") pending += 1;
      else if (r.status === "first_paid") firstPaid += 1;
      else if (r.status === "rewarded") rewarded += 1;
      else if (r.status === "invalidated") invalidated += 1;
    }

    let totalEarnedGrosz = 0;
    let monthsUsedInRollingYear = 0;
    for (const r of rewardsRows) {
      if (r.status === "applied") {
        totalEarnedGrosz += r.amountGrosz;
        if (r.createdAt >= cutoff) monthsUsedInRollingYear += 1;
      }
    }
    const monthsRemainingInCap = Math.max(0, 6 - monthsUsedInRollingYear);

    return {
      code: codeRow?.code ?? null,
      shareUrl: codeRow?.code ? buildShareUrl(codeRow.code) : null,
      invited,
      rewards: rewardsRows,
      counters: {
        pending,
        firstPaid,
        rewarded,
        invalidated,
        totalEarnedGrosz,
        monthsUsedInRollingYear,
        monthsRemainingInCap,
      },
    };
  }),

  /**
   * Validate a referral code at registration time. Public so the unauth'd
   * /register page can hit it; rate-limited to deflect brute-force lookups
   * (10/min per IP — generous because an invitee may retype their code).
   */
  validateCode: publicProcedure
    .input(z.object({ code: z.string().regex(REFERRAL_CODE_REGEX) }))
    .query(async ({ ctx, input }) => {
      const ip = clientIp(ctx as { headers?: Headers | null });
      const rl = await checkRateLimit(ctx.db, ip, "ref_validate", 10, 60 * 1000);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Slow down — try again in a minute" });
      }

      const code = input.code.toUpperCase();
      const [row] = await ctx.db
        .select({
          ownerWebUserId: referralCodes.ownerWebUserId,
          ownerTenantId: referralCodes.ownerTenantId,
          isActive: referralCodes.isActive,
        })
        .from(referralCodes)
        .where(eq(referralCodes.code, code))
        .limit(1);
      if (!row || !row.isActive) {
        return { valid: false as const, ownerDisplayName: null, expectedInviteeDiscountMonthly: 20, expectedInviteeDiscountYearly: 10 };
      }

      const [owner] = await ctx.db
        .select({ name: webUsers.name, email: webUsers.email })
        .from(webUsers)
        .where(eq(webUsers.id, row.ownerWebUserId))
        .limit(1);
      return {
        valid: true as const,
        ownerDisplayName: owner?.name ?? owner?.email?.split("@")[0] ?? "—",
        expectedInviteeDiscountMonthly: 20,
        expectedInviteeDiscountYearly: 10,
      };
    }),

  /**
   * Rotate the active code: archive the current one, mint a new one.
   * Throttled 1/24h to prevent griefing a viral share by spamming rotation.
   */
  rotateMyCode: protectedProcedure.mutation(async ({ ctx }) => {
    const { webUserId, tenantId } = await assertReferralEligible(ctx);

    const rl = await checkRateLimit(ctx.db, webUserId, "ref_rotate", 1, 24 * 3600 * 1000);
    if (!rl.allowed) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "You can rotate at most once per 24 hours" });
    }

    const now = nowSec();
    await ctx.db
      .update(referralCodes)
      .set({ isActive: 0, rotatedAt: now })
      .where(and(eq(referralCodes.ownerWebUserId, webUserId), eq(referralCodes.isActive, 1)));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateReferralCode(ctx.webUser!.email);
      try {
        await ctx.db.insert(referralCodes).values({
          code,
          ownerWebUserId: webUserId,
          ownerTenantId: tenantId,
          isActive: 1,
          createdAt: now,
        });
        return { newCode: code, shareUrl: buildShareUrl(code) };
      } catch {
        // collision; retry
      }
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not generate a unique code" });
  }),
});

// ── Server-side helper for webUsers.register (NOT a tRPC procedure) ────────

/**
 * Record a code redemption: insert a `referrals` row in `pending` status.
 * Called from webUsers.register after the invitee's row is inserted. The
 * caller is responsible for never blocking registration on this — if the
 * code is invalid or any other check fails, log + continue.
 *
 * Fraud check guarantees (cheap pre-flight; the heavy fraud detection
 * happens on the Worker invoice.paid webhook):
 *   - code exists and is_active = 1
 *   - referrer is not the invitee themselves (web_user_id mismatch)
 *   - referrer's tenant ≠ invitee's tenant (no self-referral by tenant collision)
 */
export async function recordRedemption(
  db: ReturnType<typeof import("~/server/db").getDb>,
  args: { code: string; inviteeWebUserId: string; inviteeTenantId: string },
): Promise<{ ok: boolean; reason?: string; referralId?: string }> {
  const code = args.code.toUpperCase();
  const [codeRow] = await db
    .select({
      ownerWebUserId: referralCodes.ownerWebUserId,
      ownerTenantId: referralCodes.ownerTenantId,
      isActive: referralCodes.isActive,
    })
    .from(referralCodes)
    .where(eq(referralCodes.code, code))
    .limit(1);
  if (!codeRow || !codeRow.isActive) return { ok: false, reason: "invalid_code" };

  if (codeRow.ownerWebUserId === args.inviteeWebUserId) {
    return { ok: false, reason: "self_referral_web_user" };
  }
  if (codeRow.ownerTenantId === args.inviteeTenantId) {
    return { ok: false, reason: "self_referral_tenant" };
  }

  const referralId = crypto.randomUUID();
  const now = nowSec();
  try {
    await db.insert(referrals).values({
      id: referralId,
      referrerWebUserId: codeRow.ownerWebUserId,
      referrerTenantId: codeRow.ownerTenantId,
      inviteeWebUserId: args.inviteeWebUserId,
      inviteeTenantId: args.inviteeTenantId,
      code,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(referralEvents).values({
      referralId,
      event: "code_redeemed",
      metadata: JSON.stringify({ code }),
      createdAt: now,
    });
    return { ok: true, referralId };
  } catch {
    // Partial-unique on invitee_web_user_id violated — they already redeemed.
    return { ok: false, reason: "already_redeemed" };
  }
}

// Internal export for tests + Worker webhook integration.
export const __testing__ = {
  generateReferralCode,
  maskName,
  REFERRAL_CODE_REGEX,
};
