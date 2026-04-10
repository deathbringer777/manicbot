import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { roleChangeRequests, webUsers, tenants, masters, auditLog } from "~/server/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  sendRoleChangeAdminNotification,
  sendRoleChangeDecisionEmail,
} from "~/server/email/emailService";
import type { Lang } from "~/lib/i18n";

/* ── Rate limiting ────────────────────────────────────────────────────────── */

const requestRl = new Map<string, { count: number; resetAt: number }>();
const RL_MAX = 3;
const RL_WINDOW = 10 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = requestRl.get(ip);
  if (!entry || now > entry.resetAt) {
    requestRl.set(ip, { count: 1, resetAt: now + RL_WINDOW });
    return true;
  }
  if (entry.count >= RL_MAX) return false;
  entry.count++;
  return true;
}

function clientIp(ctx: { headers?: Headers | null }): string {
  const h = ctx.headers;
  if (!h?.get) return "unknown";
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || h.get("cf-connecting-ip") || "unknown";
}

function randomId(len = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => chars[b % chars.length]).join("");
}

/* ── Router ───────────────────────────────────────────────────────────────── */

export const roleChangeRequestsRouter = createTRPCRouter({
  /** User submits a role change request. */
  requestRoleChange: protectedProcedure
    .input(z.object({
      requestedRole: z.enum(["tenant_owner", "master"]),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Web session required" });
      }

      const ip = clientIp(ctx as { headers?: Headers | null });
      if (!checkRateLimit(ip)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Try again later." });
      }

      // Fetch current user
      const [user] = await ctx.db.select().from(webUsers).where(eq(webUsers.id, ctx.webUser.id)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const currentRole = user.role;

      // Only tenant_owner <-> master
      if (currentRole !== "tenant_owner" && currentRole !== "master") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Role change not available for your current role" });
      }
      if (input.requestedRole === currentRole) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already have this role" });
      }

      // Check for existing pending request
      const [existing] = await ctx.db
        .select()
        .from(roleChangeRequests)
        .where(and(
          eq(roleChangeRequests.webUserId, ctx.webUser.id),
          eq(roleChangeRequests.status, "pending"),
        ))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a pending request" });
      }

      const now = Math.floor(Date.now() / 1000);
      const id = `rcr_${randomId()}`;

      await ctx.db.insert(roleChangeRequests).values({
        id,
        webUserId: ctx.webUser.id,
        currentRole,
        requestedRole: input.requestedRole,
        reason: input.reason ?? null,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      // Audit log
      await ctx.db.insert(auditLog).values({
        tenantId: user.tenantId,
        actor: ctx.webUser.email,
        action: "role_change_requested",
        detail: `${currentRole} → ${input.requestedRole}`,
        ip,
        createdAt: now,
      });

      // Notify admin(s) via email
      const admins = await ctx.db
        .select({ email: webUsers.email })
        .from(webUsers)
        .where(eq(webUsers.role, "system_admin"));

      if (admins.length > 0) {
        const lang = (user.lang as Lang) || "en";
        sendRoleChangeAdminNotification(
          admins.map((a) => a.email),
          user.name ?? user.email,
          user.email,
          currentRole,
          input.requestedRole,
          input.reason ?? null,
          lang,
        ).catch(() => { /* fire-and-forget */ });
      }

      return { id, status: "pending" as const };
    }),

  /** Get user's latest request. */
  getMyRequest: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.webUser) return null;

      const [req] = await ctx.db
        .select()
        .from(roleChangeRequests)
        .where(eq(roleChangeRequests.webUserId, ctx.webUser.id))
        .orderBy(desc(roleChangeRequests.createdAt))
        .limit(1);

      return req ?? null;
    }),

  /** Admin: list role change requests. */
  listRequests: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "approved", "denied", "all"]).default("pending"),
    }))
    .query(async ({ ctx, input }) => {
      const cond = input.status === "all"
        ? undefined
        : eq(roleChangeRequests.status, input.status);

      const rows = await ctx.db
        .select({
          id: roleChangeRequests.id,
          webUserId: roleChangeRequests.webUserId,
          currentRole: roleChangeRequests.currentRole,
          requestedRole: roleChangeRequests.requestedRole,
          reason: roleChangeRequests.reason,
          status: roleChangeRequests.status,
          adminNote: roleChangeRequests.adminNote,
          reviewedBy: roleChangeRequests.reviewedBy,
          reviewedAt: roleChangeRequests.reviewedAt,
          createdAt: roleChangeRequests.createdAt,
          userName: webUsers.name,
          userEmail: webUsers.email,
        })
        .from(roleChangeRequests)
        .leftJoin(webUsers, eq(roleChangeRequests.webUserId, webUsers.id))
        .where(cond)
        .orderBy(desc(roleChangeRequests.createdAt))
        .limit(100);

      return rows;
    }),

  /** Admin: count pending requests (for badge). */
  pendingCount: adminProcedure
    .query(async ({ ctx }) => {
      const [row] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(roleChangeRequests)
        .where(eq(roleChangeRequests.status, "pending"));
      return row?.count ?? 0;
    }),

  /** Admin: approve or deny a request. */
  reviewRequest: adminProcedure
    .input(z.object({
      requestId: z.string(),
      decision: z.enum(["approved", "denied"]),
      adminNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [req] = await ctx.db
        .select()
        .from(roleChangeRequests)
        .where(and(
          eq(roleChangeRequests.id, input.requestId),
          eq(roleChangeRequests.status, "pending"),
        ))
        .limit(1);

      if (!req) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Request not found or already reviewed" });
      }

      const [user] = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.id, req.webUserId))
        .limit(1);

      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const now = Math.floor(Date.now() / 1000);
      const reviewerId = ctx.webUser?.id ?? ctx.user?.id?.toString() ?? "admin";

      // If approved, perform the role switch
      if (input.decision === "approved") {
        // Update web_users.role
        await ctx.db
          .update(webUsers)
          .set({ role: req.requestedRole, updatedAt: now })
          .where(eq(webUsers.id, req.webUserId));

        if (user.tenantId) {
          if (req.currentRole === "tenant_owner" && req.requestedRole === "master") {
            // tenant_owner -> master: mark tenant as personal
            await ctx.db
              .update(tenants)
              .set({ isPersonal: 1 })
              .where(eq(tenants.id, user.tenantId));

            // Create a master record with synthetic chatId
            const syntheticChatId = 10_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
            await ctx.db.insert(masters).values({
              tenantId: user.tenantId,
              chatId: syntheticChatId,
              name: user.name ?? user.email,
              active: 1,
            }).onConflictDoNothing();

          } else if (req.currentRole === "master" && req.requestedRole === "tenant_owner") {
            // master -> tenant_owner: mark tenant as non-personal
            await ctx.db
              .update(tenants)
              .set({ isPersonal: 0 })
              .where(eq(tenants.id, user.tenantId));
          }
        }
      }

      // Update the request
      await ctx.db
        .update(roleChangeRequests)
        .set({
          status: input.decision,
          adminNote: input.adminNote ?? null,
          reviewedBy: reviewerId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(roleChangeRequests.id, input.requestId));

      // Audit log
      const ip = clientIp(ctx as { headers?: Headers | null });
      await ctx.db.insert(auditLog).values({
        tenantId: user.tenantId,
        actor: reviewerId,
        action: "role_change_reviewed",
        detail: `${input.decision}: ${req.currentRole} → ${req.requestedRole} (user: ${user.email})`,
        ip,
        createdAt: now,
      });

      // Email user about decision
      const lang = (user.lang as Lang) || "en";
      sendRoleChangeDecisionEmail(
        user.email,
        input.decision,
        req.currentRole,
        req.requestedRole,
        input.adminNote ?? null,
        lang,
      ).catch(() => { /* fire-and-forget */ });

      return { success: true };
    }),
});
