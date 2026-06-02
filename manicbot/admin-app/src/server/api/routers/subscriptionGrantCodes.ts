/**
 * Admin-issued subscription grant codes (migration 0103).
 *
 * A `system_admin` generates one-time codes in God Mode; a code grants a
 * tenant a free period of a plan (launch use case: one free year of `max`).
 * The code is typed into the existing registration referral field and routed
 * here by the reserved `SVC-` prefix (`webUsers.register` calls
 * `redeemGrantCodeAtRegistration`; `referrals.validateCode` calls
 * `peekGrantCode` for live UX feedback).
 *
 * Security model (the user's #1 priority — "must not be cheatable"):
 *   - Codes are high-entropy (`crypto.getRandomValues`, ~55 bits) and the
 *     plaintext is shown to the admin exactly once at generation.
 *   - Only the SHA-256 hash is stored (`code_hash`). A DB leak yields no
 *     usable codes; a never-generated/random string misses the hash → rejected.
 *   - One-time: redemption is a single atomic `UPDATE ... WHERE status='active'
 *     AND (expires_at IS NULL OR expires_at > ?) RETURNING id`. Exactly one
 *     redeemer wins under concurrency (same pattern as google_prefill_consumed
 *     / webhook_dedup / upload_token_used).
 *   - Generation/list/revoke require `systemAdminProcedure`. Redemption applies
 *     the grant only to the just-created tenant — never a client-supplied id.
 */

import { z } from "zod";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { createTRPCRouter, systemAdminProcedure } from "~/server/api/trpc";
import { subscriptionGrantCodes, tenants } from "~/server/db/schema";
import { hashToken } from "~/server/auth/tokens";
import { writeAudit, ctxIp } from "~/server/security/audit";

type Db = DrizzleD1Database<Record<string, unknown>>;

/** Reserved prefix marking a code as admin-issued (vs a peer referral code). */
export const GRANT_CODE_PREFIX = "SVC-";
// No-look-alike alphabet (no 0/O/1/I) — matches the referral token alphabet.
// 32 chars divides 256 evenly, so `byte % 32` is unbiased.
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOKEN_LEN = 11; // SVC- + 11 = 15 chars, within the [6,16] register regex
const PLANS = ["start", "pro", "max"] as const;
const MAX_BATCH = 50;
const DEFAULT_DURATION_DAYS = 365;
/** Short, non-secret label shown in the admin list (e.g. `SVC-7K9`). */
const PREFIX_LABEL_LEN = 7;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function normalizeGrantCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isGrantCode(code: string): boolean {
  return normalizeGrantCode(code).startsWith(GRANT_CODE_PREFIX);
}

/** Mint a fresh `SVC-XXXXXXXXXXX` code. */
export function generateGrantCode(): string {
  const buf = new Uint8Array(TOKEN_LEN);
  crypto.getRandomValues(buf);
  const token = Array.from(buf, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join("");
  return `${GRANT_CODE_PREFIX}${token}`;
}

/** SHA-256 hex of the normalized code — what we store and look up by. */
export async function hashGrantCode(code: string): Promise<string> {
  return hashToken(normalizeGrantCode(code));
}

/**
 * Overwrite a tenant's subscription with a comped grant: set the plan, mark it
 * active until `now + durationDays`, and clear trial/grace/cancel flags. Same
 * field set as `billing.manualActivate`. Returns the new period-end (unix sec).
 */
async function applyGrant(db: Db, tenantId: string, plan: string, durationDays: number): Promise<number> {
  const now = nowSec();
  const periodEnd = now + durationDays * 86400;
  await db
    .update(tenants)
    .set({
      plan,
      billingStatus: "active",
      currentPeriodEnd: periodEnd,
      trialEndsAt: null,
      graceEndsAt: null,
      cancelAtPeriodEnd: 0,
      updatedAt: now,
    })
    .where(eq(tenants.id, tenantId));
  return periodEnd;
}

type RedeemResult =
  | { ok: true; plan: string; periodEnd: number }
  | { ok: false; reason: "not_found" | "revoked" | "already_redeemed" | "expired" };

/**
 * Redeem a grant code for the just-created tenant. Server helper (NOT a tRPC
 * procedure) — `webUsers.register` calls it, fail-open: any negative result
 * logs but never blocks signup. The atomic claim guarantees a code grants at
 * most once even under concurrent registrations.
 */
export async function redeemGrantCodeAtRegistration(
  db: Db,
  args: { code: string; tenantId: string; webUserId: string; actor?: string | null },
): Promise<RedeemResult> {
  const codeHash = await hashGrantCode(args.code);
  const [row] = await db
    .select({
      id: subscriptionGrantCodes.id,
      plan: subscriptionGrantCodes.plan,
      durationDays: subscriptionGrantCodes.durationDays,
      status: subscriptionGrantCodes.status,
      expiresAt: subscriptionGrantCodes.expiresAt,
    })
    .from(subscriptionGrantCodes)
    .where(eq(subscriptionGrantCodes.codeHash, codeHash))
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "revoked") return { ok: false, reason: "revoked" };
  if (row.status === "redeemed") return { ok: false, reason: "already_redeemed" };
  const now = nowSec();
  if (row.expiresAt != null && row.expiresAt <= now) return { ok: false, reason: "expired" };

  // Atomic one-time claim — the WHERE clause is the race guard, RETURNING tells
  // us whether THIS request won. A concurrent redeemer that already flipped the
  // status (or an expiry that lapsed between SELECT and UPDATE) yields no row.
  const claimed = await db
    .update(subscriptionGrantCodes)
    .set({
      status: "redeemed",
      redeemedByTenantId: args.tenantId,
      redeemedByWebUserId: args.webUserId,
      redeemedAt: now,
    })
    .where(
      and(
        eq(subscriptionGrantCodes.id, row.id),
        eq(subscriptionGrantCodes.status, "active"),
        or(isNull(subscriptionGrantCodes.expiresAt), gt(subscriptionGrantCodes.expiresAt, now)),
      ),
    )
    .returning({ id: subscriptionGrantCodes.id });

  if (claimed.length === 0) return { ok: false, reason: "already_redeemed" };

  const periodEnd = await applyGrant(db, args.tenantId, row.plan, row.durationDays);
  await writeAudit(db, {
    actor: args.actor ?? null,
    action: "subscriptionGrantCode.redeem",
    tenantId: args.tenantId,
    detail: `code=${row.id} plan=${row.plan} periodEnd=${periodEnd}`,
  });
  return { ok: true, plan: row.plan, periodEnd };
}

