import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { socialCommentInbox, marketingContentPlan } from "~/server/db/schema";

/**
 * @manicbot_com social automation — God Mode visibility + control (migration 0127).
 *
 * A dashboard surface that complements the Telegram/tg-bot flow: see the IG/FB
 * comment inbox, approve/skip posts waiting on the Telegram gate, and
 * draft/escalate/skip comments. All writes are D1-only (Drizzle) — the actual
 * Graph API posting still happens in the Worker (autopilot + phaseSocialCommentReply),
 * which reads the rows this router transitions. `tenant_id IS NULL` is the
 * @manicbot_com platform singleton (mirrors marketingAutopilotRouter).
 */

const COMMENT_STATUS = z.enum(["new", "drafted", "replied", "skipped", "escalated", "failed"]);

function safeParseHashtags(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

export const socialRouter = createTRPCRouter({
  // ── reads ────────────────────────────────────────────────────────────────
  inbox: adminProcedure
    .input(
      z
        .object({
          status: COMMENT_STATUS.optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      // tenant-scan-ignore: God Mode (adminProcedure) — platform-wide @manicbot_com comment inbox; rows carry their own tenant_id, no cross-tenant tenant-data read.
      const base = ctx.db.select().from(socialCommentInbox);
      const filtered = input.status
        ? base.where(eq(socialCommentInbox.status, input.status))
        : base;
      const rows = await filtered
        .orderBy(desc(socialCommentInbox.createdAt))
        .limit(input.limit);
      return { rows };
    }),

  pendingPosts: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(marketingContentPlan)
        .where(
          and(
            isNull(marketingContentPlan.tenantId),
            eq(marketingContentPlan.status, "awaiting_approval"),
          ),
        )
        .orderBy(asc(marketingContentPlan.scheduledAt))
        .limit(input.limit);
      return { rows: rows.map((r) => ({ ...r, hashtags: safeParseHashtags(r.hashtagsJson) })) };
    }),

  counts: adminProcedure.query(async ({ ctx }) => {
    const byStatus = await ctx.db
      // tenant-scan-ignore: God Mode (adminProcedure) — platform-wide @manicbot_com comment counts; no cross-tenant tenant-data read.
      .select({ status: socialCommentInbox.status, count: sql<number>`count(*)` })
      .from(socialCommentInbox)
      .groupBy(socialCommentInbox.status);
    const pending = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(marketingContentPlan)
      .where(
        and(
          isNull(marketingContentPlan.tenantId),
          eq(marketingContentPlan.status, "awaiting_approval"),
        ),
      );
    return {
      comments: byStatus.map((c) => ({ status: c.status, n: Number(c.count) })),
      pendingPosts: Number(pending[0]?.count ?? 0),
    };
  }),

  // ── mutations (D1-only; the Worker does the actual Graph API posting) ──────
  approvePost: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64), decision: z.enum(["approve", "skip"]) }))
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const set =
        input.decision === "approve"
          ? { status: "ready" as const, approvedAt: now, updatedAt: now }
          : { status: "paused" as const, updatedAt: now };
      const result = await ctx.db
        .update(marketingContentPlan)
        .set(set)
        .where(
          and(
            eq(marketingContentPlan.id, input.id),
            isNull(marketingContentPlan.tenantId),
            eq(marketingContentPlan.status, "awaiting_approval"),
          ),
        )
        .returning({ id: marketingContentPlan.id, status: marketingContentPlan.status });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "no awaiting_approval slot with that id" });
      }
      return result[0]!;
    }),

  commentDecision: adminProcedure
    .input(
      z.object({
        commentId: z.string().min(1).max(200),
        action: z.enum(["draft", "escalate", "skip"]),
        replyText: z.string().max(8000).optional(),
        classification: z.string().max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.action === "draft" && !input.replyText?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "replyText required for draft" });
      }
      const now = Math.floor(Date.now() / 1000);
      const status =
        input.action === "draft" ? "drafted" : input.action === "escalate" ? "escalated" : "skipped";
      const set: Partial<typeof socialCommentInbox.$inferInsert> = {
        status,
        classification: input.classification ?? null,
        updatedAt: now,
      };
      if (input.action === "draft") set.replyText = input.replyText!.trim();
      const result = await ctx.db
        // tenant-scan-ignore: God Mode (adminProcedure) — transitions one inbox row by its globally-unique comment_id; the row carries its own tenant_id.
        .update(socialCommentInbox)
        .set(set)
        .where(and(eq(socialCommentInbox.commentId, input.commentId), eq(socialCommentInbox.status, "new")))
        .returning({ id: socialCommentInbox.id, status: socialCommentInbox.status });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "no 'new' comment with that id" });
      }
      return result[0]!;
    }),
});
