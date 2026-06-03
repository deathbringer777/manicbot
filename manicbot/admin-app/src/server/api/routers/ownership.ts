import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, sql, gte, desc } from "drizzle-orm";
import { createTRPCRouter, publicProcedure, tenantOwnerProcedure } from "~/server/api/trpc";
import {
  ownershipTransferTokens,
  webUsers,
  tenants,
  masters,
  auditLog,
} from "~/server/db/schema";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import {
  sendOwnershipTransferRequestEmail,
  sendOwnershipTransferCompletedToOldOwnerEmail,
  sendOwnershipTransferCompletedToNewOwnerEmail,
} from "~/server/email/emailService";
import {
  TRANSFER_TTL_SECONDS,
  generateTransferToken,
  hashToken,
  checkTransferEligibility,
  isTokenExpired,
} from "~/server/api/ownership/ownershipLogic";
import type { Lang } from "~/lib/i18n";
import { authPublicBaseUrl } from "~/server/auth/authBaseUrl";

/* ── In-memory rate-limits ────────────────────────────────────────────────── */

// `requestTransfer` — per-webUser. Five attempts per hour is plenty for
// legitimate use, well below any pattern that suggests automated abuse.
const initRl = new Map<string, { count: number; resetAt: number }>();
const INIT_MAX = 5;
const INIT_WINDOW = 60 * 60 * 1000;

function checkInitRl(userId: string): boolean {
  const now = Date.now();
  const entry = initRl.get(userId);
  if (!entry || now > entry.resetAt) {
    initRl.set(userId, { count: 1, resetAt: now + INIT_WINDOW });
    return true;
  }
  if (entry.count >= INIT_MAX) return false;
  entry.count++;
  return true;
}

// `confirmTransfer` — per-IP defense-in-depth against brute-forcing 32-char
// tokens. Tokens have ~190 bits of entropy so brute force is infeasible, but
// 20 attempts per 10 min per IP still blocks a misbehaving script before it
// burns through D1 read quotas.
const confirmRl = new Map<string, { count: number; resetAt: number }>();
const CONFIRM_MAX = 20;
const CONFIRM_WINDOW = 10 * 60 * 1000;

function checkConfirmRl(ip: string): boolean {
  const now = Date.now();
  const entry = confirmRl.get(ip);
  if (!entry || now > entry.resetAt) {
    confirmRl.set(ip, { count: 1, resetAt: now + CONFIRM_WINDOW });
    return true;
  }
  if (entry.count >= CONFIRM_MAX) return false;
  entry.count++;
  return true;
}

function clientIp(ctx: { headers?: Headers | null }): string {
  const h = ctx.headers;
  if (!h?.get) return "unknown";
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || h.get("cf-connecting-ip") || "unknown";
}

function shortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => chars[b % chars.length]).join("");
}

/** Reason → user-visible TRPC error. Keeps the wire format stable for the UI. */
function rejectFromReason(reason: string): never {
  const m: Record<string, { code: "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST"; message: string }> = {
    self_transfer:           { code: "BAD_REQUEST", message: "Cannot transfer ownership to yourself" },
    target_not_in_tenant:    { code: "FORBIDDEN",   message: "Target user is not a member of this tenant" },
    target_email_unverified: { code: "FORBIDDEN",   message: "Target user must verify their email first" },
    already_owner:           { code: "BAD_REQUEST", message: "Target user is already the tenant owner" },
    no_active_subscription:  { code: "FORBIDDEN",   message: "Active subscription required to transfer ownership" },
  };
  const e = m[reason] ?? { code: "BAD_REQUEST" as const, message: reason };
  throw new TRPCError({ code: e.code, message: e.message });
}