type PeekResult =
  | { valid: true; plan: string; durationDays: number }
  | { valid: false; reason: "not_found" | "revoked" | "already_redeemed" | "expired" };

/** Read-only validation for the registration UX — never consumes the code. */
export async function peekGrantCode(db: Db, code: string): Promise<PeekResult> {
  const codeHash = await hashGrantCode(code);
  const [row] = await db
    .select({
      plan: subscriptionGrantCodes.plan,
      durationDays: subscriptionGrantCodes.durationDays,
      status: subscriptionGrantCodes.status,
      expiresAt: subscriptionGrantCodes.expiresAt,
    })
    .from(subscriptionGrantCodes)
    .where(eq(subscriptionGrantCodes.codeHash, codeHash))
    .limit(1);

  if (!row) return { valid: false, reason: "not_found" };
  if (row.status === "revoked") return { valid: false, reason: "revoked" };
  if (row.status === "redeemed") return { valid: false, reason: "already_redeemed" };
  if (row.expiresAt != null && row.expiresAt <= nowSec()) return { valid: false, reason: "expired" };
  return { valid: true, plan: row.plan, durationDays: row.durationDays };
}

export const subscriptionGrantCodesRouter = createTRPCRouter({
  /** Mint N one-time codes. Returns the plaintext ONCE — never retrievable later. */
  generate: systemAdminProcedure
    .input(
      z.object({
        plan: z.enum(PLANS).default("max"),
        durationDays: z.number().int().min(1).max(3650).default(DEFAULT_DURATION_DAYS),
        count: z.number().int().min(1).max(MAX_BATCH).default(1),
        expiresInDays: z.number().int().min(1).max(3650).nullish(),
        note: z.string().max(200).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = nowSec();
      const expiresAt = input.expiresInDays ? now + input.expiresInDays * 86400 : null;
      const codes: Array<{ id: string; code: string; codePrefix: string }> = [];

      for (let i = 0; i < input.count; i += 1) {
        const code = generateGrantCode();
        const codeHash = await hashGrantCode(code);
        const id = crypto.randomUUID();
        const codePrefix = code.slice(0, PREFIX_LABEL_LEN);
        await ctx.db.insert(subscriptionGrantCodes).values({
          id,
          codeHash,
          codePrefix,
          plan: input.plan,
          durationDays: input.durationDays,
          status: "active",
          expiresAt,
          note: input.note ?? null,
          createdBy: ctx.webUser?.email ?? null,
          createdAt: now,
        });
        codes.push({ id, code, codePrefix });
      }

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "subscriptionGrantCode.generate",
        detail: `count=${input.count} plan=${input.plan} durationDays=${input.durationDays}`,
        ip: ctxIp(ctx),
      });

      return { codes };
    }),

  /** Admin list — metadata only. `code_hash` is never selected, so it cannot leak. */
  list: systemAdminProcedure
    .input(
      z
        .object({
          status: z.enum(["active", "redeemed", "revoked"]).nullish(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const where = input.status ? eq(subscriptionGrantCodes.status, input.status) : undefined;
      return ctx.db
        .select({
          id: subscriptionGrantCodes.id,
          codePrefix: subscriptionGrantCodes.codePrefix,
          plan: subscriptionGrantCodes.plan,
          durationDays: subscriptionGrantCodes.durationDays,
          status: subscriptionGrantCodes.status,
          expiresAt: subscriptionGrantCodes.expiresAt,
          note: subscriptionGrantCodes.note,
          createdBy: subscriptionGrantCodes.createdBy,
          createdAt: subscriptionGrantCodes.createdAt,
          redeemedByTenantId: subscriptionGrantCodes.redeemedByTenantId,
          redeemedAt: subscriptionGrantCodes.redeemedAt,
        })
        .from(subscriptionGrantCodes)
        .where(where)
        .orderBy(desc(subscriptionGrantCodes.createdAt))
        .limit(input.limit);
    }),

  /** Revoke an as-yet-unredeemed code (active → revoked). No-op if already used. */
  revoke: systemAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await ctx.db
        .update(subscriptionGrantCodes)
        .set({ status: "revoked" })
        .where(
          and(
            eq(subscriptionGrantCodes.id, input.id),
            eq(subscriptionGrantCodes.status, "active"),
          ),
        )
        .returning({ id: subscriptionGrantCodes.id });

      const ok = revoked.length > 0;
      if (ok) {
        await writeAudit(ctx.db, {
          actor: ctx.webUser?.email ?? null,
          action: "subscriptionGrantCode.revoke",
          detail: `code=${input.id}`,
          ip: ctxIp(ctx),
        });
      }
      return { ok };
    }),
});