export const ownershipRouter = createTRPCRouter({
  /** Owner: get the currently-pending transfer for this tenant (if any). */
  getPending: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const nowSec = Math.floor(Date.now() / 1000);
      const [row] = await ctx.db
        .select({
          id: ownershipTransferTokens.id,
          tenantId: ownershipTransferTokens.tenantId,
          fromUserId: ownershipTransferTokens.fromUserId,
          toUserId: ownershipTransferTokens.toUserId,
          expiresAt: ownershipTransferTokens.expiresAt,
          createdAt: ownershipTransferTokens.createdAt,
          toName: webUsers.name,
          toEmail: webUsers.email,
        })
        .from(ownershipTransferTokens)
        .leftJoin(webUsers, eq(ownershipTransferTokens.toUserId, webUsers.id))
        .where(and(
          eq(ownershipTransferTokens.tenantId, input.tenantId),
          isNull(ownershipTransferTokens.consumedAt),
          isNull(ownershipTransferTokens.cancelledAt),
          gte(ownershipTransferTokens.expiresAt, nowSec),
        ))
        .orderBy(desc(ownershipTransferTokens.createdAt))
        .limit(1);
      return row ?? null;
    }),

  /** Owner: start a transfer. Sends confirmation email to CURRENT owner. */
  requestTransfer: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      targetWebUserId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });

      if (!checkInitRl(ctx.webUser.id)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many transfer attempts. Try again later." });
      }

      const [target] = await ctx.db
        .select({
          id: webUsers.id,
          tenantId: webUsers.tenantId,
          emailVerified: webUsers.emailVerified,
          role: webUsers.role,
          email: webUsers.email,
          name: webUsers.name,
          lang: webUsers.lang,
        })
        .from(webUsers)
        .where(eq(webUsers.id, input.targetWebUserId))
        .limit(1);

      const [tenantRow] = await ctx.db
        .select({ billingStatus: tenants.billingStatus, name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);

      const eligibility = checkTransferEligibility({
        targetUserId: input.targetWebUserId,
        fromUserId: ctx.webUser.id,
        tenantId: input.tenantId,
        target: target ?? null,
        billingStatus: tenantRow?.billingStatus ?? null,
      });
      if (!eligibility.ok) rejectFromReason(eligibility.reason!);

      // Single-pending guard: reject if there is already an active token. The
      // partial unique index in migration 0062 catches concurrent inserts —
      // this check just gives a friendlier error than a unique-violation.
      const nowSec = Math.floor(Date.now() / 1000);
      const [existing] = await ctx.db
        .select({ id: ownershipTransferTokens.id })
        .from(ownershipTransferTokens)
        .where(and(
          eq(ownershipTransferTokens.tenantId, input.tenantId),
          isNull(ownershipTransferTokens.consumedAt),
          isNull(ownershipTransferTokens.cancelledAt),
          gte(ownershipTransferTokens.expiresAt, nowSec),
        ))
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A transfer request is already pending" });
      }

      const [fromUser] = await ctx.db
        .select({ id: webUsers.id, email: webUsers.email, name: webUsers.name, lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);
      if (!fromUser) throw new TRPCError({ code: "NOT_FOUND" });

      const token = generateTransferToken();
      const tokenHash = await hashToken(token);
      const id = `ott_${shortId()}`;
      const ip = clientIp(ctx as { headers?: Headers | null });
      const ua = (ctx as { headers?: Headers | null }).headers?.get?.("user-agent") ?? null;

      await ctx.db.insert(ownershipTransferTokens).values({
        id,
        tenantId: input.tenantId,
        fromUserId: ctx.webUser.id,
        toUserId: target!.id,
        tokenHash,
        expiresAt: nowSec + TRANSFER_TTL_SECONDS,
        createdAt: nowSec,
        ipAddress: ip === "unknown" ? null : ip,
        userAgent: ua ? ua.slice(0, 500) : null,
      });

      await ctx.db.insert(auditLog).values({
        tenantId: input.tenantId,
        actor: fromUser.email,
        action: "ownership_transfer_requested",
        detail: `to=${target!.email}`,
        ip,
        createdAt: nowSec,
      });

      const baseUrl = authPublicBaseUrl() || "";
      const confirmUrl = `${baseUrl}/ownership/confirm?token=${encodeURIComponent(token)}`;

      sendOwnershipTransferRequestEmail({
        to: fromUser.email,
        fromName: fromUser.name ?? fromUser.email,
        toName: target!.name ?? target!.email,
        toEmail: target!.email,
        tenantName: tenantRow?.name ?? input.tenantId,
        confirmUrl,
        lang: (fromUser.lang as Lang) ?? "en",
      }).catch(() => { /* fire-and-forget */ });

      return { id, expiresAt: nowSec + TRANSFER_TTL_SECONDS };
    }),

  /** Public: confirm a transfer using the email token. */
  // nosemgrep: trpc-public-procedure-mutation -- token-validated public flow (no session by design, rate-limited by IP)
  confirmTransfer: publicProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx as { headers?: Headers | null });
      if (!checkConfirmRl(ip)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many confirmation attempts" });
      }
      const tokenHash = await hashToken(input.token);
      const [row] = await ctx.db
        .select()
        .from(ownershipTransferTokens)
        .where(eq(ownershipTransferTokens.tokenHash, tokenHash))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid token" });
      if (row.consumedAt) throw new TRPCError({ code: "CONFLICT", message: "Token already used" });
      if (row.cancelledAt) throw new TRPCError({ code: "CONFLICT", message: "Transfer was cancelled" });

      const nowSec = Math.floor(Date.now() / 1000);
      if (isTokenExpired(row.expiresAt, nowSec)) {
        // No "GONE" in TRPC error codes; map expired tokens to NOT_FOUND so
        // the UI keeps treating "invalid/expired" as a single category.
        throw new TRPCError({ code: "NOT_FOUND", message: "Token has expired" });
      }

      const [fromUser] = await ctx.db.select().from(webUsers).where(eq(webUsers.id, row.fromUserId)).limit(1);
      const [toUser] = await ctx.db.select().from(webUsers).where(eq(webUsers.id, row.toUserId)).limit(1);
      if (!fromUser || !toUser) {
        // Mark cancelled so the partial unique index releases.
        // tenant-scan-ignore: ownership-transfer token validated above; row pinned by its unguessable token id.
        await ctx.db.update(ownershipTransferTokens)
          .set({ cancelledAt: nowSec })
          .where(eq(ownershipTransferTokens.id, row.id));
        throw new TRPCError({ code: "NOT_FOUND", message: "User no longer exists" });
      }

      // Re-check eligibility at confirm time so a downgrade since the request
      // doesn't bypass the gate.
      const [tenantRow] = await ctx.db
        .select({ billingStatus: tenants.billingStatus, name: tenants.name })
        .from(tenants).where(eq(tenants.id, row.tenantId)).limit(1);
      const recheck = checkTransferEligibility({
        targetUserId: toUser.id,
        fromUserId: fromUser.id,
        tenantId: row.tenantId,
        target: toUser,
        billingStatus: tenantRow?.billingStatus ?? null,
      });
      if (!recheck.ok) {
        // tenant-scan-ignore: ownership-transfer token validated above; row pinned by its unguessable token id.
        await ctx.db.update(ownershipTransferTokens)
          .set({ cancelledAt: nowSec })
          .where(eq(ownershipTransferTokens.id, row.id));
        rejectFromReason(recheck.reason!);
      }

      // Apply the role flip. SQLite doesn't expose transactions over the
      // remote D1 driver, so we order writes such that a partial failure
      // leaves the row reusable: target gets owner FIRST, then old owner
      // demoted, then the token is marked consumed. If we crash mid-way,
      // the partial-index keeps anyone else from racing in.
      const targetWasMaster = toUser.role === "master";
      await ctx.db.update(webUsers)
        .set({ role: "tenant_owner", updatedAt: nowSec })
        .where(eq(webUsers.id, toUser.id));
      await ctx.db.update(webUsers)
        .set({ role: "master", updatedAt: nowSec })
        .where(eq(webUsers.id, fromUser.id));

      // Synthetic master row for the now-demoted old owner so cron/Telegram
      // paths can find them; same pattern as roleChangeRequests.
      if (fromUser.tenantId === row.tenantId) {
        const syntheticChatId = 10_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
        await ctx.db.insert(masters).values({
          tenantId: row.tenantId,
          chatId: syntheticChatId,
          name: fromUser.name ?? fromUser.email,
          active: 1,
          isSynthetic: 1,
          webUserId: fromUser.id,
        }).onConflictDoNothing();
      }

      // tenant-scan-ignore: ownership-transfer token validated above; row pinned by its unguessable token id.
      await ctx.db.update(ownershipTransferTokens)
        .set({ consumedAt: nowSec })
        .where(eq(ownershipTransferTokens.id, row.id));

      await ctx.db.insert(auditLog).values({
        tenantId: row.tenantId,
        actor: fromUser.email,
        action: "ownership_transferred",
        detail: `from=${fromUser.email} to=${toUser.email}${targetWasMaster ? "" : " (target was non-master)"}`,
        ip,
        createdAt: nowSec,
      });

      const tenantName = tenantRow?.name ?? row.tenantId;
      sendOwnershipTransferCompletedToOldOwnerEmail({
        to: fromUser.email,
        newOwnerName: toUser.name ?? toUser.email,
        tenantName,
        lang: (fromUser.lang as Lang) ?? "en",
      }).catch(() => { /* fire-and-forget */ });
      sendOwnershipTransferCompletedToNewOwnerEmail({
        to: toUser.email,
        oldOwnerName: fromUser.name ?? fromUser.email,
        tenantName,
        lang: (toUser.lang as Lang) ?? "en",
      }).catch(() => { /* fire-and-forget */ });

      return { ok: true as const, tenantId: row.tenantId };
    }),

  /** Owner: cancel a pending transfer. */
  cancelTransfer: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const nowSec = Math.floor(Date.now() / 1000);

      const result = await ctx.db
        .update(ownershipTransferTokens)
        .set({ cancelledAt: nowSec })
        .where(and(
          eq(ownershipTransferTokens.tenantId, input.tenantId),
          isNull(ownershipTransferTokens.consumedAt),
          isNull(ownershipTransferTokens.cancelledAt),
        ));

      // Drizzle/D1 .update doesn't reliably return rowcount; for the audit
      // entry just record that cancel was attempted.
      await ctx.db.insert(auditLog).values({
        tenantId: input.tenantId,
        actor: ctx.webUser?.email ?? "unknown",
        action: "ownership_transfer_cancelled",
        detail: null,
        ip: clientIp(ctx as { headers?: Headers | null }),
        createdAt: nowSec,
      });

      return { ok: true as const };
    }),
});
